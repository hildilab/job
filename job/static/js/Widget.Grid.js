/**
 * @fileOverview This file contains the {@link Widget} Module.
 * @author <a href="mailto:alexander.rose@charite.de">Alexander Rose</a>
 * @version 0.0.1
 */


/**
 * @namespace
 * Widget base
 */
var Grid = {};

(function() {






Grid.RowWidget = function(params){

}



/**
 * A widget
 * @constructor
 * @extends Widget.Widget
 * @param {object} params Configuration object, see also {@link Widget.Widget}.
 */
Grid.GridWidget = function(params){
    this.invalidate = _.throttle( this._invalidate, 500, false );
    params = _.defaults( params, this.default_params );

    WWidget.Widget.call( this, params );

    this._init_eid_manager([ 
        'grid', 'update', 'widgets', 'calc', 'init', 'selector', 
        'details', 'applet'
    ]);
    
    var p = [ "datalist", "datalist_list" ];
    _.extend( this, _.pick( params, p ) );

    var template = '' +
        '<div class="control_row">' +
            '<button id="${eids.update}">update</button>&nbsp;' +
            '<button id="${eids.calc}">calc</button>&nbsp;' +
            '<button id="${eids.init}">init</button>&nbsp;' +
        '</div>' +
        '<div class="control_row" id="${eids.selector}"></div>' +
        '<div class="control_row" id="${eids.widgets}"></div>' +
        '<div class="control_row">' +
            '<div style="height:${params.grid_height};" id="${eids.grid}"></div>' +
        '</div>' +
        '<div class="control_row" id="${eids.details}"></div>' +
    '';
    this.add_content( template, params );

    this._init();
}
Grid.GridWidget.prototype = Utils.extend(WWidget.Widget, /** @lends Widget.Grid.GridWidget.prototype */ {
    default_params: {
        heading: 'Grid',
        collapsed: false,
        persist_on_applet_delete: false,
        lists: [],
        grid_height: "500px"
    },
    _init: function(){

        if( this.datalist_list=="all" ){
            $( Data.DatalistManager )
                .bind( "add", _.bind( this.init_selector, this ) );
        }else if( this.datalist_list ){
            this.datalist_list = [ this.datalist ].concat( this.datalist_list );
            this.init_selector();
        }else{
            this.elm("selector").hide();
        }

        this.create_grid();
        this.init_datalist();

        var self = this;
        this.elm('update').button().click( _.bind( this.update_grid, this ) );
        this.elm('calc').button().click( function(){ self.datalist.calculate() } );
        this.elm('init').button().click( function(){ self.datalist._init( self ) } );
        
        WWidget.Widget.prototype.init.call(this);
    },
    set: function(e){
        var elm = $(e.currentTarget);
        var id = elm.data('id');
        if( id=="DatalistSelector" ){
            var datalist_id = elm.children("option:selected").val().split("_")[0];
            this.datalist = Data.DatalistManager.get( datalist_id );
            this.init_datalist();
        }
    },
    init_selector: function(){
        var dl_list = this.datalist_list;
        if( dl_list=="all" ){
            dl_list = Data.DatalistManager.get_list();
        }
        var p = { type: "select", options: _.pluck( dl_list, "name" ) };
        var select = WWidget.form_builder( p, "", "DatalistSelector", this );
        this.elm("selector").empty().show().append( select );
    },
    create_grid: function(){
        var self = this;

        var render_row = function(cellNode, row, dataContext, colDef) {
            var row = self.datalist.make_row( dataContext.id );
            $(cellNode).empty().append( row );
        }
        
        var columns = [{ 
            id:"id", name:"Id", field:"id", width:320,
            rerenderOnResize: true,
            asyncPostRender: render_row
        }];
        
        var options = {
            enableCellNavigation: false,
            enableColumnReorder: false,
            enableAsyncPostRender: true,
            asyncPostRenderDelay: 1,
            showHeaderRow: true,
            headerRowHeight: 25,
            topPanelHeight: 25,
            autoHeight: false
        };
        
        this.grid = new Slick.Grid( this.eid('grid', true), [], columns, options);
    },
    _invalidate: function(){
        this.grid.invalidate();
        this.header();
        this.show_details();
        this.grid.resizeCanvas();
    },
    header: function(){
        var header = this.grid.getHeaderRowColumn('id');
        $(header).empty().append(
            this.datalist.make_row('all')
        );
        $(header).css('padding', '1px 3px 2px 1px');
    },
    show_details: function(id){
        console.log("show_details", id);
        if( _.isUndefined(id) ){
            if( _.isUndefined(this.details_id) ) return;
            id = this.details_id;
        }
        this.details_id = id;
        var details = this.datalist.make_details( id );
        this.elm('details').empty().append( details );
    },
    init_datalist: function(){

        var datalist = this.datalist;

        if( !datalist || !datalist.ready ){
            $(datalist).bind("calculate_ready", _.bind( this.init_datalist, this ) );
            return;
        }

        // listen for changes
        $(datalist).bind('update', _.bind( this.update_grid, this ) );
        $(datalist).bind('invalidate', _.bind( this.invalidate, this ) );
        $(datalist).bind('request_details', _.bind( function(e, id){ this.show_details(id) }, this ) );

        // params widget
        this.elm("widgets").empty();
        if( datalist.params_object ){
            this.datalist_params = new datalist.params_object(
                _.extend({
                    parent_id: this.eid("widgets"),
                    datalist: datalist
                }, datalist.params)
            );
            $(this.datalist_params).bind("change", _.bind( function(){ 
                _.extend( datalist, this.datalist_params.params );
                this.update_grid(); 
            }, this) );
        }

        // register handlers
        this.elm('grid').off( 'click.grid' );
        _.each( datalist.handler, function(d, i){
            this.elm('grid').on( 'click.grid', d["selector"], function(e){
                var elm = $(e.currentTarget);
                elm.qtip('hide');
                var id = elm.data("id");
                var flag = !elm.prop('checked');
                d["click"].apply( datalist, [ id, flag ]);
            });

            if( !_.isFunction(d["label"]) ){
                var label = d["label"];
                d["label"] = function(value, id){
                    var l = label ? ' ' + label : '';
                    if( id==='all' ){
                        l = ' all' + ( l ? _.pluralize( l ) : '' );
                    }
                    return (value ? 'Hide' : 'Show') + l;
                }
            }

            this.elm('grid').on( 'mouseover', d["selector"], function(e){
                var elm = $(e.originalEvent.target);
                elm.qtip({
                    overwrite: false,
                    content: '?',
                    position: { my: 'top left', at: 'bottom center' },
                    show: { event: event.type, ready: true }
                }, e);
                elm.qtip('option', 'content.text', d["label"]( elm.prop('checked'), elm.data("id") ) );
            });
        }, this);

        this.update_grid();
    },
    update_grid: function(){
        var ids = this.datalist.get_ids();
        var data = _.map( ids, function(val){ return { id: val } });
        // console.log( this.datalist.name, "update_grid", data );
        this.grid.setData( data );
        this.grid.updateRowCount();
        this.grid.render();
        this.header();
        this.grid.resizeCanvas();
    }
});


Grid.CellFactory = function( p ){
    p.color = p.color || "none";
    p.position = p.position || "right";
    return function(id, value, disabled){
        var $elm = $(
            '<span style="background:' + p.color + '; float:' + p.position + '; width:22px;">' +
                '<input cell="' + p.name + '" type="checkbox" ' + 
                    ( disabled ? 'disabled="disabled" ' : '') +
                    ( value ? 'checked="checked" ' : '' ) + 
                '/>' +
            '</span>'
        );
        $elm.children().prop( 'indeterminate', value > 0.0 && value < 1.0 );
        $elm.children().data( 'id', id );
        return $elm;
    }
}




Grid.GridWidget2 = function(params){
    this.invalidate = _.throttle( this._invalidate, 500, false );
    // this.invalidate = this._invalidate;
    params = _.defaults( params, this.default_params );

    WWidget.Widget.call( this, params );

    this._init_eid_manager([ 
        'grid', 'update', 'widgets', 'calc', 'init', 'selector', 
        'details', 'applet', 'debug'
    ]);
    
    var p = [ "datalist", "datalist_list" ];
    _.extend( this, _.pick( params, p ) );

    var template = '' +
        '<div id="${eids.debug}" class="control_row">' +
            '<button id="${eids.update}">update</button>&nbsp;' +
            '<button id="${eids.calc}">calc</button>&nbsp;' +
            '<button id="${eids.init}">init</button>&nbsp;' +
        '</div>' +
        '<div class="control_row" id="${eids.selector}"></div>' +
        '<div class="control_row" id="${eids.widgets}"></div>' +
        '<div class="control_row">' +
            '<div style="height:${params.grid_height};" id="${eids.grid}" class="grid"></div>' +
        '</div>' +
        '<div class="control_row" id="${eids.details}"></div>' +
    '';
    this.add_content( template, params );

    if( !params.debug ){
        this.elm('debug').hide();
    }

    this._init();
}
Grid.GridWidget2.prototype = Utils.extend(WWidget.Widget, {
    default_params: {
        heading: 'Grid',
        collapsed: false,
        persist_on_applet_delete: false,
        lists: [],
        debug: true,
        grid_height: "500px"
    },
    _init: function(){
        if( this.datalist_list=="all" ){
            $( Data.DatalistManager2 )
                .bind( "add", _.bind( this.init_selector, this ) );
            this.init_selector();
        }else if( this.datalist_list ){
            this.datalist_list = [ this.datalist ].concat( this.datalist_list );
            this.init_selector();
        }else{
            this.elm("selector").hide();
        }

        this.create_grid();

        this._popup = new WWidget.PopupWidget({
            parent_id: this.parent_id,
            position_my: 'right center',
            position_at: 'left center',
            template: '<div>{{html content}}</div>'
        });

        var self = this;
        this.elm('update').button().click( _.bind( this.update_grid, this ) );
        this.elm('calc').button().click( function(){ self.datalist.calculate(); } );
        //this.elm('init').button().click( function(){ self.datalist._init( self ); } );
        this.elm('init').button().click( _.bind( this.create_grid, this ) );

        WWidget.Widget.prototype.init.call(this);

        // needs to come after Widget.init so the binding is executed after
        // the grid is made visible
        this.elm( 'heading' ).click( _.bind( this.update_grid, this ) );
    },
    set: function(e){
        var elm = $(e.currentTarget);
        var id = elm.data('id');
        if( id=="DatalistSelector" ){
            var datalist_id = elm.children("option:selected").val().split("_")[0];
            this.datalist = Data.DatalistManager2.get( datalist_id );
            this.create_grid();
        }
    },
    init_selector: function(){
        var dl_list = this.datalist_list;
        if( dl_list=="all" ){
            dl_list = Data.DatalistManager2.get_list();
        }
        var p = { type: "select", options: _.pluck( dl_list, "name" ) };
        var name = this.datalist ? this.datalist.name : ""
        var select = WWidget.form_builder( p, name, "DatalistSelector", this );
        this.elm("selector").empty().show().append( select );
    },
    create_grid: function(){
        var grid;
        var loader = this.loader = new Slick.Data.DatalistModel({
            DataItem: this.datalist.DataItem,
            loadData: _.bind( this.datalist.load_data, this.datalist )
        });

        var columns = this.datalist.columns;

        var options = {
            rowHeight: 24,
            editable: false,
            enableAddRow: false,
            enableCellNavigation: true,
            enableColumnReorder: false,
        };

        if( this.grid ) this.grid.destroy();
        this.grid = grid = new Slick.Grid(
            this.eid("grid", true), loader.data, columns, options
        );
        this.elm("grid").data( "gridInstance", grid );

        this.elm("grid").on( 'mouseup', _.bind( function(e){
            var cell = grid.getCellFromEvent(e);
            if( !cell ) return;
            var col = columns[ cell.cell ];
            var id = col.id;
            var d = grid.getDataItem( cell.row );
            if( _.isFunction( col.action ) ){
                col.action.call( this.datalist, id, d, this, e );
            }
        }, this ) );

        grid.onViewportChanged.subscribe(function (e, args) {
            var vp = grid.getViewport();
            // console.log("onViewportChanged", vp, vp.top, vp.bottom );
            loader.ensureData(vp.top, vp.bottom);
        });

        loader.onDataLoaded.subscribe(function (e, args) {
            for (var i = args.from; i <= args.to; i++) {
                grid.invalidateRow(i);
            }
            grid.updateRowCount();
            grid.render();
        });

        grid.onSort.subscribe(function (e, args) {
            //grid.setSelectedRows([]);
            loader.setSort(
                args.sortCol.field, args.sortAsc ? "ASC" : "DESC"
            );
            var vp = grid.getViewport();
            loader.ensureData(vp.top, vp.bottom);
        });

        grid.registerPlugin( 
            new Slick.AutoTooltips({ enableForHeaderCells: true })
        );

        if( this.datalist.sort_column ){
            var sortAsc = this.datalist.sort_dir==="ASC";
            grid.setSortColumn( this.datalist.sort_column, sortAsc );
            loader.setSort( 
                this.datalist.sort_column,
                sortAsc ? "ASC" : "DESC"
            );
        }

        this.init_datalist();
    },
    _invalidate: function(){
        this.loader.clear();
        var vp = this.grid.getViewport();
        console.log("_invalidate", vp, vp.top, vp.bottom );
        this.loader.ensureData( vp.top, vp.bottom );
    },
    init_datalist: function(){
        console.log("init_datalist", this.datalist);
        var datalist = this.datalist;

        $(datalist).unbind();

        if( !datalist || !datalist.ready ){
            console.warn( "datalist not ready" );
            $(this.datalist).one("calculate_ready", _.bind( this.init_datalist, this ) );
            return;
        }

        // listen for changes
        $(datalist).bind('update', _.bind( this.update_grid, this ) );
        $(datalist).bind('invalidate', _.bind( this._invalidate, this ) );
        $(datalist).bind('request_details', _.bind( function(e, id){ this.show_details(id) }, this ) );
        console.log( "ODNONOSNCSAO", datalist.name );

        // params widget
        this.elm("widgets").empty();
        if( datalist.params_object ){
            this.datalist_params = new datalist.params_object(
                _.extend({
                    parent_id: this.eid("widgets"),
                    datalist: datalist
                }, datalist.params)
            );
            $(this.datalist_params).bind("change", _.bind( function(){ 
                _.extend( datalist, this.datalist_params.params );
                this.update_grid(); 
            }, this) );
        }

        this.grid.onViewportChanged.notify();
        this.datalist.on_grid_creation( this.grid );
        
        this.update_grid();
    },
    update_grid: function(){
        this.invalidate();
        this.grid.resizeCanvas();
    }
});




Grid.formatter_checkbox = function( row, cell, value, columnDef, dataContext ){
    value = _.isBoolean(value) ? value : parseFloat( value );
    if( value===1.0 || value===true ){
        var icon = "fa-check-square-o";
    }else if( value===0.0 || value===false ){
        var icon = "fa-square-o";
    }else{
        var icon = "fa-minus-square-o";
    }
    return '<i class="fa ' + icon + '"></i>';
};

Grid.formatter_radio = function( row, cell, value, columnDef, dataContext ){
    value = parseFloat( value );
    var icon = value ? "fa-dot-circle-o" : "fa-circle-o";
    return '<i class="fa ' + icon + '"></i>';
};

Grid.FormatterIconFactory = function( icon ){
    return function( row, cell, value, columnDef, dataContext ){
        var ico = icon;
        if( _.isFunction( icon ) ){
            ico = icon( row, cell, value, columnDef, dataContext );
        }
        return '<i class="fa fa-' + ico + '"></i>';
    };
}

Grid.formatter_color = function( row, cell, value, columnDef, dataContext ){
    var color = value || [0,0,0];
    var bg = "background-color:rgb(" + color.join(',') + ");";
    return "<span style='float:right; width:100%; " + bg + "'>&nbsp;</span>"; 
};

Grid.formatter_verbatim = function( row, cell, value, columnDef, dataContext ){
    return '<span style="font-family:monospace;">' + value + '</span>';
};

Grid.formatter_displayed = function( row, cell, value, columnDef, dataContext ){
    value = _.isBoolean(value) ? value : parseFloat( value );
    var style = "";
    if( value===1.0 || value===true ){
        var icon = "fa-eye";
    }else if( value===0.0 || value===false ){
        var icon = "fa-eye";
        style = "color:grey;";
    }else{
        var icon = "fa-eye-slash";
    }
    return '<i class="fa ' + icon + '" style="' + style + '"></i>';
};

Grid.ActionDeleteFactory = function( fn ){
    return function( id, d, grid_widget, e ){
        var elm = $(e.target);
        if( elm.css('color')=='rgb(255, 0, 0)' ){
            fn( id, d, grid_widget, e );
        }else{
            elm.css('color', 'red');
            setTimeout( function(){ 
                elm.css('color','rgb(34, 34, 34)');
            }, 2000);
        }
    };
}

Grid.ActionPopupFactory = function( widget, params_fn ){
    return function( id, d, grid_widget, e ){
        var elm = $(e.target);
        grid_widget._popup.empty();
        var params = {};
        if( _.isFunction( params_fn ) ){
            params = params_fn( id, d, grid_widget, e ) || {};
        }
        params["parent_id"] = grid_widget._popup.eid('data');
        var w = new widget( params );
        grid_widget._popup.show( elm );
    };
}


})();







