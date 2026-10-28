import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../src/worker.js';
import { FakeD1, FakeR2 } from './d1-shim.mjs';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const SECRET = 'test-secret-test-secret-test-secret-0123456789';

let env;
beforeEach(() => {
    env = { DB: new FakeD1(migrations), BOOKS: new FakeR2(), AUTH_SECRET: SECRET };
});

async function call(method, path, { token, body, headers = {}, raw, type } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (raw !== undefined) {
        init.body = raw;
        init.headers['Content-Type'] = type;
    } else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
    }
    const response = await worker.fetch(new Request(`https://focus.test${path}`, init), env);
    const contentType = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, response,
        body: contentType.includes('application/json') ? await response.json() : null };
}

async function signup(email = 'ada@example.com', name = 'Ada') {
    const { status, body } = await call('POST', '/api/auth/signup', { body: { name, email, password: 'correct horse' } });
    assert.equal(status, 201);
    return body.token;
}

const sample = () => ({
    calendar: [{ id: 'e_2', title: 'Exam', date: '2026-11-02', time: '09:00',
                 tag: 'School', tagColor: '#ef4444', location: 'Science Hall',
                 reminderMinutes: 60, reminderAt: '2026-11-02T08:00:00.000Z' },
               { id: 'e_1', title: 'Gym', date: '2026-11-03', time: '' }],
    tasks: [{ id: 't_2', title: 'Write essay', priority: 'High', category: 'Study', completed: true },
            { id: 't_1', title: 'Read ch. 3', priority: 'Low', category: 'Study', completed: false }],
    notes: [{ id: 'n_1', title: 'Welcome', content: 'Line 1\n\n- "quotes" and émoji 📌', pinned: true, updatedAt: '10/28/2026' }],
    journals: [{ id: 'j_1', text: 'Good day', mood: '○', date: '10/28/2026' }],
    books: [{ id: 'book_1', title: 'Deep Work', format: 'pdf', createdAt: '2026-10-01T00:00:00.000Z', status: 'Finished' }],
    study: [{ id: 'sp_1', subject: 'Math', topic: 'Limits', target: 10, completed: 2.5, deadline: '2026-12-01' }],
    timetable: { 'Mon_08:00': 'Lecture', 'Tue_10:00': 'Lab' },
    results: [{ id: 'r_1', subject: 'Physics', target: 80, actual: 91.5 }],
    pomoStats: { sessions: 4, totalMinutes: 100 },
    preferences: { theme: 'dark' }
});

describe('health and routing', () => {
    test('healthz reaches the database', async () => {
        const { status, body } = await call('GET', '/healthz');
        assert.equal(status, 200);
        assert.equal(body.status, 'ok');
    });
    test('unknown API routes are JSON 404s', async () => {
        const { status, body } = await call('GET', '/api/nope');
        assert.equal(status, 404);
        assert.ok(body.error);
    });
});

