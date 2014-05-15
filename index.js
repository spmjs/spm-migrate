'use strict';

var join = require('path').join;
var fs = require('fs');
var gulp = require('gulp');
var gulpif = require('gulp-if');
var pipe = require('multipipe');
var through = require('through2');
var requires = require('requires');
var decmdify = require('decmdify');
var glob = require('glob');
var beautify = require('gulp-beautify');
var clean = require('gulp-clean');
var Bump = require('ibump');

module.exports = function migrate(options, cb) {
  var cwd = options.cwd;
  var pkg = require(join(cwd, 'package.json'));

  var deTransport = pipe(
    gulpif(/(src|tests)\/.*\.js$/, replaceRequire(pkg, cwd)),
    gulpif(/(src|tests)\/.*\.js$/, decmdify({gulp: true})),
    gulpif(/(src|tests)\/.*\.js$/, beautify({indentSize: 2}))
  );

  var deleteMakefile = pipe(
    gulpif(join(cwd, 'Makefile'), clean()),
    gulpif(join(cwd, 'Makefile'), stop())
  );

  var deleteDist = pipe(
    gulpif(join(cwd, 'dist'), clean()),
    gulpif(join(cwd, 'dist'), stop())
  );

  pipe(
    gulp.src(['**/*', '.travis.yml', '!**/+(_site|dist|sea-modules)/**/*'], {cwd: cwd}),
    deTransport,
    deleteMakefile,
    deleteDist,
    gulpif(join(cwd, 'package.json'), modifyPkg()),
    gulpif(join(cwd, '.travis.yml'), travis()),
    gulp.dest(options.dest)
  )
  .on('error', cb)
  .on('end', cb);
};

function getRequire() {
  var name = [];
  glob.sync('+(src|tests)/**/*.js')
    .forEach(function(file) {
      var code = fs.readFileSync(file).toString();
      var items = requires(code)
        .map(function(item) {
          return item.path;
        });
      name = name.concat(items);
    });

  return name.filter(function(item, index, arr) {
    return index === arr.indexOf(item);
  });
}

function getSource(cwd) {
  return fs.readdirSync(cwd)
    .filter(function(item) {
      return fs.statSync(join(cwd, item)).isFile();
    })
    .map(function(item) {
      return item.replace(/\.js$/, '');
    });
}

function replaceRequire(pkg, cwd) {
  var src = getSource(join(cwd, 'src'));
  var alias = pkg.spm.alias;
  var replace = {
    $: 'jquery',
    expect: 'expect.js'
  };

  return through.obj(function(file, enc, callback) {
    var code = file.contents.toString();
    code = requires(code, function(require){
      var name = require.path;
      if (replace[name]) {
        name = replace[name];
      } else if (alias[name]) {
        var d = alias[name].split('/');
        if (d.length > 1) name = d[0] + '-' + d[1];
      } else if (~src.indexOf(name)) {
        name = '../src/' + name;
      }
      console.log('replace name ' + require.path + ' > ' + name);
      return 'require("' + name + '")';
    });
    file.contents = new Buffer(code);
    this.push(file);
    return callback();
  });
}

function travis() {
  return through.obj(function(file, enc, callback) {
    file.contents = fs.readFileSync(join(__dirname, 'template/travis.yml'));
    this.push(file);
    return callback();
  });
}

function stop() {
  return through.obj(function(file, enc, callback) {
    return callback();
  });
}

function modifyPkg() {
  var required = getRequire();

  return through.obj(function(file, enc, callback) {
    var pkg = JSON.parse(file.contents);

    // delete family
    if (!pkg.family) throw new Error('not spm2.x package');
    pkg.name = pkg.family + '-' + pkg.name;
    delete pkg.family;

    pkg.version = new Bump(pkg.version).minor().toString();

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
      var version = new Bump(depPkg[2]).minor().toString();
      deps[depPkg[0] + '-' + depPkg[1]] = version;
    }
    delete spm.alias;

    spm.devDependencies = spm.devDependencies || {};
    spm.devDependencies['expect.js'] = '0.3.1';
    if (~required.indexOf('sinon')) spm.devDependencies['sinon'] = '1.6.0';

    if (~required.indexOf('$')) spm.buildArgs = '--ignore jquery';

    file.contents = new Buffer(JSON.stringify(pkg, null, 2));
    this.push(file);
    return callback();
  });
}
