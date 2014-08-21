/**
 * @fileOverview This file contains the {@link Provi.Job} Module.
 * @author <a href="mailto:alexander.rose@charite.de">Alexander Rose</a>
 * @version 0.0.1
 */


/**
 * @namespace
 * Provi Job module
 */

var Job = {};



(function() {
    
//
//
///**
// * Singleton job manager object.
// */
Job.JobManager = new Utils.ObjectManager();
//
//
/**
 * Tool list.
 */
var defaults = {};
    
defaults.dom_parent_ids = {
    DATASET_WIDGET: undefined,
    CANVAS_WIDGET: undefined,
    SELECTION_WIDGET: undefined,
    BUILDER_WIDGET: undefined,
    SETTINGS_WIDGET: undefined,
    JOBS_WIDGET: undefined
};

defaults.base_url = '';
var pathname = window.location.pathname;
var base_idx = pathname.indexOf("/static/html/");
if( base_idx>0 ) defaults.base_url = pathname.substring( 0, base_idx );

var url_for = function( url ){
    return window.location.protocol + '//' + window.location.host + 
        defaults.base_url + url;
}

Job.Tools = {
    init: function(){
        this.ready = false;
        this.tools = {};
        this.filter = null;
        this.default_tool = "";
        this.retrieve_tools();
    },
    retrieve_tools: function(){
        $.ajax({
            dataType: "json",
            url: url_for( "/job/tools" ),
            success: _.bind( this.init_tools, this ),
        });
    },
    init_tools: function( tools ){
        this.tools = tools;
        this.ready = true;
    },
    get: function( name ){
        return this.tools[ name ];
    },
    names: function(){
        var names = _.keys( this.tools );
        if( this.filter ){
            return _.intersection( names, this.filter );
        }else{
            return names;
        }
    },
    
};
Job.Tools.init();


/**
 * job class
 * @constructor
 */
Job.Job = function(params){
    console.log( "JOB", params );
    params = _.defaults( params, this.default_params );
    Job.JobManager.add( this, function( job ){
        $(job).bind('status', Job.JobManager.change );
    });

    var p = [ 
        "applet", "tool", "submitted", "running", "check",
        "jobname", "dataset", "make_widget", "autoload", "name"
    ];
    _.extend( this, _.pick( params, p ) );
    // submit based on dataset
    if( this.dataset ){
        var job = this;
        var d = this.dataset.raw_data;
        var p = d.params;
        p.__type__ = d.type;
        $.ajax({
            url: '../../job/submit/',
            data: p,
            cache: false,
            type: 'POST',
            success: function(data){
                console.log( "dataset job", data );
                if( data=="ERROR" ){
                    job.set_error();
                }else{
                    job.set_jobname( data["jobname"] );
                }
            }
        });
        this.make_widget = d.make_widget;
        this.autoload = d.autoload;
        this.name = d.name;
        this.submitted = true;
    }

    if( this.make_widget ){
        new Job.JobWidget( _.defaults({
            "job_id": job.id,
            "parent_id": defaults.dom_parent_ids.DATASET_WIDGET,
            "applet": this.applet,
            "heading": this.name
        }, this.make_widget ) );
    }

    this.check = undefined;
    if( this.submitted ){
        this.running = true;
        this.status_interval = setInterval( _.bind( function(){
            this.retrieve_status();
        }, this ), 1000);
    }else{
        this.running = false;
    }

    this.job_params = {};
    this.retrieve_params();
};

/**
 * dataset class
 * @constructor
 */
Dataset = function(params){
    params = _.defaults( params, this.default_params );

    var p = [ "raw_data", "name", "url", "type" ];
    _.extend( this, _.pick( params, p ) );

    // can be polluted by other functions for temp storage, i.e.
    // plupload_id for the plupload widget
    this.meta = params.meta;

    this.initialized = false;
    this.loaded = false;

    this.id = Job.JobManager.add( this );
    
    this.detect_type();
};


/**
 * function to import a dataset from from a example/local data directory
 * @returns {Provi.Data.Dataset} dataset instance
 */
import_example = function( directory_name, filename, type, params, no_init ){
    var dataset = new Dataset({
        name: filename,
        meta: {
            directory: directory_name,
            filename: filename
        },
        type: type || type_from_filename( filename ),
        url: url_for( '/example/data/' +
            '?directory_name=' + 
                encodeURIComponent( directory_name ) + 
            '&_id=' + (new Date().getTime()) +
            '&path=' + encodeURIComponent( filename )
        )
    });
    if(!no_init) dataset.init( params );
    return dataset;
}


type_from_filename = function( filename ){
    // remove suffixes added by dowser|gromacs to old/backup/superseeded files
    filename = filename.replace(/(_\d+|\.\d+#)$/, '');
    return filename.split('.').pop();
}



Job.Job.prototype = {
    default_params: {
        submitted: false,
        tool: false,
        jobname: false,
        log: [],
        make_widget: false,
        autoload: false
    },
    set_error: function(){
        clearInterval( this.status_interval );
        this.submitted = true;
        this.running = false;
        this.check = false;
        this.jobid = "ERROR";
        if( this.dataset ){
            this.dataset.set_loaded();
        }
        $(this).triggerHandler("status");
        $(this).triggerHandler("error");
        Job.JobManager.change();
    },
    set_jobname: function( jobname ){
        this.jobname = jobname;
        var tmp = jobname.split("_")
        this.tool = tmp[0];
        this.jobid = tmp[1];
        if( this.dataset ){
            this.dataset.set_loaded();
        }
        this.retrieve_params();
        $(this).triggerHandler("jobname");
    },
    retrieve_status: function( force ){
        console.log("retrieve_status");
        if( this.submitted && !this.running ){
            console.log( "job stopped running" );
            clearInterval( this.status_interval );
            $(this).triggerHandler("finished");
            if( this.autoload ){
                this.do_autoload();
            }
            if( !force ) return;
        }
        if( this.jobname ){
            $.ajax({
                dataType: "json",
                url: url_for( 
                    "/job/status/" + encodeURIComponent( this.jobname )
                ),
                cache: false,
                success: _.bind( function( data ){
                    // console.log("Job.retrieve_status", data );
                    var change = true;
                    if( data ){
                        if( this.check === data["check"] &&
                                this.running === data["running"] &&
                                this.log === data["log"] ){
                            change = false;
                        }
                        this.check = data["check"];
                        this.running = data["running"];
                        this.log = data["log"];
                    }else{
                        this.check = false;
                        this.running = false;
                        this.log = [];
                    }
                    if( change ){
                        $(this).triggerHandler("status");
                        Job.JobManager.change();
                    }
                }, this )
            });
        }
    },
    retrieve_params: function(){
        if( this.jobname ){
            $.ajax({
                dataType: "json",
                url: url_for( 
                    "/job/params/" + encodeURIComponent( this.jobname )
                ),
                cache: false,
                success: _.bind( function( data ){
                    console.log("Job.retrieve_params", data);
                    this.job_params = data;
                    $(this).triggerHandler("status");
                }, this )
            });
        }else{
            console.log( "Job.retrieve_params: no jobname" )
        }
    },
    do_autoload: function(){
        var tool = Job.Tools.get( this.tool );
        if( tool.attr.provi_file ){
            var filename = this.jobname + '/' + tool.attr.provi_file;
            import_example( 
                '__job__', filename, 'provi', {}, false 
            );
        }
    }
};
var ExampleDirectorySelectorWidget = function(params){
    params.tag_name = 'span';
    WWidget.call( this, params );
    this.directory_selector_id = this.id + '_directory';
    this.refresh_id = this.id + '_refresh';
    var content = '<span class="control_row">' +
            '<label for="' + this.directory_selector_id + '">Directory:</label>&nbsp;' +
            '<select id="' + this.directory_selector_id + '" class="ui-state-default"></select>&nbsp;' +
            '<span title="refresh" class="ui-icon ui-icon-refresh" style="cursor:pointer;" id="' + this.refresh_id + '">refresh</span>' +
        '</span>';
    $(this.dom).append( content );
    this._init();
};
var ExampleLoadWidget = function(params){
    params = _.defaults( params, this.default_params );

    WWidget.Widget.call( this, params );

    this._init_eid_manager([ 
        'directory_selector_widget', 'applet_selector_widget', 
        'dataset_list', 'dataset_list_open_all', 
        'dataset_list_close_all', 'jstree'
    ]);

    var p = [ "all_buttons", "directory_name", "root_dir" ];
    _.extend( this, _.pick( params, p ) );
    
    var template = '' +
        '<div id="${eids.applet_selector_widget}"></div>' +
        '<div id="${eids.directory_selector_widget}"></div>' +
        '<div>' +
            '<div>' +
                '<span>Collapse directories: </span>' +
                '<button id="${eids.dataset_list_open_all}">show all</button>' +
                '<button id="${eids.dataset_list_close_all}">hide all</button>' +
            '</div>' +
            '<div class="control_row" id="${eids.dataset_list}"></div>' +
        '</div>' +
        '<div class="control_row">' +
            '<div id="${eids.jstree}"></div>' +
        '</div>' +
    '';
    this.add_content( template, params );
    if( !this.directory_name ){
        this.directory_selector = new ExampleDirectorySelectorWidget({
            parent_id: this.eid('directory_selector_widget')
        });
    }
    this.init();
}

Job.JobWidget = function(params){
    params = _.defaults( params, this.default_params );
    console.log('JobWidget', params);
    WWidget.Widget.call( this, params );
    this._init_eid_manager([ 
        "jobname", "log", "file_tree_widget"
    ]);
    
    var p = [ "job_id" ];
    _.extend( this, _.pick( params, p ) );
    
    var template = '' +
        '<div class="control_row" id="${eids.jobname}"></div>' +
        '<div class="control_row" id="${eids.log}"></div>' +
        '<div class="control_row" id="${eids.file_tree_widget}"></div>' +
    '';
    this.add_content( template, params );

    this.job = Job.JobManager.get( this.job_id );
    this._init();
}
Job.JobWidget.prototype = Utils.extend(WWidget.Widget, {
    default_params: {
        // heading: 'Job',
        persist_on_applet_delete: true
    },
    _init: function(){
        this._heading = this.heading;
        if( this.job.jobname ){
            this.init_file_tree();
            this.init_header();
        }else{
            $(this.job).bind( 
                "jobname", _.bind( this.init_file_tree, this )
            );
            $(this.job).bind( 
                "jobname", _.bind( this.init_header, this )
            );
        }

        $(this.job).bind( 
            "status", _.bind( this.init_log, this )
        );

        $(this.job).bind( 
            "finished", _.bind( this.init_file_tree, this )
        );

        $(this.job).bind( 
            "error", _.bind( function(){
                this.set_heading( "[ERROR] " + this._heading );
            }, this )
        );
        
        WWidget.Widget.prototype.init.call(this);
    },
    init_header: function(){
        this.elm("jobname").append( '<div>' + 
            '[' + this.job_id.toString() + "] " + this.job.jobname + 
        '</div>');
    },
    init_log: function(){
        this.elm("log").empty().append( '<div>' + 
            ( this.job.log.join( "<br/>" ) ) + 
        '</div>');
    },
    init_file_tree: function(){
        // check if the widget is still available
        // TODO properly destroy widgets and their bindings
        if( $('#' + this.id).length == 0 ) return;

        if( this._heading ){
            prefix = "";
            if( this.job.running ){
                prefix = "[Job Running] ";
            }else if( this.job.check ){
                prefix = "[Job Done] ";
            }else{
                prefix = "[Job Failed] ";
            }
            this.set_heading( prefix + this._heading );
        }

        this.elm("file_tree_widget").empty();
        new ExampleLoadWidget({
            collapsed: false,
            heading: false,
            all_buttons: false,
            directory_name: '__job__',
            root_dir: this.job.jobname + '/',
            applet: this.applet,
            parent_id: this.eid("file_tree_widget")
        });
    }
});


/**
 * A widget
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
Job.FormWidget = function(params){
    params = _.defaults( params, this.default_params );
    console.log('FormWidget', params);
    WWidget.Widget.call( this, params );
    this._init_eid_manager([ 
        "tool_selector", "form_elms", "form", "submit", "iframe"
    ]);
    
    var p = [ "datalist" ];
    _.extend( this, _.pick( params, p ) );
    
    var template = '' +
        '<div class="control_row" id="${eids.tool_selector}"></div>' +
        '<div class="control_row">' +
            '<form id="${eids.form}" style="display:hidden;" method="post" action="../../job/submit/" target="${eids.iframe}" enctype="multipart/form-data">' +
                '<div class="control_row" id="${eids.form_elms}"></div>' +
                '<input type="hidden" name="__type__" value=""></input>' +
                '<button id="${eids.submit}">submit</button>' +
            '</form>' +
            '<iframe id="${eids.iframe}" name="${eids.iframe}" style="display:none;" src="" frameborder="0" vspace="0" hspace="0" marginwidth="0" marginheight="0" width="0" height="0"></iframe>' +
        '</div>' +
    '';
    
    this.add_content( template, params );
    this._init();
}
Job.FormWidget.prototype = Utils.extend(WWidget.Widget, {
    default_params: {
        // heading: 'Job',
        // persist_on_applet_delete: false
    },
    _init: function(){

        this.elm('submit').button().hide()
            .click( _.bind( function(e){
                e.preventDefault();
                this.submit();
                return false;
            }, this ) );
            this.get_tools();

        WWidget.Widget.prototype.init.call(this);
    },
    submit: function(){
        WWidget.ui_disable_timeout( this.elm('submit') );
        var job = new Job.Job({ 
            applet: this.datalist.applet,
            submitted: true
        });

        console.log(this.tool.args);
        var as_form = !_.some( this.tool.args, function( p, id ){
            return p.type=="file" && p.ext=="jmol"
        });

        if( as_form ){
            var elm = document.getElementById( this.eid('form') );
            var data = new FormData( elm );
            var form_elms = this.elm('form_elms');

            _.each( this.tool.args, function( p, id ){
                if( p.type=="file" && p.ext=="pdb" ){

                    var sele = form_elms.find("input[name=__sele__" + id + "]").val() || "*";
                    var pdb = this.datalist.applet.evaluate('provi_write_pdb({' + sele + '});');
                    var blob = new Blob([ pdb ], { "type" : "text/plain" });
                    data.append( id, blob, "file.pdb" );
                }
            }, this);

            $.ajax({
                url: '../../job/submit/',
                data: data,
                cache: false,
                contentType: false,
                processData: false,
                type: 'POST',
                success:function(data){
                    console.log( "submit form job", data );
                    if( data=="ERROR" ){
                        job.set_error();
                    }else{
                        job.set_jobname( data["jobname"] );
                    }
                }
            });
        }else{
            var params = $.param( this.elm('form').serializeArray() ) +
                '&_id=' + (new Date().getTime());
            var s = 'load("../../job/submit/?POST?_PNGJBIN_&' + params + '");';
            var data = JSON.parse( this.datalist.applet.evaluate( s ) );
            console.log( "submit GET job", data );
            console.log( s, "_PNGJBIN_", data );

            if( data=="ERROR" ){
                job.set_error();
            }else{
                job.set_jobname( data["jobname"] );
            }

            // TODO non blocking
            // this.datalist.applet.script_callback( s, {}, function(d){
            //     console.log( "_PNGJBIN_", d )
            //     // job.set_jobname( data["jobname"] );
            // });
        }

    },
    get_tools: function(){
        if( Job.Tools.ready ){
            this.init_selector( Job.Tools.names() );
        }else{
            $(Job.Tools)
                .bind("tools_ready", _.bind( this.get_tools, this ) );
        }
    },
    init_selector: function( names ){
        var name = Job.Tools.default_tool;
        var p = { type: "select", options: [""].concat( names ) };
        var select = WWidget.form_builder(
            p, name, "tool_selector", this
        );
        this.elm("tool_selector").append( select );
        if ( name ) {
            this.init_tool( name );

        }
    },
    set: function(e){
        var elm = $(e.currentTarget);
        var id = elm.data('id');
        if( id=="tool_selector" ){
            var name = elm.children("option:selected").val();
            this.init_tool( name );
        }
    },
    init_tool: function( name ){
        this.tool = Job.Tools.get( name );
        this.elm("form_elms").empty();
        this.elm("submit").show();
        if (this.tool.docu) {
            this.elm("form_elms").append( "<p>" + this.tool.docu + "</p>" );
        }
        
        _.each( this.tool.args, _.bind( function( p, id ){
            if( !p.group ){
                var form_elm = WWidget.form_builder( 
                    p, p['default'], id, this 
                );
                this.elm("form_elms").append( form_elm );
            }
        }, this));
        this.elm('form').children('input[name=__type__]')
            .val( name );
    }
});


Job.InfoWidget = function(params){
    params = _.defaults( params, this.default_params );
    console.log('InfoWidget', params);
    WWidget.Widget.call( this, params );
    this._init_eid_manager([ 
        "params_info"
    ]);
    
    var p = [ "job_id" ];
    _.extend( this, _.pick( params, p ) );
    
    var template = '' +
        '<div class="control_row" id="${eids.params_info}"></div>' +
    '';
    this.add_content( template, params );

    this.job = Job.JobManager.get( this.job_id );
    this._init();
}
Job.InfoWidget.prototype = Utils.extend(WWidget.Widget, {
    default_params: {
        persist_on_applet_delete: true
    },
    _init: function(){
        if( this.job.jobname ){
            this.init_info();
        }else{
            $(this.job).bind( 
                "jobname", _.bind( this.init_info, this )
            );
        }
        WWidget.Widget.prototype.init.call(this);
    },
    init_info: function(){
        if( !Job.Tools.ready ){
            $(Job.Tools)
                .bind("tools_ready", _.bind( this.init_info, this ) );
            return;
        }
        var tool = Job.Tools.get( this.job.tool );
        this.elm("params_info").empty();
        var i = 0;
        _.each( tool.args, _.bind( function( p, id ){
            if( !p.group ){
                if( _.isUndefined( p['default'] ) ){
                    var value = this.job.job_params.args[ i++ ];
                }else{
                    var value = this.job.job_params.kwargs[ id ];
                }
                if( p['type'] === 'file' ){
                    value = value.substr( value.lastIndexOf("/")+1 );
                }
                this.elm("params_info").append(
                    "<div>" + id + ": " + value + "</div>"
                );
            }
        }, this));
    },
});
DatalistManager2 = new Utils.ObjectManager();
Datalist2 = function(params){
    var p = [ "applet", "sort_column", "sort_dir" ];
    _.extend( this, _.pick( params, p ) );

    DatalistManager2.add( this, function( datalist ){
        datalist.name = datalist.id + "_" + datalist.type;
    });

    if( params.load_struct ){
        $(this.applet).bind( "load_struct", _.bind( this.calculate, this ) );
    }
    $(this).bind("init_ready", _.bind( this.calculate, this ) );

    if( !params.no_init ) this._init();
}

Job.JobDatalist = function(params){
    var p = [];
    _.extend( this, _.pick( params, p ) );
    var bigColumnWidth = params.bigColumnWidth || 100;
    var normalColumnWidth = params.normalColumnWidth || 50;
    var smallColumnWidth = params.smallColumnWidth || 30;

    this.columns = [
        { id: "id", name: "id", field: "id", width: normalColumnWidth },
        { id: "tool", name: "tool", field: "tool", width: bigColumnWidth },
        { id: "jobid", name: "jobid", field: "jobid", width: bigColumnWidth },
        { id: "status", name: "status", field: "status", width: smallColumnWidth, cssClass: "center",
            formatter: Grid.FormatterIconFactory(
                function(row, cell, value){
                    if( _.isUndefined(value) ) return "question";
                    if( value===-1 ) return "spinner fa-spin";
                    return value ? "check" : "warning";
                }
            ),
        },
        { id: "load", name: "load", width: smallColumnWidth, cssClass: "center action",
            formatter: Grid.FormatterIconFactory("eye"),
            action: _.bind( function( id, d, grid_widget, e ){
                var job = Job.JobManager.get( d.id );
                console.log( job, d, id );
                job.do_autoload();
            }, this )
        },
        { id: "info", name: "info", width: smallColumnWidth, cssClass: "center action",
            formatter: Grid.FormatterIconFactory(
                "info-circle"
            ),
            action: Grid.ActionPopupFactory(
                Job.InfoWidget,
                _.bind( function( id, d, grid_widget, e ){
                    return { "job_id": d.id }
                }, this )
            )
        },
        { id: "files", name: "files", width: smallColumnWidth, cssClass: "center action",
            formatter: Grid.FormatterIconFactory("folder-o"),
            action: Grid.ActionPopupFactory(
                Job.JobWidget,
                _.bind( function( id, d, grid_widget, e ){
                    return { 
                        "job_id": d.id,
                        "applet": this.applet,
                    }
                }, this )
            )
        },
        { id: "download", name: "download", width: smallColumnWidth, cssClass: "center action",
            formatter: Grid.FormatterIconFactory("download"),
            action: _.bind( function( id, d, grid_widget, e ){
                console.log("download", id, d);
                Job.download( d.tool + "_" + d.jobid );
                /*window.location = Provi.url_for( 
                    "/job/download/" + encodeURIComponent( 
                        d.tool + "_" + d.jobid
                    )
                );*/
            }, this )
        },
        /* abort?
        { id: "delete", name: "delete", width: smallColumnWidth, cssClass: "center",
            formatter: WWidget.Grid.FormatterIconFactory("trash-o"),
            action: WWidget.Grid.ActionDeleteFactory(
                _.bind( function( id, d, grid_widget, e ){
                
                    
                }, this )
            )
        },*/
    ]

    Datalist2.call( this, params );
}

Job.JobDatalist.prototype = Utils.extend(Datalist2, {
    type: "JobDatalist",
    params_object: Job.FormWidget,
    _init: function(){
        $( Job.JobManager ).bind(
            "add change", _.bind( this.invalidate, this )
        );
        this.initialized = false;
        this.set_ready();
    },
    DataItem: function( row ){
        var job = Job.JobManager.get( row.id );
        this.id = job.id;
        this.jobid = job.jobid;
        this.tool = job.tool;
        this.status = job.running ? -1 : job.check;
    },
    load_data: function( from, to, sortcol, sortdir ){
        var data = Job.JobManager.get_list();
        var hits = data.length;
        data = data.slice( from, to+1 );

        return { results: data, start: from, hits: hits };
    }
});


Job.download = function( id ){
    
    var url = url_for( '/job/download/' + id );
    var form = $(
        '<form method="get" action="' + url + '" target="_blank">' +
        '</form>'
    ).appendTo("body");
    
    form.submit();
    form.remove();
}


})();