describe('accounts', () => {
    test('signup validates input', async () => {
        const bad = [
            { name: '', email: 'a@b.co', password: 'longenough' },
            { name: 'A', email: 'not-an-email', password: 'longenough' },
            { name: 'A', email: 'a@b.co', password: 'short' }
        ];
        for (const body of bad) {
            const { status } = await call('POST', '/api/auth/signup', { body });
            assert.equal(status, 400);
        }
    });
    test('signup does not create an account when AUTH_SECRET is missing', async () => {
        delete env.AUTH_SECRET;
        const { status, body } = await call('POST', '/api/auth/signup', {
            body: { name: 'Ada', email: 'ada@example.com', password: 'correct horse' }
        });
        assert.equal(status, 500);
        assert.equal(body.error, 'The request could not be completed. Please try again.');
        assert.equal(env.DB.query('SELECT COUNT(*) AS count FROM users')[0].count, 0);
    });
    test('signup, duplicate email (case-insensitive), login', async () => {
        await signup('Ada@Example.com');
        const dup = await call('POST', '/api/auth/signup', { body: { name: 'X', email: 'ada@example.COM', password: 'password123' } });
        assert.equal(dup.status, 409);

        const ok = await call('POST', '/api/auth/login', { body: { email: 'ADA@example.com', password: 'correct horse' } });
        assert.equal(ok.status, 200);
        assert.ok(ok.body.token);

        const wrong = await call('POST', '/api/auth/login', { body: { email: 'ada@example.com', password: 'wrong password' } });
        assert.equal(wrong.status, 401);
        const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever123' } });
        assert.equal(unknown.status, 401);
    });
    test('passwords are stored hashed, never in plain text', async () => {
        await signup();
        const [row] = env.DB.query('SELECT password_hash FROM users');
        assert.match(row.password_hash, /^pbkdf2-sha256\$100000\$/);
        assert.ok(!row.password_hash.includes('correct horse'));
    });
    test('auth endpoints require JSON', async () => {
        const { status } = await call('POST', '/api/auth/login', { raw: 'email=a', type: 'text/plain' });
        assert.equal(status, 415);
    });
    test('data endpoints reject missing, tampered and expired tokens', async () => {
        assert.equal((await call('GET', '/api/data')).status, 401);
        const token = await signup();
        const [h, p, s] = token.split('.');
        const forgedPayload = Buffer.from(JSON.stringify({ sub: '999', exp: 9999999999 })).toString('base64url');
        assert.equal((await call('GET', '/api/data', { token: `${h}.${forgedPayload}.${s}` })).status, 401);
        assert.equal((await call('GET', '/api/data', { token })).status, 200);

        const realNow = Date.now;
        Date.now = () => realNow() + 25 * 3600 * 1000;
        try {
            assert.equal((await call('GET', '/api/data', { token })).status, 401);
        } finally {
            Date.now = realNow;
        }
    });
    test('account details and account endpoint methods', async () => {
        const token = await signup();
        const me = await call('GET', '/api/account/me', { token });
        assert.equal(me.status, 200);
        assert.equal(me.body.name, 'Ada');
        assert.equal(me.body.email, 'ada@example.com');
        assert.ok(!Number.isNaN(new Date(me.body.createdAt).getTime()));
        assert.equal((await call('POST', '/api/account/me', { token })).status, 405);
        assert.equal((await call('POST', '/api/account/deletion-request', { token })).status, 404);
    });
    test('permanent account deletion removes owned database data and book files', async () => {
        const ada = await signup('ada@example.com', 'Ada');
        const bob = await signup('bob@example.com', 'Bob');
        const adaId = env.DB.query('SELECT id FROM users WHERE email = ?', 'ada@example.com')[0].id;
        const bobId = env.DB.query('SELECT id FROM users WHERE email = ?', 'bob@example.com')[0].id;

        await call('PUT', '/api/data/tasks', {
            token: ada,
            body: { data: [{ id: 't_ada', title: 'Private task', completed: false }] }
        });
        await call('PUT', '/api/books/book_ada/file', {
            token: ada,
            raw: new Uint8Array([1, 2, 3]),
            type: 'application/pdf'
        });
        for (let index = 0; index < 1002; index++) {
            await env.BOOKS.put(`${adaId}/extra-${index}`, new Uint8Array([index % 256]));
        }
        await call('PUT', '/api/books/book_bob/file', {
            token: bob,
            raw: new Uint8Array([4, 5, 6]),
            type: 'application/pdf'
        });

        const deleted = await call('DELETE', '/api/account/me', { token: ada });
        assert.equal(deleted.status, 200);
        assert.equal(deleted.body.deleted, true);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM users')[0].n, 1);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', adaId)[0].n, 0);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM books WHERE user_id = ?', adaId)[0].n, 0);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', bobId)[0].n, 1);
        assert.equal([...env.BOOKS.objects.keys()].some(key => key.startsWith(`${adaId}/`)), false);
        assert.equal(env.BOOKS.objects.has(`${bobId}/book_bob`), true);
        assert.equal((await call('GET', '/api/account/me', { token: ada })).status, 401);
        assert.equal((await call('GET', '/api/data', { token: bob })).status, 200);
    });
});

