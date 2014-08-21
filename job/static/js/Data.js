/**
 * @fileOverview This file contains the {@link Provi.Data} Module.
 * @author <a href="mailto:alexander.rose@charite.de">Alexander Rose</a>
 * @version 0.0.1
 */


/**
 * @namespace
 * Provi Data module
 */
var Data = {};


(function() {

/** @exports Utils as Provi.Utils */
//var Utils = Utils;

/** @exports Widget as Provi.Widget.Widget */
var Widget = WWidget.Widget;


/**
 * mapping of file extension to Provi datatypes
 */
Data.types = {
    structure: [
        'pdb', 'ent', 'pqr', 'gro', 'cif', 'mmcif', 'mol', 'mol2', 
        'sdf', 'xyzr', 'xyzrn', 'xyz'
    ],
    isosurface: ['jvxl', 'obj', 'vert'],
    volume: ['cube', 'mrc', 'cub', 'ccp4', 'dx', 'map'],
    interface_contacts: ['sco', 'mbn'],
    jmol: ['jmol', 'png', 'pngj']
}


/**
 * Fired when a {@link Provi.Data.Dataset} dataset is added to the dataset manager.
 *
 * @name Provi.Data.DatasetManager#add
 * @event
 * @param {object} event A jQuery event object.
 * @param {Provi.Data.Dataset} dataset The added dataset.
 */


/**
 * Singleton dataset manager object.
 */
Data.DatasetManager = new Utils.ObjectManager();


/**
 * widget class for managing datasets
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
Data.DatasetManagerWidget = function(params){
    this._widget_list = [];
    Widget.call( this, params );
    this.list_id = this.id + '_list';
    var content = '<div>' +
        '<div id="' + this.list_id + '"></div>' +
    '</div>';
    $(this.dom).append( content );
    this.init();
}
Data.DatasetManagerWidget.prototype = Utils.extend(Widget, /** @lends Provi.Data.DatasetManagerWidget.prototype */ {
    init: function(){
        $("#" + this.list_id).empty();
        var self = this;
        $.each( Data.DatasetManager.get_list(), function(){
            self.add( this );
        });
        $( Data.DatasetManager ).bind('add', function(event, dataset){
            self.add( dataset );
        });
    },
    add: function(dataset){
        this._widget_list.push( new Data.DatasetWidget({
            parent_id: this.list_id,
            dataset: dataset
        }));
    }
});



/**
 * Fired when a dataset is changed.
 *
 * @name Provi.Data.Dataset#change
 * @event
 * @param {object} event A jQuery event object.
 */


/**
 * dataset class
 * @constructor
 */
Data.Dataset = function(params){
    params = _.defaults( params, this.default_params );

    var p = [ "raw_data", "name", "url", "type" ];
    _.extend( this, _.pick( params, p ) );

    // can be polluted by other functions for temp storage, i.e.
    // plupload_id for the plupload widget
    this.meta = params.meta;

    this.initialized = false;
    this.loaded = false;

    this.id = Data.DatasetManager.add( this );
    
    this.detect_type();
};
Data.Dataset.prototype = /** @lends Provi.Data.Dataset.prototype */ {
    bio_object: undefined,
    raw_type: false, // [ false, "text", "json" ]
    default_params: {
        name: "unnamed",
    },
    detect_type: function(){
        if( !this.type ){
            // from this.url
            // fallback: dat
        }
        Data.Controller.extend_by_type( this, this.type );
    },
    retrieve_raw_data: function( params ){
        var self = this;
        $.ajax({
            dataType: this.raw_type,
            url: this.url,
            cache: false,
            success: function( d ){
                self.raw_data = d;
                self._init( params );
            },
            error: function(e){ console.error( self, params, e); }
        });
    },
    set_loaded: function(){
        // must be called e.g. when Jmol has finished loading the dataset
        this.loaded = true;
        $(this).triggerHandler("loaded");
    },
    _init: function( params ){
        params.dataset = this;
        this.bio = new this.bio_object( params );
        if( this.bio.delegate ){
            this.type = this.bio.delegate;
            Data.Controller.extend_by_type( this, this.type );
            this._init( params );
        }else{
            this.initialized = true;
            console.log("initialized", this);
            $(this).triggerHandler("initialized");
        }
    },
    init: function( params ){
        if( this.raw_type && !this.raw_data ){
            this.retrieve_raw_data( params );
        }else{
            this._init( params );
        }
    },
};


/**
 * widget class for managing a single dataset
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
Data.DatasetWidget = function(params){
    this.dataset = params.dataset;
    WWidget.call( this, params );
    this._init_eid_manager( ['ds_info', 'load_widget', 'load'] );

    var template = '<div  class="control_group">' +
        '<div class="control_row" id="${eids.ds_info}"></div>' +
        '<div class="control_row" id="${eids.load_widget}"></div>' +
    '</div>'
    this.add_content( template, params );
    
    this.init();
}
Data.DatasetWidget.prototype = Utils.extend(WWidget, /** @lends Provi.Data.DatasetWidget.prototype */ {
    init: function(){
        var self = this;
        this.update();
        $(this.dataset).bind('initialized loaded', function(){
            self.update();
        });
    },
    update: function(){
        var self = this;
        var bgcolor = this.dataset.loaded ? 'lightgreen' : ( this.dataset.initialized ? 'lightsalmon' : 'lightgrey' );

        this.elm("ds_info").empty().append(
            '<div style="background-color: ' + bgcolor + '; margin: 5px; padding: 3px;">' +
                '<div>' + this.dataset.id + '. ' + this.dataset.name + ' (' + this.dataset.type + ')</div>' +
                '<div>Initialized: ' + this.dataset.initialized + '&nbsp;|&nbsp;Ready: ' + this.dataset.loaded + '</div>' +
            '</div>'
        );
        if( this.dataset.params_object && !this.load_params_widget ){
            this.load_params_widget = new this.dataset.params_object({
                parent_id: this.eid("load_widget"),
                dataset: this.dataset
            })
        }
        if( !this._load_button_initialized ){
            this._load_button_initialized = true;
            this.elm("load_widget").append(
                '<button id="' + this.eid("load") + '">load</button>'
            );
            this.elm("load").button().click(function() {
                WWidget.ui_disable_timeout( $(this) );
                
                var params = self.load_params_widget ? self.load_params_widget.params : {};
                params.applet = self.applet_selector.get_value();

                self.dataset.init( params );
            });
        }
    }
});



