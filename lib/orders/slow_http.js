'use strict';

var fs = require('fs');
var path = require('path');
var through = require('through2');
var split = require('split2');
var helper = require('../utils');

var MAX_LINES = 10; // 最多10行数据
var buffered = [];
exports.logdir = ''; // 日志路径

var map = new Map();

var patt = /^\[([^\]]+)\] (.+) ([-><]{2}) (.+) "(.+) (.+) (.+) (\d+)" (\d+)$/;

function getSlowHTTPLog(lines) {
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matched = line.match(patt);
    if (matched) {
      parsed.push({
        timestamp: matched[1],
        from: matched[2],
        type: matched[3] === '->' ? 'receive': 'send',
        to: matched[4],
        method: matched[5],
        url: matched[6],
        protocol: matched[7],
        code: parseInt(matched[8]),
        rt: parseInt(matched[9])
      });
    }
  }
  return parsed;
}

var getCurrentLogPath = function () {
  var now = new Date();
  var date = helper.getYYYYMMDD(now);
  return path.join(exports.logdir, 'access-' + date + '.log');
};

var readFile = function (filepath, callback) {
  fs.stat(filepath, function (err, stats) {
    if (err) {
      return callback(err);
    }

    if (!stats.isFile()) {
      return callback(new Error(filepath + ' is not a file'));
    }

    var start = map.get(filepath) || 0;
    if (stats.size === start) {
      return callback(null);
    }

    var readable = fs.createReadStream(filepath, {start: start});
    readable.pipe(split()).pipe(through(function (line, _, next) {
      if (line.length) {
        buffered.push(line.toString());
        if (buffered.length > MAX_LINES) {
          buffered.shift(); // 删掉前面的
        }
      }
      next();
    }));

    readable.on('data', function (data) {
      start += data.length;
    });

    readable.on('end', function () {
      map.set(filepath, start);
      callback(null);
    });
  });
};

var readLog = function (callback) {
  var currentPath = getCurrentLogPath();
  var current = map.get('currentFile');

  if (currentPath !== current) {
    map.set('currentFile', currentPath);
    readFile(current, function (err) {
      if (err) {
        return callback(err);
      }
      readFile(currentPath, callback);
    });
  } else {
    readFile(currentPath, callback);
  }
};

exports.init = function (config) {
  exports.logdir = config.logdir;
  var currentPath = getCurrentLogPath();
  map.set('currentFile', currentPath);
  buffered = [];
};

exports.run = function (callback) {
  if (!exports.logdir) {
    return callback(new Error('Not specific logdir in agentx config file'));
  }

  readLog(function (err) {
    if (err) {
      return callback(err);
    }

    // no data
    if (buffered.length === 0) {
      return callback(null, null);
    }

    var metrics = getSlowHTTPLog(buffered);
    // clean
    buffered = [];

    callback(null, {
      type: 'slow_http',
      metrics: metrics
    });
  });
};