describe('app data', () => {
    test('fresh account is uninitialized with empty sections', async () => {
        const token = await signup();
        const { status, body } = await call('GET', '/api/data', { token });
        assert.equal(status, 200);
        assert.equal(body.initialized, false);
        assert.deepEqual(body.data.tasks, []);
        assert.deepEqual(body.data.timetable, {});
        assert.deepEqual(body.data.pomoStats, {});
    });

    test('bootstrap stores everything and reads it back identically', async () => {
        const token = await signup();
        const data = sample();
        const boot = await call('POST', '/api/data/bootstrap', { token, body: { data } });
        assert.equal(boot.status, 201);

        const { body } = await call('GET', '/api/data', { token });
        assert.equal(body.initialized, true);
        assert.deepEqual(body.data, data);
    });

    test('data lands in real relational tables', async () => {
        const token = await signup();
        await call('POST', '/api/data/bootstrap', { token, body: { data: sample() } });
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM tasks')[0].n, 2);
        assert.deepEqual(env.DB.query('SELECT title FROM tasks WHERE completed = 1').map(r => r.title), ['Write essay']);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM timetable_slots')[0].n, 2);
        assert.equal(env.DB.query('SELECT theme FROM preferences')[0].theme, 'dark');
        assert.equal(env.DB.query('SELECT total_minutes FROM pomo_stats')[0].total_minutes, 100);
        assert.equal(env.DB.query('SELECT title, remind_at FROM event_reminders')[0].title, 'Exam');
    });

    test('bootstrap can only run once', async () => {
        const token = await signup();
        await call('POST', '/api/data/bootstrap', { token, body: { data: sample() } });
        const again = await call('POST', '/api/data/bootstrap', { token, body: { data: sample() } });
        assert.equal(again.status, 409);
    });

    test('bootstrap with an invalid section changes nothing', async () => {
        const token = await signup();
        const data = sample();
        data.tasks = 'nope';
        assert.equal((await call('POST', '/api/data/bootstrap', { token, body: { data } })).status, 400);
        const { body } = await call('GET', '/api/data', { token });
        assert.equal(body.initialized, false);
        assert.deepEqual(body.data.calendar, []);
    });

    test('PUT replaces a section, keeps order, and supports edits and deletes', async () => {
        const token = await signup();
        await call('POST', '/api/data/bootstrap', { token, body: { data: sample() } });

        const next = [
            { id: 't_3', title: 'New first', priority: 'High', category: 'Work', completed: false },
            { id: 't_1', title: 'Read ch. 3', priority: 'Low', category: 'Study', completed: true }
        ];
        assert.equal((await call('PUT', '/api/data/tasks', { token, body: { data: next } })).status, 200);
        assert.deepEqual((await call('GET', '/api/data', { token })).body.data.tasks, next);

        await call('PUT', '/api/data/tasks', { token, body: { data: [] } });
        assert.deepEqual((await call('GET', '/api/data', { token })).body.data.tasks, []);
        // other sections untouched
        assert.equal((await call('GET', '/api/data', { token })).body.data.notes.length, 1);
    });

    test('push subscriptions are private to the account and can be removed', async () => {
        const token = await signup();
        env.PUSH_VAPID_PUBLIC_KEY = 'public-key';
        env.PUSH_VAPID_PRIVATE_JWK = '{"d":"private-key"}';
        env.PUSH_VAPID_SUBJECT = 'mailto:owner@example.com';
        const config = await call('GET', '/api/notifications/config', { token });
        assert.equal(config.status, 200);
        assert.equal(config.body.pushConfigured, true);

        const subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/device',
            keys: { p256dh: 'public-device-key', auth: 'auth-device-key' }
        };
        const saved = await call('POST', '/api/notifications/subscriptions', {
            token, body: { subscription }
        });
        assert.equal(saved.status, 201);
        assert.equal((await call('GET', '/api/notifications/subscriptions', { token })).body.count, 1);
        const removed = await call('DELETE', '/api/notifications/subscriptions', {
            token, body: { endpoint: subscription.endpoint }
        });
        assert.equal(removed.status, 200);
        assert.equal((await call('GET', '/api/notifications/subscriptions', { token })).body.count, 0);
        assert.equal((await call('POST', '/api/notifications/subscriptions', {
            token,
            body: { subscription: { ...subscription, endpoint: 'https://127.0.0.1/push' } }
        })).status, 400);
    });

    test('notification preferences load with defaults and persist per account', async () => {
        const token = await signup();
        const defaults = await call('GET', '/api/notifications/preferences', { token });
        assert.deepEqual(defaults.body, { eventReminders: true, timerAlerts: true });

        const saved = await call('PUT', '/api/notifications/preferences', {
            token, body: { eventReminders: false, timerAlerts: true }
        });
        assert.equal(saved.status, 200);
        assert.deepEqual((await call('GET', '/api/notifications/preferences', { token })).body,
            { eventReminders: false, timerAlerts: true });
        assert.equal((await call('PUT', '/api/notifications/preferences', {
            token, body: { eventReminders: 'off', timerAlerts: true }
        })).status, 400);
    });

    test('background timer notifications can be scheduled, replaced, and cancelled', async () => {
        const token = await signup();
        const endsAt = new Date(Date.now() + 60_000).toISOString();
        const scheduled = await call('POST', '/api/notifications/timer', {
            token, body: { mode: 'focus', endsAt }
        });
        assert.equal(scheduled.status, 200);
        assert.equal(env.DB.query('SELECT mode FROM timer_notifications')[0].mode, 'focus');

        assert.equal((await call('POST', '/api/notifications/timer', {
            token, body: { mode: 'unknown', endsAt }
        })).status, 400);

        const removed = await call('DELETE', '/api/notifications/timer', { token, body: {} });
        assert.equal(removed.status, 200);
        assert.equal(env.DB.query('SELECT COUNT(*) AS count FROM timer_notifications')[0].count, 0);
    });

    test('unknown fields are preserved, duplicate ids collapse', async () => {
        const token = await signup();
        const notes = [
            { id: 'n_a', title: 'A', content: 'x', pinned: false, updatedAt: 'd', color: 'red', tags: ['a', 'b'] },
            { id: 'n_b', title: 'B', content: 'y', pinned: false, updatedAt: 'd' },
            { id: 'n_a', title: 'A v2', content: 'x2', pinned: true, updatedAt: 'd', color: 'blue' }
        ];
        assert.equal((await call('PUT', '/api/data/notes', { token, body: { data: notes } })).status, 200);
        const stored = (await call('GET', '/api/data', { token })).body.data.notes;
        assert.deepEqual(stored.map(n => n.id), ['n_b', 'n_a']);
        assert.equal(stored[1].title, 'A v2');
        assert.equal(stored[1].color, 'blue');
        assert.equal(stored[1].pinned, true);
    });

    test('PUT with data for a section never seen before also marks the account initialized', async () => {
        const token = await signup();
        await call('PUT', '/api/data/preferences', { token, body: { data: { theme: 'light' } } });
        const { body } = await call('GET', '/api/data', { token });
        assert.equal(body.initialized, true);
        assert.deepEqual(body.data.preferences, { theme: 'light' });
    });

    test('timetable cells can be cleared', async () => {
        const token = await signup();
        await call('PUT', '/api/data/timetable', { token, body: { data: { 'Mon_08:00': 'Lecture', 'Tue_10:00': '' } } });
        assert.deepEqual((await call('GET', '/api/data', { token })).body.data.timetable, { 'Mon_08:00': 'Lecture' });
    });

    test('validation errors', async () => {
        const token = await signup();
        const cases = [
            ['tasks', { not: 'an array' }],
            ['tasks', [{ title: 'no id' }]],
            ['tasks', [{ id: 't', completed: 'yes' }]],
            ['calendar', [{ id: 'e', reminderAt: 'not-a-date', reminderMinutes: 60 }]],
            ['results', [{ id: 'r', actual: 'ninety' }]],
            ['timetable', []],
            ['timetable', { 'Mon_08:00': 5 }],
            ['pomoStats', { sessions: -1 }],
            ['preferences', { theme: 'neon' }]
        ];
        for (const [section, data] of cases) {
            const { status } = await call('PUT', `/api/data/${section}`, { token, body: { data } });
            assert.equal(status, 400, `${section} ${JSON.stringify(data)}`);
        }
        assert.equal((await call('PUT', '/api/data/bogus', { token, body: { data: [] } })).status, 404);
        assert.equal((await call('PUT', '/api/data/tasks', { token, raw: '[]', type: 'text/plain' })).status, 415);
        assert.equal((await call('PUT', '/api/data/tasks', { token, raw: '{oops', type: 'application/json' })).status, 400);
        assert.equal((await call('DELETE', '/api/data/tasks', { token })).status, 405);
    });

    test('oversized sections are rejected with 413', async () => {
        const token = await signup();
        const big = [{ id: 'n_big', title: 'big', content: 'x'.repeat(1_600_000), pinned: false, updatedAt: 'd' }];
        assert.equal((await call('PUT', '/api/data/notes', { token, body: { data: big } })).status, 413);
    });

    test('SQL-looking text is stored as plain text', async () => {
        const token = await signup();
        const title = `x'); DROP TABLE tasks; --`;
        await call('PUT', '/api/data/tasks', { token, body: { data: [{ id: 't_1', title, priority: 'Low', category: 'c', completed: false }] } });
        assert.equal((await call('GET', '/api/data', { token })).body.data.tasks[0].title, title);
        assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM tasks')[0].n, 1);
    });

    test('users cannot see each other\'s data, even with identical ids', async () => {
        const ada = await signup('ada@example.com', 'Ada');
        const bob = await signup('bob@example.com', 'Bob');
        await call('PUT', '/api/data/tasks', { token: ada, body: { data: [{ id: 't_1', title: 'Ada task', priority: 'Low', category: 'c', completed: false }] } });
        await call('PUT', '/api/data/tasks', { token: bob, body: { data: [{ id: 't_1', title: 'Bob task', priority: 'Low', category: 'c', completed: false }] } });
        assert.equal((await call('GET', '/api/data', { token: ada })).body.data.tasks[0].title, 'Ada task');
        assert.equal((await call('GET', '/api/data', { token: bob })).body.data.tasks[0].title, 'Bob task');
    });
});