/**
 * A widget
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
Data.DatasetSelectorWidget = function(params){
    params = _.defaults( params, this.default_params );
    params.persist_on_applet_delete = true;
    
    //params.collapsed = false;
    WWidget.Widget.call( this, params );
    this._init_eid_manager([
        'selector'
    ]);
    
    this.ext_list = params.ext_list
    
    var template = '' +
        '<div>' + 
            '<label for="${eids.selector}">${params.selector_label}:</label>' +
            '<select id="${eids.selector}" class="ui-state-default"></select>' +
        '</div>' +
    '';
    this.add_content( template, params );

    this._init();
}
Data.DatasetSelectorWidget.prototype = Utils.extend(WWidget.Widget, /** @lends Provi.Bio.Structure.StructureWidget.prototype */ {
    default_params: {
        ext_list: [],
        selector_label: 'Dataset'
    },
    _init: function(){
        var self = this;
        $(Data.DatasetManager).bind('change', function(){ self.render(); });
        this.elm('selector').bind('change', function(){ 
            $(self).triggerHandler('change') 
        });
        this.render();
        WWidget.Widget.prototype.init.call(this);
    },
    render: function(){
        var elm = this.elm('selector');
        var value = this.elm('selector').children("option:selected").val();
        elm.empty();
        elm.append( '<option value=""></option>' );
        var ds_list = Data.DatasetManager.get_list({ext_list: this.ext_list});
        _.each(ds_list, function(ds, i){
            var label = ds.id + '. ' + ds.name + ' (' + ds.type + ')';
            elm.append("<option value='" + ds.id + "'>" + label + "</option>");
        });
        elm.val( value );
        if( !_.any( ds_list, function(ds){ return ds.id === value } ) ){
            $(this).triggerHandler('change');
        }
    },
    get_ds: function(){
        var ds_id = this.elm('selector').children("option:selected").val();
        return Data.DatasetManager.get( ds_id );
    }
});




/**
 * Singleton datalist manager object.
 */
Data.DatalistManager = new Utils.ObjectManager();
Data.DatalistManager2 = new Utils.ObjectManager();


