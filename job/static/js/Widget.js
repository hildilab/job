/**
 * @fileOverview This file contains the {@link Provi.Widget} Module.
 * @author <a href="mailto:alexander.rose@charite.de">Alexander Rose</a>
 * @version 0.0.1
 */


/**
 * @namespace
 * Widget base
 */
WWidget = {};

(function() {

//var Utils = Provi.Utils;



WWidget.ui_disable_timeout = function( $elm ){
    $elm.attr("disabled", true).addClass('ui-state-disabled');
    setTimeout(function(){
        $elm.attr("disabled", false).removeClass('ui-state-disabled');
    }, 2000);
}

WWidget.params = { 
    hide_file_sele: false
};

/**
 * global widget manager object
 */
WWidget.WidgetManager = 
    new Utils.ObjectManager({ prefix: "widget" });


/**
 * Widget class
 * @constructor
 * @param {object} params The configuration object.
 * @param {string} [params.tag_name="div"] The html tag in which the widget gets enclosed.
 * @param {string} [params.heading] A heading for the widget.
 * @param {boolean} [params.collapsed=false] When the widget has a heading, it can be collapsed.
 * @param {string} params.parent_id The html id of the parent object of this widget
 * @param {int} [params.id] An id to identify the widget. Though in general not neccesary as it is created automatically.
 * @param {Provi.Jmol.Applet} [params.applet] A Jmol applet the widget should get bound to.
 * @param {boolean} [params.persist_on_applet_delete=false] When bound to a Jmol applet, the widget gets automatically destroyed when the applet is destroyed. This flag switches that behavior off.
 */
WWidget.Widget = function(params){
    params = _.defaults( params,WWidget.Widget.prototype.default_params );

    var p = [ 
        "tag_name", "content", "sort_key", "show_dataset_info", "heading", "collapsed",
        "info", "description", "applet", "persist_on_applet_delete", "parent_id"
    ];
    _.extend( this, _.pick( params, p ) );

    this.initialized = false;
    WWidget.WidgetManager.add( this );
    
    this._init_eid_manager([ 'info', 'heading', 'description', 'content', 'close' ]);
    
    if( this.parent_id && $('#' + this.parent_id).length == 0 ){
        throw "Widget parent object (" + this.parent_id + ") does not exist.";
    }
    
    var template = '' +
        '<div class="ui-widget-header ui-state-active" id="${eids.heading}" ' +
                'style="{{if !params.heading}}display:none;{{/if}}">' +
            '<span title="show/hide" class="ui-icon ui-icon-triangle-1-s"></span>' +
            '<span>${params.heading}</span>' +
            '<span style="float:right; padding:0.1em; {{if !params.info}}display:none;{{/if}}">' +
                '<span title="${params.info}" id="${eids.info}" class="ui-icon ui-icon-info">' +
                    '${params.info}' +
                '</span>' +
            '</span>' +
        '</div>' +
        '<div class="my-content">' +
            '<div class="" id="${eids.description}" ' +
                    'style="{{if !params.description}}display:none;{{/if}}">' +
                '${params.description}' +
            '</div>' +
            '{{if params.show_dataset_info && params.dataset && params.applet}}' +
                '<div class="" >' +
                    '<span>Dataset: ${params.dataset.name}</span>&nbsp;|&nbsp;' +
                    '<span>Applet: ${params.applet.name_suffix}</span>' +
                '</div>' +
            '{{/if}}' +
            '<div class="" id="${eids.content}">${params.content}</div>' +
        '</div>' +
    '';
    
    var e = document.createElement( this.tag_name );
    $.tmpl( template, { eids: this.eid_dict, params: params } ).appendTo(e);
    e.id = this.id;

    /** The dom object */
    this.dom = e;
    if( params.hidden ) this.hide();
    $(this.dom).addClass( 'ui-container ui-widget' );

    if( this.parent_id ){
        $('#' + this.parent_id).append( e );
    }else{
        $('#temp').append( e );
        return e;
    }
};
WWidget.Widget.prototype = {
    default_params: {
        tag_name: 'div',
        content: '',
        sort_key: 1000000,
        show_dataset_info: false
    },
    init: function(){
        // must be called in the subclasses of Widget

        this.elm('info').qtip({ 
            position: {my: 'top center', at: 'bottom center'} 
        });
        
        var heading = this.elm( 'heading' );
        heading.hover(function(){
            $(this).toggleClass('ui-state-hover');
        });
        heading.children('[title]').qtip({ 
            position: {my: 'top center', at: 'bottom center'} 
        });
        heading.click(function() {
            $(this).siblings().toggle();
            $(this).children('.ui-icon')
                .toggleClass('ui-icon-triangle-1-e')
                .toggleClass('ui-icon-triangle-1-s');
            $(this).toggleClass('ui-state-active ui-state-default');
            return false;
        });
        if( this.heading && this.collapsed ){
            heading.triggerHandler('click');
            heading.siblings().toggle(false);
        }
        
        if( !this.heading ) this.elm( 'heading' ).hide();
        if( !this.info ) this.elm( 'info' ).hide();
        if( !this.description ) this.elm( 'description' ).hide();
        
        if(this.applet && !this.persist_on_applet_delete){
            $(this.applet).bind('delete', _.bind( this.del, this ) );
        }

        this.initialized = true;
        $(this).triggerHandler('init');
        WWidget.WidgetManager.change();
    },
    del: function(){
        $(this.dom).hide();
        $(this.dom).appendTo('#trash');
    },
    set_heading: function( heading ){
        this.elm( 'heading' ).children()
            .first().next().text( heading ).show();
    },
    set_description: function( description ){
        this.elm( 'description' ).text( description ).show();
    },
    set_info: function( info ){
        this.elm( 'info' ).text( info ).show();
    },
    set_content: function( content ){
        this.elm( 'content' ).innerHTML( content );
    },
    add_content: function( template, params ){
        var e = this.elm( 'content' );
        $.tmpl( template, { eids: this.eid_dict, params: params } )
            .appendTo( e );
    },
    /**
    * Helper function to create unique ids for dom elements 
    * that belong to the widget.
    * The ids are build for each name in names from 
    * the following template: this.id + '_' + name.
    * 
    * @param {array} names An array containing the names to create ids for.
    * @returns {void}
    */
    _build_element_ids: function( names ){
        console.error( "_build_element_ids", "deprecated" );
        _.each( names, function( name ){
            this[ name + '_id' ] = this.id + '_' + name;
        }, this );
    },
    _init_eid_manager: function( eid_list ){
        this.add_eids( eid_list );
    },
    add_eids: function( eid_list ){
        var eid_dict = {};
        _.each( eid_list, function( eid, x ){
            eid_dict[eid] = this.id + '_' + eid;
        }, this );
        this.eid_dict = _.extend( this.eid_dict || {}, eid_dict );
    },
    eid: function( name, selector ){
        if( !this.eid_dict[ name ] ) throw "Eid '" + name + "' not found.";
        return ( selector ? '#' : '' ) + this.eid_dict[ name ];
    },
    elm: function( name ){
        return $( '#' + this.eid( name ) );
    },
    show: function(){
        $(this.dom).show();
    },
    hide: function(){
        $(this.dom).hide();
    },
    block: function( params ){
        if(this._blocked) return;
        this._blocked = true;
        params = $.extend({
            message: 'loading...'
        }, params);
        $(this.dom).block( params );
    },
    unblock: function(){
        this._blocked = false;
        $(this.dom).unblock();
    }
};
var Widget = WWidget.Widget;




WWidget.form_builder = function( params, value, id, self ){
    
    var p = params;
    var $elm = $('<div></div>');

    if( p.type=="float" ){
        value = parseFloat( value );
    }else if( p.type=="int" ){
        value = parseInt( value );
    }

    if( _.isNaN( value ) ) value = "";

    if( p.options ){

        $elm.append(
            $('<select class="ui-state-default" name="' + id + '">' +
                _.map( p.options, function( o, l ){
                    var label = _.isNumber(o) ? o : _.str.humanize( o )
                    if( !_.isArray( p.options ) ) label = l;
                    if( p.value=="float" ) o = o.toFixed( p.fixed || 2 );
                    return '<option value="' + o + '">' + label + '</option>'
                }) +
            '</select>')
                .data( 'id', id )
                .val( value )
                .bind( 'change', _.bind( self.set, self )),
            '&nbsp;<label>' + _.str.humanize( id ) + '</label>'
        );

    }else if( p.range && _.contains([ "float", "int" ], p.type) ){

        if( _.isNaN(value) ){
            value = p.range[0];
        }
        $elm.append( 
            (function(){
                var handle, slider, input;
                input = $('<input type="hidden" name="' + id + '" />').val( value );
                slider = $('<div style="display:inline-block; margin-left: 0.6em; width:120px;"></div>')
                    .slider({ 
                        min: p.range[0], max: p.range[1], value: value, 
                        step: p.step ? p.step : 1
                    })
                    .data( 'id', id )
                    .bind( 'slidestop slide', function(e, ui){
                        handle.qtip(
                            'option', 'content.text', ui.value
                        );
                        input.val( $(e.currentTarget).slider("value") );
                        _.bind( self.set, self )(e);
                    });
                handle = $('.ui-slider-handle', slider);
                handle.qtip({
                    content: '' + slider.slider('option', 'value'),
                    position: { my: 'bottom center', at: 'top center' },
                    hide: { delay: 100 }
                });
                return slider.append(input);
            })(),
            '<label>' + _.str.humanize( id ) + '</label>'
        );

    }else if( p.type=="bool" ){

        $elm.append(
            $('<input type="checkbox" name="' + id + '" />')
                .data( 'id', id )
                .prop( 'checked', value )
                .click( _.bind( self.set, self ) ),
            '&nbsp;<label>' + _.str.humanize( id ) + '</label>'
        );

    }else if( _.contains([ "str", "sele", "float", "int" ], p.type) ){

        $elm.append(
            $('<input type="text" name="' + id + '" />')
                .data( 'id', id )
                .val( value )
                .blur( _.bind( self.set, self ) ),
            '&nbsp;<label>' + _.str.humanize( id ) + '</label>'
        );

    }else if( p.type=="file" ){

        $elm.append(
            $('<input type="file" name="' + id + '" />')
                .data( 'id', id )
                .blur( _.bind( self.set, self ) ),
            '&nbsp;<label>' + _.str.humanize( id ) + '</label>'
        );

        if( p.ext=="pdb" ){
            var id2 = '__sele__' + id;
            var $sele = $('<input type="text" name="' + id2 + '" />');
            if( WWidget.params.hide_file_sele ) $sele.hide();
            $elm.append(
                $sele.data( 'id', id2 )
                    .val( value || "*" )
                    .blur( _.bind( self.set, self ) ),
                '&nbsp;<label>Selection</label>'
            );
        }

    }else if( p.type=="color" ){

        var e = $('<input type="text" name="' + id + '" />')
            .data( 'id', id )
            .change( _.bind( self.set, self ) );

        $elm.append(
            e,
            '&nbsp;<label>' + _.str.humanize( id ) + '</label>'
        );

        e.colorPicker();

    }else{
        $elm.append( _.str.humanize( id ) );
        console.error( "Unknown form type '" + p.type + "'" );
    }

    return $elm;
}



WWidget.form_parser = function( elm, id, p ){
    var value = '';
    if( p.options ){
        value = elm.children("option:selected").val();
    }else if( _.contains(["float", "int"], p.type) && p.range ){
        value = elm.slider("value");
        // make sure it's a float
        if( p.step ){
            value = value.toFixed( 
                Math.log(1/p.step)/Math.log(10)
            );
        }
    }else if( p.type=="bool" ){
        value = elm.is(':checked');
    }else if( p.type=="float" ){
        value = parseFloat( elm.val() );
    }else if( p.type=="int" ){
        value = parseInt( elm.val() );
    }else if( _.contains([ "str", "sele" ], p.type) ){
        value = elm.val();
    }else if( p.type=="color" ){
        console.log( elm, id, p );
        value = elm.val();
    }
    return value;
}



/**
 * A widget to select params
 * @constructor
 */
WWidget.ParamsWidget = function(params){
    params = _.defaults( params, this.default_params );
    WWidget.Widget.call( this, params );

    this.params = {};

    _.each( this.params_dict, function( p, id ){
        var elm = WWidget.form_builder( 
            p, params[id] || p['default'], id, this
        );
        this.elm( 'content' ).append( elm );
        this.params[ id ] = p['default'];
    }, this);
}
WWidget.ParamsWidget.prototype = Utils.extend(Widget, {
    set: function(e){
        var elm = $(e.currentTarget);
        var id = elm.data('id');
        var p = this.params_dict[ id ] || {};
        this.params[ id ] = WWidget.form_parser( elm, id, p );
        $(this).triggerHandler("change", id);
    },
    params_dict: {}
});



/**
 * A menu widget
 * @constructor
 */
WWidget.MenuWidget = function(params){
    params = _.defaults( params, this.default_params );
    WWidget.Widget.call( this, params );

    this.params = {};

    _.each( this.menu_dict, function( p, id ){
        
    }, this);
}
WWidget.MenuWidget.prototype = Utils.extend(Widget, {
    func: function(e){
        
    },
    menu_dict: {}
});



/**
 * A widget
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
WWidget.StoryWidget = function(params){
    params = _.defaults( params, this.default_params );
    params.collapsed = false;
    WWidget.Widget.call( this, params );
    this._init_eid_manager([
        
    ]);

    var p = [ "buttons" ];
    _.extend( this, _.pick( params, p ) );
    
    if( this.templates.hasOwnProperty( params.template ) ){
        params.template = this.templates[ params.template ];
    }
    
    this.add_content( params.template, params.data );
    
    this._init();
    this._init_buttons();
}
WWidget.StoryWidget.prototype = Utils.extend(WWidget.Widget, /** @lends Provi.Widget.StoryWidget.prototype */ {
    default_params: {
        
    },
    templates: {
        
    },
    _init: function(){
        WWidget.Widget.prototype.init.call(this);
    },
    _init_buttons: function(){
        var e = this.elm( 'content' );
        _.each( this.buttons, function( v, k ){
            var btn = $('<button>' + v.label + '</button>')
                .button()
                .click( _.bind( this.script, this, v.script ) );
            var div = $('<div></div>');
            btn.appendTo( div );
            div.appendTo( e );
        }, this);
    },
    script: function( s ){
        if( !this.applet || !s ) return;
        this.applet.script( 
            s, { maintain_selection: true, try_catch: true }
        );
    }
});




/**
 * A popup widget
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
WWidget.PopupWidget = function(params){
    params = _.defaults( params, this.default_params );

    WWidget.Widget.call( this, params );
    this._init_eid_manager([ 'data', 'close' ]);

    var p = [ "position_my", "position_at" ];
    _.extend( this, _.pick( params, p ) );
    /** The template that gets filled with changeing data */
    this.template = $.template( params.template );
    
    var template = '' +
        '<span title="close" id="${eids.close}" class="ui-icon ui-icon-close" style="float:right;"></span>' +
        '<div id="${eids.data}"></div>' +
    '';
    this.add_content( template, params );

    $(this.dom).css({ 
        'position': 'absolute', 'width': '300px', 
        'background-color': 'lightblue', 'padding': '7px',
        'z-index': '10000'
    });

    this._init();
};
WWidget.PopupWidget.prototype = Utils.extend(Widget, {
    default_params: {
        template: '',
        position_my: 'left top',
        position_at: 'bottom'
    },
    _init: function(){
        $(this.dom).hide();
        this.elm('close')
            .qtip({ position: {my: 'top center', at: 'bottom center'} })
            .click( _.bind( this.hide, this ) );
        Widget.prototype.init.call(this);
    },
    show: function( target, data, template, position_my, position_at ){
        if( data ){
            this.elm('data').empty();
            this.set_data( data, template );
        }
        //console.log( target, position_my, position_at, this.position_my, this.position_at );
        $(this.dom).show();
        // TODO FIX arose
        // for an unknown reason this needs to be called twice 
        // to be visible after the very first call to show
        this.set_position( target, position_my, position_at );
        this.set_position( target, position_my, position_at );
    },
    hide: function(){
        this.elm('data').empty();
        $(this.dom).hide();
    },
    set_data: function( data, template ){
        this.data = data || {};
        $.tmpl( template || this.template, this.data ).appendTo( this.eid('data', true) );
    },
    set_position: function( target, position_my, position_at ){
        $(this.dom).position({
            of: target,
            my: position_my || this.position_my,
            at: position_at || this.position_at
        });
    },
    empty: function(){
        this.elm('data').empty();
    }
});





/**
 * widget class for managing widgets
 * @constructor
 * @extends Provi.Widget.Widget
 * @param {object} params Configuration object, see also {@link Provi.Widget.Widget}.
 */
WWidget.WidgetManagerWidget = function(params){
    WWidget.WidgetManagerWidget.change(this.update, this);
    Widget.call( this, params );
    this.list_id = this.id + '_list';
    var content = '<div class="control_group">' +
        '<div id="' + this.list_id + '"></div>' +
    '</div>';
    $(this.dom).append( content );
    this.update();
}
WWidget.WidgetManagerWidget.prototype = Utils.extend(WWidget.Widget, /** @lends Provi.Widget.WidgetManagerWidget.prototype */ {
    update: function(){
        var elm = $("#" + this.list_id);
        elm.empty();
        $.each( WWidget.WidgetManager.get_list(), function(){
            var status = this.get_status();
            elm.append(
                '<div class="control_row" style="background-color: lightorange; margin: 5px; padding: 3px;">' +
                    '<div>ID: ' + this.id + '</div>' +
                    '<div>Type: ' + this.type + '</div>' +
                '</div>'
            );
        });
        //$('#'+this.list_id).load('../../data/index/', function() {
        //    console.log('data list loaded');
        //});
    }
});


})();

