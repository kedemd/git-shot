const fs = require('fs');
const Util = require('util');
const Path = require('path');
const Pageres = require('pageres');

module.exports = class Commit {
    sha = null;
    repoId = null;
    timestamp;
    email;
    message = '';
    url;
    htmlUrl;
    screenshotPath = null;

    constructor(data) {
        let keys = Object.keys(this);
        for (let key of keys) {
            this[key] = data[key] || this[key];
        }
    }

    static async parseFromGit(c, repo, gitCommit) {
        let commit = new Commit({
            sha: gitCommit.sha,
            repoId: repo.id,
            timestamp: new Date(gitCommit.commit.author.date).getTime(),
            email: gitCommit.commit.author.email,
            message: gitCommit.commit.message,
            url: gitCommit.url,
            htmlUrl: gitCommit.html_url
        });

        return commit;
    }

    static async get(c, sha) {
        let results = await Util.promisify(c.query).call(c, `SELECT * FROM commits WHERE sha = ?`, [sha]);
        return new Commit(results[0]);
    }

    static async getLatestByRepositoryId(c, repoId) {
        let result = (await Util.promisify(c.query).call(c, 'SELECT * FROM commits WHERE repoId = ? ORDER BY timestamp DESC LIMIT 1', [repoId]))[0];
        if (!result) {
            return null;
        }

        return new Commit(result);
    }

    static async list(c, repositoryId) {
        let results = await Util.promisify(c.query).call(c, `SELECT * FROM commits WHERE repoId = ?`, [repositoryId]);
        return results.map(r => new Commit(r));
    }

    static async takeScreenshots(c) {
        let results = await c.awaitQuery('SELECT * FROM commits WHERE screenshotPath IS NULL LIMIT 10');
        let commits = results.map(r => new Commit(r));

        for (let commit of commits) {
            await commit.takeScreenshot(c);
        }

        return commits;
    }

    static async createTable(c) {
        return await Util.promisify(c.query).call(c, `CREATE TABLE IF NOT EXISTS commits (
            sha varchar(250) NOT NULL,
            repoId int(11) NOT NULL,
            timestamp bigint unsigned NOT NULL,
            email varchar(250) NOT NULL,
            message text NOT NULL,
            url varchar(250) NOT NULL,
            htmlUrl varchar(250) NOT NULL,
            screenshotPath varchar(250) default NULL,
            PRIMARY KEY (sha),
            CONSTRAINT FK_RepoCommit FOREIGN KEY (repoId) REFERENCES repos(id) ON DELETE CASCADE
        )`);
    }

    async takeScreenshot(c) {
        let path = Path.join(__dirname, '..', 'screenshots', this.sha + '.png');
        if (await Util.promisify(fs.exists).call(fs, path)) {
            this.screenshotPath = Path.join(__dirname, '..', 'screenshots', this.sha + '.png');
            await this.save(c);
            return;
        }

        try {
            await new Pageres().src(this.htmlUrl, ['1280x1024'], {filename: this.sha}).dest(Path.join(__dirname, '..', 'screenshots')).run();
            this.screenshotPath = Path.join(__dirname, '..', 'screenshots', this.sha + '.png');
            await this.save(c);
        } catch (e) {
            console.log(e);
        }
    }

    async save(c) {
        let keys = Object.keys(this);

        let result = await c.awaitQuery(
            `INSERT INTO commits (${keys.join(',')}) VALUES(${keys.map(k => '?').join(',')})
            ON DUPLICATE KEY UPDATE ${keys.map(k => k + ' = VALUES(' + k + ')').join(',')}`,
            keys.map(k => this[k]));
        this.sha = result.insertId;
    }
}