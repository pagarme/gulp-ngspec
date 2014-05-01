var _ = require('lodash');
var fs = require('fs');
var events = require('events');
var util = require('util');

var EventEmitter = events.EventEmitter;
var Gazerstrator = function() {};

util.inherits(Gazerstrator, EventEmitter);

Gazerstrator.prototype.watch = function(file, handler) {
	var self = this;

	try {
		fs.watch(file.path, function(event, filename) {
			if (event == 'change') {
				self._fileChanged(file, handler);
			}
		});
	} catch(ex) {
		console.log('Error watching file:', ex);
	}
};

Gazerstrator.prototype._fileChanged = function(file, handler) {
	var self = this;

	if (!this.queue) {
		this.queue = [];
		
		setTimeout(function() {
			_.each(self.queue, function(item) {
				item.handler(item.file);
			});

			self.emit('batchFinished');
			self.queue.length = 0;
			self.queue = undefined;
		}, 200);
	}

	this.queue.push({
		file: file,
		handler: handler
	});
};

module.exports = Gazerstrator;

