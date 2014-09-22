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

from job import (
    Job_Status, Job_Params, Job_Download, Job_Tools, Job_Submit
)


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


# !important - allows one to abort via CTRL-C
signal.signal(signal.SIGINT, signal.SIG_DFL)
multiprocessing.log_to_stderr( logging.ERROR )
nworkers = app.config.get( 'JOB_WORKERS', multiprocessing.cpu_count() )
JOB_POOL = multiprocessing.Pool( nworkers, maxtasksperchild=nworkers )

@app.route('/job/status/<string:jobname>')
def job_status( jobname ):
    return Job_Status( jobname, app ) 

@app.route('/job/params/<string:jobname>')
def job_params( jobname ):
    return Job_Params(jobname, app)

@app.route('/job/download/<string:jobname>')
def job_download( jobname ):
    return Job_Download( jobname, app )

@app.route('/job/tools')
def job_tools():
    return Job_Tools(app)

@app.route('/job/submit/', methods=['POST', 'GET'])
def job_submit():
    return Job_Submit(app, JOB_POOL)

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
