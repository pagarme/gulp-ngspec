var Gazerstrator = require('./gazerstrator.js');
var File = require('vinyl');
var gutil = require('gulp-util');
var path = require('path');
var minimatch = require('minimatch');
var through = require('through2');
var plumber = require('gulp-plumber');
var fs = require('fs');

var readContent = function() {
	return through.obj(function(file, enc, callback) {
		var self = this
		
		fs.readFile(file.path, { mode: 'rb' }, function(error, data) {
			if (error) {
				self.emit('error', error);
			} else {
				self.push(new File({
					path: file.path,
					base: file.base,
					cwd: file.cwd,
					contents: new Buffer(data)
				}));
			}

			callback();
		});
	});
};

var outputBuilders = {
	css: function(project, files) {
		var data = "";

		files.forEach(function(s) {
			data += '<link rel="stylesheet" type="text/css" href="' + s.relative + '" />\n';	
		});

		return data;
	},
	js: function(project, files) {
		var data = "";

		files.forEach(function(s) {
			data += '<script src="' + s.relative + '" type="text/javascript"></script>\n';	
		});

		return data;
	}
};

var ProjectBuilder = function(taskManager, configuration, project) {
	this.gazer = new Gazerstrator();
	this.tm = taskManager;
	this.config = configuration;
	this.project = project;
	this.outputGroups = {};
	this.inputGroups = {};
	this.pendingTasks = [];
	this.gazer.on('batchFinished', this._firePendingTasks.bind(this));
	this._processProject(project);
}

ProjectBuilder.prototype.transform = function(match, handler) {
	handler('vendor', this._matchFiles('vendor', match));
	handler('app', this._matchFiles('app', match));
};

ProjectBuilder.prototype.build = function(name, match, dependencies, handler) {
	var pog = {};
	var self = this;

	if (!handler) {
		handler = dependencies;
		dependencies = undefined;
	}

	var files = [];
	
	files = files.concat(this._matchFiles('vendor', match));
	files = files.concat(this._matchFiles('app', match));
	
	if (this.config.watch) {
		files.forEach(function(file) {
			this.gazer.watch(file, function(file) {
				if (!pog.files) {
					pog.files = [];
				}

				pog.files.push(file);
				gutil.log(file.relative, 'was changed, rebuilding...');
				self._invalidateTaskTree(name);
			});
		}, this)
	}

	this.tm.add(name, dependencies || [], function() {
		var stream = self._createStream(pog.files || files);
		
		pog.files = undefined;

		return handler(stream
			.pipe(plumber())
			.pipe(readContent()));
	});
};

ProjectBuilder.prototype.addOutput = function(group, files) {
	if (!this.outputGroups[group]) {
		this.outputGroups[group] = [];
	}

	if (files.constructor != Array) {
		files = [ files ];
	}

	this.outputGroups[group] = this.outputGroups[group].concat(files);
};

ProjectBuilder.prototype.getOutputGroup = function(group) {
	return this.outputGroups[group];
};

ProjectBuilder.prototype.replaceExtension = function(file, ext) {
	return new File({
		path: gutil.replaceExtension(file.path, ext),
		base: file.base,
		cwd: file.cwd,
		contents: file.contents
	});
};

ProjectBuilder.prototype.inject = function() {
	var self = this;

	return through.obj(function(file, enc, callback) {
		if (file.isNull()) {
			this.push(file);
			return callback();
		};

		if (file.isBuffer()) {
			file.contents = self._processFile(file);
			this.push(file);
			return callback();
		}

		if (file.isStream()) {
			this.emit('error', new PluginError(PLUGIN_NAME, 'This plugin does not support streams.'))
			return callback();
		}
	});
};

ProjectBuilder.prototype._buildOutput = function(type, group) {
	if (!outputBuilders[type]) {
		return '';
	}
		
	return outputBuilders[type](this, this.outputGroups[group]);
};

ProjectBuilder.prototype._processFile = function(file) {
	var regex = /<!--\s*ngspec:([^:]+):([^\s]+)\s*-->/g;
	var str = file.contents.toString();
	var match;
	
	while ((match = regex.exec(str)) !== null) {
		str = str.substring(0, match.index) + this._buildOutput(match[1], match[2]) + str.substring(match.index + match[0].length, str.length);
	}

	return Buffer(str);
};

