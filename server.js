const Hapi = require('@hapi/hapi');
const Boom = require('@hapi/boom');
const Path = require('path');
const DB = require('./db');
const Repo = require('./domain/repo');
const Commit = require('./domain/commit');

async function init(){
    await DB.createDB();

    const server = Hapi.server({
        port: 3000,
        routes: {
            files: {
                relativeTo: Path.join(__dirname, 'public')
            }
        }
    });
    await server.register(require('@hapi/inert'));

    const fetchCommitsLoop = async () => {
        const c = await DB.getConnection();
        await Repo.fetchCommitsFromGithub(c);
        c.release();
        setTimeout(fetchCommitsLoop, 5000);
    }
    fetchCommitsLoop().then(() => {});

    const takeScreenshotsLoop = async() => {
        const c = await DB.getConnection();
        let commits = await Commit.takeScreenshots(c);
        c.release();
        if (commits.length) {
            takeScreenshotsLoop().then(() => {});
        } else {
            setTimeout(takeScreenshotsLoop, 5000);
        }
    }
    takeScreenshotsLoop().then(() => {});

    server.route({
        method: 'GET',
        path: '/{param*}',
        handler: {
            directory: {
                path: '.',
                redirectToSlash: true,
                index: ['index.html']
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/repos/{repoId}/commits',
        handler: async (request, h) => {
            let c = await DB.getConnection();

            let commits = await Commit.list(c, request.params.repoId);
            c.release();

            return commits;
        }
    });

    server.route({
        method: 'GET',
        path: '/commits/{commitSha}/screenshot.png',
        handler: async (request, h) => {
            let c = await DB.getConnection();
            let commit = await Commit.get(c, request.params.commitSha);

            await commit.takeScreenshot(c);
            c.release();
            await new Promise(r => setTimeout(r, 3000));

            return h.file(commit.screenshotPath, { confine: false });
        }
    })

    server.route({
        method: 'GET',
        path: '/repos',
        handler: async (request, h) => {
            let c = await DB.getConnection();
            let result = await Repo.list(c);

            c.release();
            return result;
        }
    });

    server.route({
        method: 'POST',
        path: '/repos',
        handler: async (request, h) => {
            let c = await DB.getConnection();
            let repo = new Repo(request.payload);
            try {
                await repo.testConnection();
                await repo.save(c);
                return repo;
            } catch (e) {
                throw e;
            }finally {
                c.release();
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/repos/{repoId}',
        handler: async(request, h) => {
            let c = await DB.getConnection();
            let repo = await Repo.get(c, request.params.repoId);
            await repo.delete(c);

            c.release();
            return repo;
        }
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
}

init().then();