'use strict';

var join = require('path').join;
var extname = require('path').extname;
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
  for (var name in (pkg.spm.devAlias || {})) {
    alias[name] = pkg.spm.devAlias[name];
  }
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
        name = getName(alias[name]);
      } else if (~src.indexOf(name)) {
        name = '../src/' + name;
      }
      console.log('replace name ' + require.path + ' > ' + name);
      return 'require(\'' + name + '\')';
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
    spm.dependencies = getDeps(spm.alias || {});
    delete spm.alias;
    if (!spm.dependencies['handlebars-runtime'] && containExt(required, 'handlebars')) {
      spm.dependencies['handlebars-runtime'] = '1.3.0';
    }

    // devAlias -> devDependencies
    spm.devDependencies = getDeps(spm.devAlias || {});
    spm.devDependencies['expect.js'] = '0.3.1';
    if (~required.indexOf('sinon')) spm.devDependencies['sinon'] = '1.6.0';
    delete spm.devAlias;

    // use default
    delete pkg.tests;

    // engines
    spm.engines = {
      'seajs': '2.2.1',
      'seajs-text': '1.1.0'
    };

    if (~required.indexOf('$')) spm.buildArgs = '--ignore jquery';

    file.contents = new Buffer(JSON.stringify(pkg, null, 2));
    this.push(file);
    return callback();
  });
}

function getDeps(alias) {
  var deps = {};
  for (var name in alias) {
    var path = alias[name];

    if (name === '$' && path === '$') {
      deps['jquery'] = '1.7.2';
      continue;
    }

    name = getName(path);

    if (name === 'handlebars') {
      deps['handlebars'] = '1.3.0';
      continue;
    }

    if (/handlebars\/[0-9.]+\/runtime/.test(path)) {
      deps['handlebars-runtime'] = '1.3.0';
      continue;
    }

    var version = getVersion(path);
    version = new Bump(version).minor().toString();
    deps[name] = version;
  }
  return deps;
}

function getName(path) {
  var s = path.split('/');
  if (s.length > 1) {
    return s[0] === 'gallery' ? s[1] : (s[0] + '-' + s[1]);
  } else {
    return path;
  }
}

function getVersion(path) {
  var s = path.split('/');
  return s[2];
}

function containExt(list, ext) {
  return ~list.map(function(file) {
    return extname(file).substring(1);
  }).indexOf(ext);
}
