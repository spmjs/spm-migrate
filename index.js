'use strict';

var join = require('path').join;
var gulp = require('gulp');
var gulpif = require('gulp-if');
var pipe = require('multipipe');
var through = require('through2');
var decmdify = require('decmdify');
var requires = require('requires');

module.exports = function migrate(options, cb) {
  var cwd = options.cwd;
  var pkg = require(join(cwd, 'package.json'));

  pipe(
    gulp.src('**/*.+(js|json)', {cwd: cwd}),
    gulpif(join(cwd, 'package.json'), modifyPkg()),
    gulpif(/(src|tests)\/.*\.js$/, replaceRequire(pkg)),
    gulpif(/(src|tests)\/.*\.js$/, decmdify({gulp: true})),
    gulp.dest(options.dest)
  )
  .on('error', cb)
  .on('end', cb);
};

function replaceRequire(pkg) {
  var alias = pkg.spm.alias;

  return through.obj(function(file, enc, callback) {
    var code = file.contents.toString();
    code = requires(code, function(require){
      var name = require.path;
      if (name === '$') {
        name = 'jquery';
      } else if (name === 'expect') {
        name = 'expect.js';
      } else if (alias[name]) {
        var d = alias[name].split('/');
        if (d.length > 1) name = d[0] + '-' + d[1];
      }
      console.log('replace name ' + require.path + ' > ' + name);
      return 'require("' + name + '")';
    });
    file.contents = new Buffer(code);
    this.push(file);
    return callback();
  });
}

function modifyPkg() {
  return through.obj(function(file, enc, callback) {
    var pkg = JSON.parse(file.contents);

    // delete family
    if (!pkg.family) throw new Error('not spm2.x package');
    pkg.name = pkg.family + '-' + pkg.name;
    delete pkg.family;

    // output -> main
    var spm = pkg.spm;
    spm.main = 'src/' + spm.output[0];
    delete spm.output;

    // alias -> dependencies
    var deps = spm.dependencies = {};
    var alias = spm.alias;
    for (var name in alias) {
      if (name === '$' && alias[name] === '$') {
        deps['jquery'] = '1.7.2';
        continue;
      }
      var depPkg = alias[name].split('/');
      deps[depPkg[0] + '-' + depPkg[1]] = depPkg[2];
    }
    delete spm.alias;

    spm.devDependencies = spm.devDependencies || {};
    spm.devDependencies['expect.js'] = '0.3.1';

    file.contents = new Buffer(JSON.stringify(pkg, null, 2));
    this.push(file);
    return callback();
  });
}
