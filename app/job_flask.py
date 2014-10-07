from __future__ import with_statement

import sys
import os
import gzip
import urllib2
import base64
import tempfile
import functools
import signal
import logging
import multiprocessing
from cStringIO import StringIO
import uuid
import collections
import zipfile

try:
    import json
except ImportError:
    import simplejson as json

from flask import Flask
from flask import send_from_directory
from flask import send_file
from flask import request
from flask import make_response, Response
from flask import url_for, redirect
from flask import jsonify
from werkzeug import secure_filename


RUNNING_JOBS = {}
logging.basicConfig( level=logging.DEBUG )
LOG = logging.getLogger( 'job' )
LOG.setLevel( logging.DEBUG )

cfg_file = 'app.cfg'
if len( sys.argv ) > 1:
    cfg_file = sys.argv[1]

app = Flask(__name__)
app.config.from_pyfile( cfg_file )

os.environ.update( app.config.get( "ENV", {} ) )
os.environ["PATH"] += ":" + ":".join( app.config.get( "PATH", [] ) )
os.environ["HTTP_PROXY"] = app.config.get( "PROXY", "" )


############################
# utils
############################

def boolean(string):
    """
    interprets a given string as a boolean:
        * False: '0', 'f', 'false', 'no', 'off'
        * True: '1', 't', 'true', 'yes', 'on'

    >>> boolean('true')
    True
    >>> boolean('false')
    False
    """
    string = str(string).lower()
    if string in ['0', 'f', 'false', 'no', 'off']:
        return False
    elif string in ['1', 't', 'true', 'yes', 'on']:
        return True
    else:
        raise ValueError()


def decode( data, encoding ):
    if encoding == 'base64':
        try:
            data = base64.decodestring( data )
        except Exception, e:
            print str(e)
    return data


############################
# cache control
############################

@app.after_request
def add_no_cache(response):
    response.cache_control.no_cache = True
    return response


def nocache(f):
    def new_func(*args, **kwargs):
        resp = make_response(f(*args, **kwargs))
        resp.cache_control.no_cache = True
        return resp
    return functools.update_wrapper(new_func, f)


############################
# basic auth
############################

def check_auth(username, password):
    """This function is called to check if a username /
    password combination is valid.
    """
    return username == 'test' and password == 'test'


def authenticate():
    """Sends a 401 response that enables basic auth"""
    return Response(
        'Could not verify your access level for that URL.\n'
        'You have to login with proper credentials', 401,
        {'WWW-Authenticate': 'Basic realm="Login Required"'}
    )


# use as after a route decorator
def requires_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if app.config.get('REQUIRE_AUTH', False):
            auth = request.authorization
            if not auth or not check_auth(auth.username, auth.password):
                return authenticate()
        return f(*args, **kwargs)
    return decorated


############################
# static routes
############################

# @app.route('/')
# def hello_world():
#     return 'Hello World!!!'

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(
        app.config['STATIC_DIR'], 'favicon.ico',
        mimetype='image/vnd.microsoft.icon'
    )


# @app.route('/static/html/<path:filename>')
# @requires_auth
# def static_html(filename):
#     return send_from_directory( app.config['STATIC_DIR'], os.path.join( "html", filename ) )


@app.route('/static/<path:filename>')
def staticx(filename):
    return send_from_directory( app.config['STATIC_DIR'], filename )

@app.route('/app/<name>')
def redirect_app( name ):
    return redirect( url_for( 'static', filename='html/%s.html' % name ) )


############################
# url data provider
############################

def retrieve_url( url ):
    if not url:
        raise Exception( "no url given" )
    if '127.0.0.1' in url or 'localhost' in url or not app.config['PROXY']:
        proxy_conf = {}
    else:
        proxy_conf = { 'http': app.config['PROXY'] }
    opener = urllib2.build_opener( urllib2.ProxyHandler( proxy_conf ) )
    try:
        response = opener.open( url )
        info = response.info()
        if info.get('Content-Type') == "application/x-gzip":
            buf = StringIO( response.read())
            f = gzip.GzipFile( fileobj=buf )
            data = f.read()
        else:
            data = response.read()
    except Exception as e:
        print proxy_conf
        print e
        raise Exception(
            "unable to open url '%s'" % url
        )
    return data


@app.route('/urlload/')
def urlload():
    return retrieve_url(
        request.args.get('url', '')
    )


############################
# local data provider
############################

def get_path( directory_name, path ):
    if directory_name == "__job__":
        if not path:
            return ''
        directory = app.config['JOB_DIR']
    else:
        directory = app.config['LOCAL_DATA_DIRS'].get( directory_name )
        if not directory:
            return ''
        pass
    return os.path.join( directory, path )


@app.route('/example/directory_list/')
def local_data_dirs():
    dirs = app.config['LOCAL_DATA_DIRS'].keys()
    dirs.sort()
    return json.dumps( dirs )


