#!/usr/bin/env python

import os
import tempfile
import functools
import uuid
import logging
import collections
import zipfile
try:
    import json
except ImportError:
    import simplejson as json
from flask import send_file
from flask import request
from flask import jsonify
from werkzeug import secure_filename


RUNNING_JOBS = {}
logging.basicConfig( level=logging.DEBUG )
LOG = logging.getLogger( 'job' )
LOG.setLevel( logging.DEBUG )


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
        print name
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
        print d
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
                if is_form:
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
                else:
                    # there can be only a single jmol file
                    # for the whole form
                    if params["ext"] == "jmol":
                        with open( fpath, "w" ) as fp:
                            fp.write( request.stream.read() )
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


def Job_Status( jobname, app ):
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

def Job_Params( jobname, app ):
    jobname = secure_filename( jobname )
    jobtype, jobid = jobname.split("_")
    Tool = app.config['TOOLS'].get( jobtype, None )
    if Tool:
        output_dir = job_dir( jobname, app )
        tool = Tool( output_dir=output_dir, fileargs=True, run=False )
        return jsonify( tool.params )
    return ""

def Job_Download( jobname, app ):
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

def Job_Tools( app ):
    tools = collections.defaultdict( dict )
    for name, Tool in app.config['TOOLS'].iteritems():
        tools[ name ][ 'args' ] = Tool.args
        attr = {}
        if hasattr( Tool, "provi_tmpl" ):
            attr[ 'provi_file' ] = Tool.provi_tmpl
        tools[ name ][ 'attr' ] = attr
        tools[ name ][ 'docu' ] = Tool.__doc__
    return jsonify( tools )

def Job_Submit( app, JOB_POOL ):
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
