const Util = require('util');
const Commit = require('./commit');
const {Octokit} = require('@octokit/rest');

module.exports = class Repo {
    static isFetchingCommitsFromGithub = false;
    id = null;
    owner = '';
    name = '';
    auth = '';

    fetchCommitsStatusUpdateTimestamp = 0;

    constructor(data) {
        let keys = Object.keys(this);
        for (let key of keys) {
            this[key] = data[key] || this[key];
        }
    }

    static async get(c, id) {
        let result = await Util.promisify(c.query).call(c, 'SELECT * FROM repos WHERE id = ?', [id]);
        return new Repo(result[0]);
    }

    /** @returns {Promise<[Repo]>} */
    static async list(c) {
        let result = await Util.promisify(c.query).call(c, 'SELECT * FROM repos');
        let repos = result.map(r => new Repo(r));
        return repos;
    }

    static async createTable(c) {
        let result = await Util.promisify(c.query).call(c, `CREATE TABLE IF NOT EXISTS repos (
            id int(11) NOT NULL auto_increment,
            owner varchar(250) NOT NULL,
            name varchar(250) NOT NULL,
            auth varchar(250) NOT NULL,
            fetchCommitsStatusUpdateTimestamp bigint unsigned NOT NULL default 0,
            PRIMARY KEY (id)
        )`);
    }

    static async fetchCommitsFromGithub(c) {
        if (Repo.isFetchingCommitsFromGithub) {
            return;
        }
        Repo.isFetchingCommitsFromGithub = true;

        let repos = await Repo.list(c);
        for (let repo of repos) {
            try {
                await repo.fetchCommitsFromGithub(c);
            } catch (err) {
                console.log(err);
            }
        }

        Repo.isFetchingCommitsFromGithub = false;
    }

    async save(c) {
        const keys = Object.keys(this);
        const result = await c.awaitQuery(`INSERT INTO repos (${keys.join(',')}) VALUES(${keys.map(k => '?').join(',')}) 
                ON DUPLICATE KEY UPDATE ${keys.map(k => k + ' = VALUES(' + k + ')').join(',')}`,
            keys.map(k => this[k]));
        this.id = result.insertId;
        return this;
    }

    async testConnection() {
        const octokit = new Octokit({
            auth: this.auth,
            userAgent: "KedemVatIT v1.0.0"
        });
        let commits = await octokit.repos.listCommits({owner: this.owner, repo: this.name, per_page: 1});
        return true;
    }

    async delete(c) {
        await c.awaitQuery('DELETE FROM repos WHERE id = ?', [this.id]);
        this.id = null;
    }

    async fetchCommitsFromGithub(c) {
        //  "ab23cff85c438c4da1d0a0fc5f3609ab9f310a3f"
        console.log(`Fetching commits from Github for ${this.owner}/${this.name}`);
        const octokit = new Octokit({
            auth: this.auth,
            userAgent: "KedemVatIT v1.0.0"
        });

        let lastCommit = await Commit.getLatestByRepositoryId(c, this.id);
        let since = lastCommit ? new Date(lastCommit.timestamp) : new Date(0);

        let page = 1;
        let commits = await octokit.repos.listCommits({
            owner: this.owner,
            repo: this.name,
            since: since,
            page: page,
            per_page: 100
        });

        while (commits.data.length) {
            for (let commit of commits.data) {
                let newCommit = await Commit.parseFromGit(c, this, commit);
                await newCommit.save(c);
            }

            commits = await octokit.repos.listCommits({
                owner: this.owner,
                repo: this.name,
                since: since,
                page: ++page,
                per_page: 100
            });
        }

        await this.save(c);
    }
}