@app.route('/example/dataset_list2/')
def local_data_list():
    directory_name = request.args.get('directory_name', '')
    if not directory_name:
        return ''
    path = request.args.get('path', '')
    dirpath = get_path( directory_name, path )
    if not dirpath:
        return ''
    jstree = []
    for fname in sorted( os.listdir( dirpath ) ):
        if ( not fname.startswith('.') and
                not (fname.startswith('#') and fname.endswith('#') ) ):
            if os.path.isfile( os.path.join(dirpath, fname) ):
                jstree.append({
                    'data': { 'title': '<span>' + fname + '</span>' },
                    'metadata': { 'file': fname, 'path': path + fname, }
                })
            else:
                jstree.append({
                    'data': { 'title': '<span>' + fname + '</span>' },
                    'metadata': { 'path': path + fname + '/', 'dir': True },
                    'attr': { 'id': path + fname + '/' },
                    'state': 'closed'
                })
    return json.dumps( jstree )


@app.route('/example/data/')
def local_data():
    directory_name = request.args.get('directory_name', '')
    path = request.args.get('path', '')
    dirpath = get_path( directory_name, path )
    if not dirpath:
        return ''
    return send_file( dirpath, mimetype='text/plain', as_attachment=True )


############################
# save data
############################

def write_data( name, directory_name, data, append=False ):
    directory = app.config['LOCAL_DATA_DIRS'].get( directory_name )
    if not directory:
        return 'ERROR: directory not available.'
    path = os.path.join( directory, name )
    path = os.path.abspath( path )
    directory = os.path.abspath( directory )
    if directory == os.path.commonprefix([ path, directory ]):
        parent = os.path.split( path )[0]
        if os.path.isdir( parent ):
            mode = 'a' if append else 'w'
            with open( path, mode ) as fp:
                fp.write( data )
            return 'OK'
        else:
            return 'ERROR: directory not available.'
    else:
        return 'ERROR: access restriction.'


@app.route('/save/local/', methods=['POST'])
def save_local():
    directory_name = request.form.get('directory_name', '')
    name = request.form.get('name', '')
    append = boolean( request.form.get('append', '') )
    encoding = request.form.get('encoding', '')
    data = request.form.get('data', '')
    data = decode( data, encoding )
    return write_data( name, directory_name, data, append=append )


@app.route('/save/download/', methods=['POST'])
def save_download():
    mimetype = request.form.get('type', 'application/download')
    encoding = request.form.get('encoding', '')
    name = request.form.get('name', 'file.dat')
    data = request.form.get('data', '')
    data = decode( data, encoding )
    ftmp = tempfile.NamedTemporaryFile()
    ftmp.write( data )
    ftmp.seek(0)
    # not working... but should
    # strio = StringIO.StringIO()
    # strio.write( data )
    # strio.seek(0)
    return send_file(
        ftmp,
        mimetype=mimetype, as_attachment=True,
        attachment_filename=name
    )


############################
# job handling
############################

def job_done( jobname, tool_list ):
    LOG.info( "JOB DONE: %s - %s" % (jobname, tool_list[0].output_dir) )
    RUNNING_JOBS[ jobname ] = False

def call( tool ):
    try:
        tool()
    except Exception as e:
        print e
    return tool


def job_start( jobname, tool, JOB_POOL ):
    LOG.info( "JOB STARTED: %s - %s" % (jobname, tool.output_dir) )
    RUNNING_JOBS[ jobname ] = True
    JOB_POOL.map_async(
        call, [ tool ], callback=functools.partial( job_done, jobname )
    )

def input_path( name, params, output_dir ):
    ext = params.get("ext", "dat")
    return os.path.join( output_dir, "input_%s.%s" % ( name, ext ) )

def job_dir( jobname, app, create=False ):
    output_dir = os.path.join( app.config['JOB_DIR'], jobname )
    output_dir = os.path.abspath( output_dir )
    if not os.path.exists( output_dir ):
        os.makedirs( output_dir )
    return output_dir

def _job_submit( is_form, app, JOB_POOL ):
    # raise Exception("foo")

    def get( name, params ):
        default = params.get( "default", "" )
        attr = "form" if is_form else "args"
        if params.get( "nargs" ) or params.get( "action" ) == "append":
            d = getattr( request, attr ).getlist( name + "[]" )
            if params.get( "nargs" ) and \
                    params.get( "action" ) == "append":
                d = [ x.split() for x in d ]
            if not d:
                d = default
        else:
            d = getattr( request, attr ).get( name, default )
        return d
    jobtype = get( '__type__', {} )
    Tool = app.config['TOOLS'].get( jobtype )
    if Tool:
        jobname = jobtype + "_" + str( uuid.uuid4() )
        output_dir = job_dir( jobname, app, create=True )
        args = []
        kwargs = {}
        for name, params in Tool.args.iteritems():
            if params.get("group"):
                continue
            if params["type"] == "file":
                fpath = input_path( name, params, output_dir )

                for file_storage in request.files.getlist( name ):
                    if file_storage:
                        file_storage.save( fpath )
                        break   # only save the first file
                else:
                    print "file '%s' not found, trying url" % name
                    url = get( name, params )
                    d = retrieve_url( url )
                    with open( fpath, "w" ) as fp:
                        fp.write( d )

                d = str( fpath )
            elif params["type"] == "float":
                d = float( get( name, params ) )
            elif params["type"] == "int":
                d = int( get( name, params ) )
            elif params["type"] == "bool":
                d = boolean( get( name, { "default": False } ) )
            elif params["type"] in [ "str", "sele" ]:
                d = str( get( name, params ) )
            elif params["type"] == "list":
                d = get( name, params )
            else:
                # unknown type, raise exception?
                d = get( name, params )
                print "unknown type", d
            if "default" in params:
                kwargs[ name ] = d
            else:
                args.append( d )
        args = tuple(args)
        kwargs.update({
            "output_dir": output_dir, "run": False,
            #"verbose": True, "debug": True
        })
        job_start( jobname, Tool( *args, **kwargs ), JOB_POOL  )
        return jsonify({ "jobname": jobname })
    return "ERROR"