Data.Datalist = function(params){
    var p = [ "applet" ];
    _.extend( this, _.pick( params, p ) );

    Data.DatalistManager.add( this, function( datalist ){
        datalist.name = datalist.id + "_" + datalist.type;
    });

    if( params.load_struct ){
        $(this.applet).bind( "load_struct", _.bind( this.calculate, this ) );
    }
    $(this).bind("init_ready", _.bind( this.calculate, this ) );

    if( !params.no_init ) this._init();
}
Data.Datalist.prototype = {
    type: "Datalist",
    handler: {},
    params_object: undefined,
    _init: function(){
        //console.log( this.name, "_init" );
        this.initialized = false;

        if( this.applet.loaded ){
            if( this.jspt_url ){
                var prevent_cache = '?_id=' + (new Date().getTime());
                var s = 'script "' + this.jspt_url + '' + prevent_cache + '";';
                this.applet.script_callback( s, {}, _.bind( this.set_initialized, this ) );
            }else{
                this.set_initialized();
            }
        }else{
            $(this.applet).bind("load", _.bind( this._init, this ))
        }
    },
    set_initialized: function(){
        this.initialized = true;
        $(this).trigger("init_ready");
    },
    calculate: function(){
        this.ready = false;
        if( this.initialized ){
            this.set_ready();
        }
    },
    set_ready: function(){
        this.ready = true;
        $(this).trigger("calculate_ready");
    },
    get_ids: function(){},
    make_row: function(id){
        return id.toString();
    },
    details: function(id){
        $(this).triggerHandler("request_details", [id]);
    },
    make_details: function(id){
        return id.toString();
    },
    update: function(){
        $(this).triggerHandler('update');
    },
    invalidate: function(){
        $(this).triggerHandler('invalidate');
    },
    script: function( s, invalidate, params ){
        _.defaults( params || {}, { 
            maintain_selection: true, 
            try_catch: true 
        });
        if( invalidate ){
            this.applet.script_callback( 
                s, params, _.bind( this.invalidate, this ) 
            );
        }else{
            this.applet.script( s, params );
        }
    }
};


// fill with IsosurfaceDatalist + ParseDatalist + VariableDatalist + ModelindexDatalist
Data.ObjectDatalist = function(params){
    Data.Datalist.call( this, params );
}
Data.ObjectDatalist.prototype = Utils.extend(Data.Datalist, {
    type: "ObjectDatalist",
    get_ids: function(){
        return this.ids;
    },
    get_data: function(id){
        return id[0].get_data.apply( id[o], id[1] );
    },
    make_row: function(id){
        return id[0].make_row.apply( id[o], id[1] );
    }
});



Data.Datalist2 = function(params){
    var p = [ "applet", "sort_column", "sort_dir" ];
    _.extend( this, _.pick( params, p ) );

    Data.DatalistManager2.add( this, function( datalist ){
        datalist.name = datalist.id + "_" + datalist.type;
    });

    if( params.load_struct ){
        $(this.applet).bind( "load_struct", _.bind( this.calculate, this ) );
    }
    $(this).bind("init_ready", _.bind( this.calculate, this ) );

    if( !params.no_init ) this._init();
}
Data.Datalist2.prototype = {
    type: "Datalist",
    handler: {},
    columns: {},
    params_object: undefined,
    _init: function(){
        //console.log( this.name, "_init" );
        this.initialized = false;

        if( this.applet.loaded ){
            console.info("datalist: applet loaded");
            if( this.jspt_url ){
                var prevent_cache = '?_id=' + (new Date().getTime());
                var s = 'script "' + this.jspt_url + '' + prevent_cache + '";';
                console.log( this.name, s, {}, _.bind( this.set_initialized, this ) );
                this.applet.script_callback( s, {}, _.bind( this.set_initialized, this ) );
            }else{
                this.set_initialized();
            }
        }else{
            console.warn("datalist: applet not loaded", this.applet);
            $(this.applet).one("load", _.bind( this._init, this ))
        }
    },
    set_initialized: function(){
        this.initialized = true;
        console.log("init_ready", this.name);
        $(this).trigger("init_ready");
        this.calculate();
    },
    calculate: function(){
        this.ready = false;
        if( this.initialized ){
            this.set_ready();
        }
    },
    set_ready: function(){
        this.ready = true;
        console.log("calculate_ready", this.name);
        $(this).trigger("calculate_ready");
        this.invalidate();
    },
    details: function(id){
        $(this).triggerHandler("request_details", [id]);
    },
    make_details: function(id){
        return id.toString();
    },
    update: function(){
        $(this).triggerHandler('update');
    },
    invalidate: function(){
        console.log("invalidate", this.name);
        $(this).triggerHandler('invalidate');
    },
    script: function( s, invalidate, params ){
        params = _.defaults( params || {}, { 
            maintain_selection: true, 
            try_catch: true 
        });
        if( invalidate ){
            this.applet.script_callback( 
                s, params, _.bind( this.invalidate, this ) 
            );
        }else{
            this.applet.script( s, params );
        }
    },
    DataItem: function( row ){
        console.error( "DataItem not implemented" );
    },
    load_data: function( from, to ){
        console.error( "load_data not implemented" );
    },
    on_grid_creation: function( grid ){},
    get_column: function( grid, name ){
        return grid.getColumns()[ grid.getColumnIndex( name ) ];
    },
    column_action: function( grid, name, d ){
        this.get_column( grid, name ).action( name, d );
    }
};



})();