ProjectBuilder.prototype._touchAndWalk = function(name) {
	var topLevels = [];
	var depends = [];

	this.tm.tasks.forEach(function(task) {
		if (task.dep && task.dep.indexOf(name) != -1) {
			depends.push(task);
		}
	});

	this.tm._resetTask(this.tm.tasks[name]);

	if (depends.length > 0) {
		depens.forEach(function(task) {
			topLevels = topLevels.concat(this._touchAndWalk(task.name));
		}, this);
	} else {
		topLevels.push(name);
	}

	return topLevels;
};

ProjectBuilder.prototype._firePendingTasks = function() {
	var topLevels = [];
	
	this.pendingTasks.forEach(function(name) {
		topLevels = topLevels.concat(this._touchAndWalk(name));
	}, this);

	this.pendingTasks.length = 0;

	var seq = [];
	this.tm.sequence(this.tm.tasks, topLevels, seq, []);
	this.tm.isRunning = true;
	this.tm._runStep();	
};

ProjectBuilder.prototype._invalidateTaskTree = function(task) {
	if (this.pendingTasks.indexOf(task) == -1) {
		this.pendingTasks.push(task);
	}
};

ProjectBuilder.prototype._createStream = function(files) {
	var stream = through.obj();

	files.forEach(function(file) {
		stream.push(file);
	});

	stream.end();

	return stream;
};

ProjectBuilder.prototype._matchFiles = function(group, match) {
	var input = this.inputGroups[group];

	if (!input) {
		return [];
	}

	var includes = [], excludes = [];
	var result = [];

	match = match.constructor == Array ? match : [ match ];

	match.forEach(function(g) {
		var target = includes;

		if (g.charAt(0) == '!') {
			target = excludes;
			g = g.substring(1);
		}

		target.push(minimatch.makeRe(g, {}));
	});

	input.forEach(function(file) {
		var ok = includes.length == 0;

		for (var i = 0; i < excludes.length; i++) {
			if (excludes[i].test(file.relative)) {
				return;
			}
		}	

		for (var i = 0; i < includes.length; i++) {
			if (includes[i].test(file.relative)) {
				ok = true;
				break;
			}
		}

		if (!ok) {
			return;
		}

		result.push(file);
	});

	return result;
};

ProjectBuilder.prototype._processProject = function(baseDirectory) {
	var baseFull = path.resolve(baseDirectory);
	var cwdFull = process.cwd();
	var spec = require(path.join(baseFull, 'ngspec.js'));

	if (spec.vendor) {
		this.vendor = {
			path: spec.vendor.path
		};
	}

	var includeFile = function(group, root, base, file) {
		var files = this.inputGroups[group];

		if (!files) {
			this.inputGroups[group] = files = [];
		}

		files.push(new File({
			path: path.join(base, file),
			base: root
		}));
	};

	var loadVendor = function(vendor) {
		for (var key in vendor) {
			var value = vendor[key];
			var files = value.constructor == Array ? value : [ value ];
	
			files.forEach(function(file) {
				includeFile.apply(this, [ 'vendor', cwdFull, this.vendor.path, path.join(key, file) ]);
			}, this);
		}
	};

	var loadModule = function(base, name) {
		var module, moduleBase;
		
		try {
			moduleBase = path.join(base, name);
			module = require(path.join(moduleBase, 'ngmodule.js'));
		} catch(ex) {}

		if (!module) {
			gutil.log('Missing module', name);
			return;
		}

		if (module.vendor) {
			loadVendor.apply(this, [ module.vendor ]);
		}

		module.files.forEach(function(file) {
			includeFile.apply(this, [ 'app', base, moduleBase, file ]);
		}, this);
	};

	var loadPackage = function(name) {
		var packagePath, package;

		try {
			packagePath = path.join(baseFull, name, 'ngpackage.js');
			package = require(packagePath);
		} catch(ex) {}

		if (!package) {
			try {
				packagePath = path.join(cwdFull, name, 'ngpackage.js');
				package = require(packagePath);
			} catch(ex) {}
		}

		if (!package) {
			gutil.log('Missing package', name);
			return;
		}

		var packageBase = path.dirname(packagePath);

		if (package.vendor) {
			loadVendor.apply(this, [ package.vendor ]);
		}

		package.modules.forEach(function(name) {
			loadModule.apply(this, [ packageBase, name ]);
		}, this);
	};

	if (spec.vendor) {
		loadVendor.apply(this, [ spec.vendor.modules ]);
	}

	spec.packages.forEach(loadPackage, this);

	spec.modules.forEach(function(name) {
		loadModule.apply(this, [ baseFull, name ]);
	}, this);	
};

module.exports = ProjectBuilder;

