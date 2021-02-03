const Mysql = require('mysql');
const Util = require('util');
const Pool = Mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'vatit'
});

exports.getConnection = async () => {
    return new Promise((resolve, reject) => {
        Pool.getConnection((err, c) => {
           if (err){
               return reject(err);
           }
           c.query()
           c.awaitQuery = async (query, params = []) => {
               return new Promise((resolve1, reject1) => {
                   c.query.call(c, query, params, (err, result) => {
                       if (err){
                           return reject1(err);
                       }
                       resolve1(result);
                   });
               });
           }

           return resolve(c);
        });
    });
}

exports.createDB = async () => {
    const c = await exports.getConnection();

    await c.awaitQuery('CREATE DATABASE IF NOT EXISTS vatit');

    const Repo = require('./domain/repo');
    const Commit = require('./domain/commit');

    await Repo.createTable(c);
    await Commit.createTable(c);
}

