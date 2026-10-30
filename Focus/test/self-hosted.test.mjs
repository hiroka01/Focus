import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { handleRequest } from '../src/worker.js';
import { FileBookStorage, SQLiteDatabase } from '../src/sqlite-storage.js';

const SECRET = 'self-hosted-test-secret-with-at-least-32-bytes';
let directory;
let env;
let database;

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'focus-self-hosted-'));
    database = new SQLiteDatabase(join(directory, 'db', 'focus.sqlite'), join(import.meta.dirname, '..', 'migrations'));
    env = {
        DB: database,
        BOOKS: new FileBookStorage(join(directory, 'books')),
        AUTH_SECRET: SECRET
    };
});

afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
});

async function call(method, path, { token, body, raw, type } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
    } else if (raw !== undefined) {
        body = raw;
        headers['Content-Type'] = type;
    }
    return handleRequest(new Request(`http://localhost${path}`, { method, headers, body }), env);
}

describe('self-hosted SQLite and book storage', () => {
    test('persists account and app data across database restarts', async () => {
        const signup = await call('POST', '/api/auth/signup', {
            body: { name: 'Ada', email: 'ada@example.com', password: 'correct horse' }
        });
        assert.equal(signup.status, 201);
        const { token } = await signup.json();

        const save = await call('PUT', '/api/data/tasks', {
            token,
            body: { data: [{ id: 'task_1', title: 'Persist this', completed: false }] }
        });
        assert.equal(save.status, 200);

        database.close();
        database = new SQLiteDatabase(join(directory, 'db', 'focus.sqlite'), join(import.meta.dirname, '..', 'migrations'));
        env.DB = database;

        const read = await call('GET', '/api/data', { token });
        assert.equal(read.status, 200);
        assert.equal((await read.json()).data.tasks[0].title, 'Persist this');
    });

    test('stores book files on disk and removes them with account deletion', async () => {
        const signup = await call('POST', '/api/auth/signup', {
            body: { name: 'Ada', email: 'books@example.com', password: 'correct horse' }
        });
        const { token } = await signup.json();

        const upload = await call('PUT', '/api/books/book_1/file', {
            token,
            raw: new Uint8Array([1, 2, 3]),
            type: 'application/pdf'
        });
        assert.equal(upload.status, 200);

        const download = await call('GET', '/api/books/book_1/file', { token });
        assert.equal(download.status, 200);
        assert.equal(download.headers.get('content-type'), 'application/pdf');
        assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3]);

        const deletion = await call('DELETE', '/api/account/me', { token });
        assert.equal(deletion.status, 200);
        assert.equal((await call('GET', '/api/books/book_1/file', { token })).status, 404);
    });
});
