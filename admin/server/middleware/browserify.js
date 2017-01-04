var keystone = require('../../../index');
var chalk = require('chalk');
var crypto = require('crypto');
var fs = require('fs-extra');
var moment = require('moment');
var packages = require('../../client/packages');
var path = require('path');

var basedir = path.resolve(__dirname + '/../../client/');
var devMode = process.env.KEYSTONE_DEV === 'true';
var devWriteBundles = process.env.KEYSTONE_WRITE_BUNDLES === 'true';
var devWriteDisc = process.env.KEYSTONE_WRITE_DISC === 'true';

function ts () {
	return chalk.gray(moment().format('YYYY-MM-DD HH:MM:SS '));
}

function logInit (file) {
	console.log(chalk.grey('Watching ') + chalk.underline(file) + chalk.grey(' for changes...'));
}

function logRebuild (file) {
	console.log(ts() + chalk.green('rebuilt ' + chalk.underline(file)));
}

function logError (file, err) {
	console.log(ts() + chalk.red('error building ' + chalk.underline(file) + ':') + '\n' + err.message);
}

module.exports = function (file, name) {
	var b;
	var building = false;
	var queue = [];
	var ready;
	var src;
	var logName = typeof file === 'string' ? file.replace(/^\.\//, '') : name;
	var fileName = logName;
	if (fileName.substr(-3) !== '.js') fileName += '.js';

	var writeToDisk = keystone.get('write keystone files to disk');
	var staticPath = keystone.get('static') || path.join(keystone.get('module root'), 'public');
	var outputPath = path.resolve(path.join(staticPath, 'keystone', fileName));

	function writeBundle (buff) {
		if (writeToDisk) {
			fs.outputFile(outputPath, buff, 'utf8');
		}

		if (devWriteBundles) {
			fs.outputFile(path.resolve(path.join(__dirname, '../../bundles/js', fileName)), buff, 'utf8');
		}
		if (devWriteDisc) {
			var discFile = fileName.replace('.js', '.html');
			require('disc').bundle(buff, function (err, html) {
				if (err) {
					logError(discFile, err);
				} else {
					fs.outputFile(path.resolve(path.join(__dirname, '../../bundles/disc', discFile)), html, 'utf8');
					console.log(ts() + chalk.green('wrote disc for ' + chalk.underline(file)));
				}
			});
		}
	}
	function build () {
		if (building) return;
		building = true;
		var babelify = require('babelify');
		var browserify = require('browserify');
		var watchify = require('watchify');
		var opts = { basedir: basedir };
		if (devMode) {
			logInit(logName);
			opts.debug = true;
			opts.cache = {};
			opts.packageCache = {};
		}
		if (devWriteDisc) {
			opts.fullPaths = true;
		}
		if (/packages\.js/.test(outputPath)) {
			b = browserify(opts);
			packages.forEach(function (i) {
				b.require(i);
			});
		} else {
			if (name) {
				b = browserify(opts);
				b.require(file, { expose: name });
			} else {
				b = browserify(file, opts);
			}
			b.transform(babelify);
			b.exclude('FieldTypes');
			packages.forEach(function (i) {
				b.exclude(i);
			});
		}
		if (devMode) {
			b = watchify(b, { poll: 500 });
		}
		b.bundle(function (err, buff) {
			if (err) return logError(logName, err);
			src = buff;
			ready = true;
			queue.forEach(function (reqres) {
				send.apply(null, reqres);
			});
			writeBundle(buff);
		});
		b.on('update', function () {
			b.bundle(function (err, buff) {
				if (err) return logError(logName, err);
				else logRebuild(logName);
				src = buff;
				writeBundle(buff);
			});
		});
	}
	function serve (req, res) {
		fs.readFile(outputPath, (err, data) => {
			if (!ready) {
				build();

				if (err || !data) {
					return queue.push([req, res]);
				}
			}

			src = src || data;
			send(req, res);
		});
	}
	function send (req, res) {
		res.setHeader('Content-Type', 'application/javascript');
		var etag = crypto.createHash('md5').update(src).digest('hex').slice(0, 6);

		if (req.get && (etag === req.get('If-None-Match'))) {
			res.status(304);
			res.end();
		}
		else {
			res.set('ETag', etag);
			res.set('Vary', 'Accept-Encoding');
			res.send(src);
		}
	}
	return {
		serve: serve,
		build: build,
	};
};