(function ($) {


function DatalistModel( params ) {
    // private
    var PAGESIZE = 50;
    var data = {length: 0};
    var searchstr = "";
    var sortcol = null;
    var sortdir = "ASC";

    var DataItem = params.DataItem;
    var loadData = params.loadData;

    // events
    var onDataLoading = new Slick.Event();
    var onDataLoaded = new Slick.Event();


    function init() {
    }

    function isDataLoaded(from, to) {
        for (var i = from; i <= to; i++) {
            if (data[i] == undefined || data[i] == null) {
                return false;
            }
        }
        return true;
    }

    function clear() {
        for (var key in data) {
            delete data[key];
        }
        data.length = 0;
    }

    function ensureData(from, to) {
        // console.log("ensureData", from, to);
        if (from < 0) {
            from = 0;
        }

        if (data.length > 0) {
            to = Math.min(to, data.length - 1);
        }

        var fromPage = Math.floor(from / PAGESIZE);
        var toPage = Math.floor(to / PAGESIZE);

        while (data[fromPage * PAGESIZE] !== undefined && fromPage < toPage)
            fromPage++;

        while (data[toPage * PAGESIZE] !== undefined && fromPage < toPage)
            toPage--;

        if (fromPage > toPage || ((fromPage == toPage) && data[fromPage * PAGESIZE] !== undefined)) {
            // TODO:  look-ahead
            onDataLoaded.notify({from: from, to: to});
            return;
        }

        for (var i = fromPage; i <= toPage; i++)
            data[i * PAGESIZE] = null; // null indicates a 'requested but not available yet'

        onDataLoading.notify({from: from, to: to});

        var resp = loadData( 
            fromPage * PAGESIZE, 
            (toPage * PAGESIZE) + PAGESIZE-1,
            sortcol, sortdir
        );

        if( resp===null ){
            onError( fromPage, toPage );
        }else{
            onSuccess( resp );
        }
    }

    function onError(fromPage, toPage) {
        console.error(
            "error loading pages " + fromPage + " to " + toPage
        );
    }

    function onSuccess(resp) {
        var from = resp.start;
        var to = from + resp.results.length;
        data.length = resp.hits
        for (var i = 0; i < resp.results.length; i++) {
            data[from + i] = new DataItem( resp.results[i] );
            data[from + i].index = from + i;
        }
        onDataLoaded.notify({from: from, to: to});
    }

    function reloadData(from, to) {
        for (var i = from; i <= to; i++)
            delete data[i];
        ensureData(from, to);
    }

    function setSort(column, dir) {
        sortcol = column;
        sortdir = dir=="DESC" ? "DESC" : "ASC";
        clear();
    }

    function setSearch(str) {
        searchstr = str;
        clear();
    }


    init();

    return {
        // properties
        "data": data,

        // methods
        "clear": clear,
        "isDataLoaded": isDataLoaded,
        "ensureData": ensureData,
        "reloadData": reloadData,
        "setSort": setSort,
        "setSearch": setSearch,

        // events
        "onDataLoading": onDataLoading,
        "onDataLoaded": onDataLoaded
    };
}

// Slick.Data.DatalistModel
$.extend(true, window, {
    Slick: { Data: { DatalistModel: DatalistModel } }
});


})(jQuery);