# !important - allows one to abort via CTRL-C
signal.signal(signal.SIGINT, signal.SIG_DFL)
multiprocessing.log_to_stderr( logging.ERROR )
nworkers = app.config.get( 'JOB_WORKERS', multiprocessing.cpu_count() )
JOB_POOL = multiprocessing.Pool( nworkers, maxtasksperchild=nworkers )

@app.route('/job/status/<string:jobname>')
def job_status( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        return jsonify({
            "running": RUNNING_JOBS.get( jobname, False ),
            "check": tool.check( full=False ),
            "log": tool.get_full_log()
        })
    return ""

@app.route('/job/getfile/<string:jobname>/<string:filename>')
def job_get_file( jobname, filename ):
    jobname = secure_filename( jobname )
    filename = secure_filename( filename )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        for f in tool.output_files:
            if filename == os.path.basename(f):
                return send_file(
                    f,
                    attachment_filename="%s" % os.path.basename(f),
                    as_attachment=True
                )
    return ""

@app.route('/job/params/<string:jobname>')
def job_params( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        return jsonify( tool.params )
    return ""

@app.route('/job/download/<string:jobname>')
def job_download( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        fp = tempfile.NamedTemporaryFile( "w+b" )

        with zipfile.ZipFile(fp, 'w', zipfile.ZIP_DEFLATED) as fzip:
            for f in tool.output_files:
                fzip.write( f, os.path.relpath( f, output_dir ) )
        return send_file(
            fp.name,
            attachment_filename="%s.zip" % jobname,
            as_attachment=True
        )
    return ""


@app.route('/job/tools')
def job_tools():
    tools = collections.defaultdict( dict )
    for name, Tool in app.config['TOOLS'].iteritems():
        tools[ name ][ 'args' ] = Tool.args
        attr = {}
        if hasattr( Tool, "provi_tmpl" ):
            attr[ 'provi_file' ] = Tool.provi_tmpl
        tools[ name ][ 'attr' ] = attr
        tools[ name ][ 'docu' ] = Tool.__doc__
    return jsonify( tools )

@app.route('/job/submit/', methods=['POST', 'GET'])
def job_submit():
    is_form = request.args.get("POST") != "_PNGJBIN_"
    print "is_form: " + str(is_form)
    print request.args
    print request.form
    print request.json

    try:
        return _job_submit( is_form, app, JOB_POOL )
    except Exception as e:
        print e
        return "ERROR"

############################
# CORS handling (by http://coalkids.github.io/author/christophe-serafin.html)
############################


@app.before_request
def option_autoreply():
    """ Always reply 200 on OPTIONS request """

    if request.method == 'OPTIONS':
        resp = app.make_default_options_response()

        headers = None
        if 'ACCESS_CONTROL_REQUEST_HEADERS' in request.headers:
            headers = request.headers['ACCESS_CONTROL_REQUEST_HEADERS']

        h = resp.headers

        # Allow the origin which made the XHR
        h['Access-Control-Allow-Origin'] = request.headers['Origin']
        # Allow the actual method
        h['Access-Control-Allow-Methods'] = request.headers['Access-Control-Request-Method']
        # Allow for 10 seconds
        h['Access-Control-Max-Age'] = "10"

        # We also keep current headers
        if headers is not None:
            h['Access-Control-Allow-Headers'] = headers

        return resp


@app.after_request
def set_allow_origin(resp):
    """ Set origin for GET, POST, PUT, DELETE requests """

    h = resp.headers

    # Allow crossdomain for other HTTP Verbs
    if request.method != 'OPTIONS' and 'Origin' in request.headers:
        h['Access-Control-Allow-Origin'] = "*"#request.headers['Origin']


    return resp



############################
# main
############################

if __name__ == '__main__':
    app.run(
        debug=app.config.get('DEBUG', False),
        host=app.config.get('HOST', '127.0.0.1'),
        port=app.config.get('PORT', 5000),
        threaded=True,
        processes=1,
        extra_files=['app.cfg', 'app2.cfg']
    )
