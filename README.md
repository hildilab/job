
Clone
=====

* `hg clone https://bitbucket.org/hildilab/job`

Apache
======

* add content from apache.config.sample to /etc/apache/available-sites/000-default.conf
	* adjust user and group attributes
* `mkdir /var/www/job`
* `cp job.wsgi.sample /var/www/job/job.wsgi`
	* adjust APP_PATH
* `cp app.cfg.sample app.cfg`
	* adjust...
* `sudo service apache2 reload`
* `watch -n 1 tail -n 25 /var/log/apache2/error.log`

API
===

* _tools_
	* returns JSON object with available tools and their arguments
* _submit/_
	* send POST or GET parameters
	* returns the string "ERROR" on failure
	* returns { "jobname": "..." } JSON object on success
* _status/`<string:jobname>`_
	* returns JSON object with job status
* _params/`<string:jobname>`_
	* return JSON object with job parameters
* _download/`<string:jobname>`_
	* returns a ZIP file containing the tool results
* _dir/`<string:jobname>/`_
* _dir/`<string:jobname>/<path:subdir>`_
	* returns JSON object containing the directroy contents
* _file/`<string:jobname>`/`<path:filename>`_
	* returns the file