describe('book files', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4]);

    test('upload, download, delete', async () => {
        const token = await signup();
        const up = await call('PUT', '/api/books/book_123/file', { token, raw: pdf, type: 'application/pdf' });
        assert.equal(up.status, 200);

        const down = await call('GET', '/api/books/book_123/file', { token });
        assert.equal(down.status, 200);
        assert.equal(down.headers.get('content-type'), 'application/pdf');
        assert.deepEqual(new Uint8Array(await down.response.arrayBuffer()), pdf);

        assert.equal((await call('DELETE', '/api/books/book_123/file', { token })).status, 200);
        assert.equal((await call('GET', '/api/books/book_123/file', { token })).status, 404);
    });
    test('rejects wrong type, empty body, bad ids', async () => {
        const token = await signup();
        assert.equal((await call('PUT', '/api/books/book_1/file', { token, raw: pdf, type: 'text/html' })).status, 415);
        assert.equal((await call('PUT', '/api/books/book_1/file', { token, raw: new Uint8Array(0), type: 'application/pdf' })).status, 400);
        // path traversal is normalised away by URL parsing, so it never reaches the book handler
        assert.equal((await call('GET', '/api/books/../../x/file', { token })).status, 404);
        assert.equal((await call('GET', '/api/books/notabook/file', { token })).status, 400);
        assert.equal((await call('GET', '/api/books/book_1/file')).status, 401);
    });
    test('files are private to their owner', async () => {
        const ada = await signup('ada@example.com');
        const bob = await signup('bob@example.com');
        await call('PUT', '/api/books/book_1/file', { token: ada, raw: pdf, type: 'application/pdf' });
        assert.equal((await call('GET', '/api/books/book_1/file', { token: bob })).status, 404);
        assert.equal((await call('GET', '/api/books/book_1/file', { token: ada })).status, 200);
    });
});

describe('CORS', () => {
    test('same-origin requests work; unlisted cross-origin requests are refused', async () => {
        const same = await call('GET', '/healthz', { headers: { Origin: 'https://focus.test' } });
        assert.equal(same.status, 200);
        const other = await call('GET', '/healthz', { headers: { Origin: 'https://evil.example' } });
        assert.equal(other.status, 403);
    });
    test('listed origins get CORS headers and preflight succeeds', async () => {
        env.CORS_ORIGINS = 'https://me.github.io';
        const pre = await call('OPTIONS', '/api/data', { headers: { Origin: 'https://me.github.io' } });
        assert.equal(pre.status, 204);
        assert.equal(pre.headers.get('access-control-allow-origin'), 'https://me.github.io');
        const get = await call('GET', '/healthz', { headers: { Origin: 'https://me.github.io' } });
        assert.equal(get.headers.get('access-control-allow-origin'), 'https://me.github.io');
    });
});
