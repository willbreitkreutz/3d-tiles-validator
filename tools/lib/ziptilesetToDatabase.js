'use strict';
var Cesium = require('cesium');
var fsExtra = require('fs-extra');
var klaw = require('klaw');
var path = require('path');
var Promise = require('bluebird');
var sqlite3 = require('sqlite3');
var zlib = require('zlib');
var isGzipped = require('./isGzipped');
var isTile = require('./isTile');
var sqlite3 = require('sqlite3');
var unzipper = require('unzipper')
var fs = require('fs');

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;

module.exports = tilesetToDatabase;

/**
 * Generates a sqlite database for a tileset, saved as a .3dtiles file.
 *
 * @param {String} inputDirectory The input directory of the tileset.
 * @param {String} [outputFile] The output .3dtiles database file.
 * @returns {Promise} A promise that resolves when the database is written.
 */
function tilesetToDatabase(inputZipFile, outputFile) {
    if (!defined(inputZipFile)) {
        throw new DeveloperError('inputZipFile is required.');
    }

    outputFile = defaultValue(outputFile,
        path.join(path.dirname(inputZipFile), path.basename(inputZipFile) + '.3dtiles.db'));

    var db;
    var dbRun;
    // Delete the .3dtiles file if it already exists
    return Promise.resolve(fsExtra.remove(outputFile))
        .then(function () {
            // Create the database.
            db = new sqlite3.Database(outputFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
            dbRun = Promise.promisify(db.run, {context: db});

            // Disable journaling and create the table.
            return dbRun('PRAGMA journal_mode=off;');
        })
        .then(function () {
            return dbRun('BEGIN');
        })
        .then(function () {
            return dbRun('CREATE TABLE media (key TEXT PRIMARY KEY, content BLOB)');
        })
        .then(function () {
            //Build the collection of file paths to be inserted.
            var filePaths = [];
            // var stream = klaw(inputDirectory);
            fs.createReadStream(inputZipFile)
              .pipe(unzipper.Parse())
              .pipe(stream.Transform({
                objectMode: true,
                transform: function(entry,e,cb) {
                    const fileName = entry.path;
                    const type = entry.type; 
                    const size = entry.vars.uncompressedSize;
                    if (type.isFile()) {
                        filePaths.push(entry);
                    }   
                }
            }));

            return new Promise(function (resolve, reject) {
                entry.on('error', reject);
                entry.on('end', function () {
                    resolve(filePaths);
                });
            });
        })
        .then(function (filePaths) {
            return Promise.map(filePaths, function (filePath) {
                return fsExtra.readFile(filePath)
                    .then(function (data) {
                        filePath = path.normalize(path.relative(inputDirectory, filePath)).replace(/\\/g, '/');
                        // Only gzip tiles and json files. Other files like external textures should not be gzipped.
                        var shouldGzip = isTile(filePath) || path.extname(filePath) === '.json';
                        if (shouldGzip && !isGzipped(data)) {
                            data = zlib.gzipSync(data);
                        }
                        return dbRun('INSERT INTO media VALUES (?, ?)', [filePath, data]);
                    });
            }, {concurrency: 100});
        })
        .then(function () {
            return dbRun('COMMIT');
        })
        .finally(function () {
            if (defined(db)) {
                db.close();
            }
        });
}
