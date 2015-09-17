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

def get_input_path( name, params, output_dir ):
    ext = params.get("ext", "dat")
    return os.path.join( output_dir, "input_%s.%s" % ( name, ext ) )

def get_job_dir( jobname, app, create=False ):
    output_dir = os.path.join( app.config['JOB_DIR'], jobname )
    output_dir = os.path.abspath( output_dir )
    if not os.path.exists( output_dir ):
        os.makedirs( output_dir )
    return output_dir

def _job_submit( is_form, app, JOB_POOL ):
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
        output_dir = get_job_dir( jobname, app, create=True )
        args = []
        kwargs = {}
        for name, params in Tool.args.iteritems():
            if params.get("group"):
                continue
            if params["type"] == "file":
                fpath = get_input_path( name, params, output_dir )

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

@app.route('/status/<string:jobname>')
def job_status( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = get_job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        return jsonify({
            "running": RUNNING_JOBS.get( jobname, False ),
            "check": tool.check( full=False ),
            "log": tool.get_full_log()
        })
    return ""

@app.route('/params/<string:jobname>')
def job_params( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = get_job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        return jsonify( tool.params )
    return ""

@app.route('/download/<string:jobname>')
def job_download( jobname ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = get_job_dir( jobname, app )
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

@app.route('/tools')
def job_tools():
    tools = collections.defaultdict( dict )
    for name, Tool in app.config['TOOLS'].iteritems():
        tools[ name ][ 'args' ] = Tool.args.values()
        tools[ name ][ 'docu' ] = Tool.__doc__
    return jsonify( tools )

@app.route('/submit/', methods=['POST', 'GET'])
def job_submit():
    is_form = True
    print "is_form: " + str(is_form)
    print request.args
    print request.form
    print request.json
    try:
        return _job_submit( is_form, app, JOB_POOL )
    except Exception as e:
        print e
        return "ERROR"

@app.route( '/dir/<string:jobname>/' )
@app.route( '/dir/<string:jobname>/<path:subdir>' )
def job_dir( jobname="", subdir="" ):
    jobname = jobname.encode( "utf-8" )
    subdir = subdir.encode( "utf-8" )
    dir_content = []
    if jobname == "":
        return ""
    dir_path = os.path.join(
        app.config['JOB_DIR'], jobname, subdir
    ).encode( "utf-8" )
    if subdir:
        dir_content.append({
            'name': '..',
            'path': os.path.split( os.path.join( subdir ) )[0],
            'dir': True
        })
    for fname in sorted( os.listdir( dir_path ) ):
        fname = fname.decode( "utf-8" ).encode( "utf-8" )
        if not fname.startswith('.'):
            fpath = os.path.join( dir_path, fname )
            if os.path.isfile( fpath ):
                dir_content.append({
                    'name': fname,
                    'path': os.path.join( subdir, fname ),
                    'size': os.path.getsize( fpath )
                })
            else:
                dir_content.append({
                    'name': fname,
                    'path': os.path.join( subdir, fname ),
                    'dir': True
                })
    return json.dumps( dir_content )

@app.route( '/file/<string:jobname>/<path:filename>' )
def job_file( jobname="", filename="" ):
    dir_path = os.path.join(
        app.config['JOB_DIR'], jobname
    ).encode( "utf-8" )
    return send_from_directory( dir_path, filename )

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
        extra_files=['app.cfg']
    )
