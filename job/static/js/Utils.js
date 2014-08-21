/**
 * @fileOverview This file contains the {@link Provi.Utils} Module.
 * @author <a href="mailto:alexander.rose@charite.de">Alexander Rose</a>
 * @version 0.0.1
 */



/**
 * jQuery.fn.sortElements
 * --------------
 * @param Function comparator:
 *   Exactly the same behaviour as [1,2,3].sort(comparator)
 *   
 * @param Function getSortable
 *   A function that should return the element that is
 *   to be sorted. The comparator will run on the
 *   current collection, but you may want the actual
 *   resulting sort to occur on a parent or another
 *   associated element.
 *   
 *   E.g. $('td').sortElements(comparator, function(){
 *      return this.parentNode; 
 *   })
 *   
 *   The <td>'s parent (<tr>) will be sorted instead
 *   of the <td> itself.
 */
jQuery.fn.sortElements = (function(){
 
    var sort = [].sort;
 
    return function(comparator, getSortable) {
 
        getSortable = getSortable || function(){return this;};
 
        var placements = this.map(function(){
 
            var sortElement = getSortable.call(this),
                parentNode = sortElement.parentNode,
 
                // Since the element itself will change position, we have
                // to have some way of storing its original position in
                // the DOM. The easiest way is to have a 'flag' node:
                nextSibling = parentNode.insertBefore(
                    document.createTextNode(''),
                    sortElement.nextSibling
                );
 
            return function() {
 
                if (parentNode === this) {
                    throw new Error(
                        "You can't sort elements if any one is a descendant of another."
                    );
                }
 
                // Insert before flag:
                parentNode.insertBefore(this, nextSibling);
                // Remove flag:
                parentNode.removeChild(nextSibling);
 
            };
 
        });
 
        return sort.call(this, comparator).each(function(i){
            placements[i].call(getSortable.call(this));
        });
 
    };
 
})();


/**
 * @namespace
 * Provi utils module
 */
var Utils = {};


(function() {



Utils.ObjectManager = function( params ){
    params = _.defaults( params || {}, this.default_params );
    _.extend( this, _.pick( params, [ 'prefix' ] ) );

    this._dict = {};
    this._list = [];
    this._counter = 0;
}
Utils.ObjectManager.prototype = {
    default_params: {
        prefix: ''
    },
    add: function( obj, fn ){
        this._counter += 1;
        this._list.push( obj );
        obj.id = this.prefix + this._counter.toString();
        this._dict[ obj.id ] = obj;
        if( fn ) fn( obj );
        $(this).triggerHandler('add', [obj]);
        return this._counter;
    },
    get_list: function( params ){
        if( params && params.name_list ){
            return _.filter( this._list, function(dl, i){
                return _.include( params.name_list, dl.name );
            });
        }else{
            return this._list;
        }
    },
    get: function( id ){
        return this._dict[ id ];
    },
    change: function(){
        $(this).triggerHandler('change');
    }
};


Utils.event = {
    _keys: { 18:'alt', 16:'shift', 91:'meta', 17:'ctrl' },
    init: function(){
        var self = this;
        $(document).keydown(function(event) {
            //console.log(event);
            $.each( self._keys, function( code, name ){
                //console.log( event[ name + 'Key' ] );
                if( event[ name + 'Key' ] || event.which == code ) self[ name + 'Key' ] = true;
            });
        });
        $(document).keyup(function(event){
            $.each( self._keys, function(){
                self[ this + 'Key' ] = false;
            });
        });
    }
}


/**
 * extend the prototype of an object with another
 * @return the new extended object
 */
Utils.extend = function(f, e) {
    function g() {}
    g.prototype = f.prototype || f;
    var new_class = new g();
    for (name in e) {
        new_class[name] = e[name];
    }
    return new_class;
};


/**
    @function
 */
Utils.wait = function(timeout, checkFn, onEndFn) {
    if (checkFn()){
        onEndFn();
    } else {
        setTimeout(function(){
            Utils.wait(timeout, checkFn, onEndFn);
        }, timeout);
    }
}

Utils.pause = function(ms){
    var start_date = new Date();
    do{ var current_date = new Date() }
    while( current_date - start_date < ms );
}




/**
 * http://james.padolsey.com/javascript/wordwrap-for-javascript/
 *
 * The string to be wrapped.
 * The column width (a number, default: 75)
 * The character(s) to be inserted at every break. (default: ‘\n’)
 * The cut: a Boolean value (false by default), if true, the string is always wrapped at or before the specified width.
 *
 */
Utils.wordwrap = function( str, width, brk, cut ) {
    brk = brk || '\n';
    width = width || 75;
    cut = cut || false;
    if( !str ){
        return str;
    }
    var regex = '.{1,' +width+ '}(\\s|$)' + (cut ? '|.{' +width+ '}|.+$' : '|\\S+?(\\s|$)');
    return str.match( RegExp(regex, 'g') ).join( brk );
}


Utils.uuid = function(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

/**
 * A class that save items in historical order and provides access to them
 * @constructor
 */
Utils.HistoryManager = function() {
    this.curr = -1;
    this.entries = [];
}
Utils.HistoryManager.prototype = /** @lends Provi.Utils.HistoryManager.prototype */ {
    push: function(item) {
        if (this.entries.length && this.entries[0] == item) return;
        if (item.match(/^\s*$/)) return;
        this.entries.unshift(item);
        this.curr = -1;
    },
    scroll: function(direction) {
        var moveTo = this.curr + (direction == 'prev' ? 1 : -1);
        if (moveTo >= 0 && moveTo < this.entries.length) {
            this.curr = moveTo;
            return this.entries[this.curr];
        } else if (moveTo == -1) {
            this.curr = moveTo;
            return '';
        } else {
            return null;
        }
    }
};




// math

Utils.geometric_center = function(coords){
    return _.map(_.range( coords[0].length ), function(i){
        return _.reduce(coords, function(sum, x){ 
            return sum + x[i]; 
        }, 0) / coords.length;
    });
}

Utils.principal_axes = function(m, center){
    m = numeric.clone(m);
    var means = center || Utils.geometric_center(m);
    // substract means
    _.each(m, function(d,i){
        _.each(means, function(me,j){
            m[i][j] -= me;
        });
    });
    var svd = numeric.svd(m);
    // scale axes
    var axes = _.map(svd.S, function(s, i){
        return _.map(svd.V, function(v){
            return v[i]*s;
        });
    });
    return axes;
};



})();