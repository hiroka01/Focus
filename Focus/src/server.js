import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { deliverDueReminders } from './notifications.js';
import { handleRequest } from './worker.js';
import { FileBookStorage, SQLiteDatabase } from './sqlite-storage.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = resolve(root, 'dist');
const databasePath = resolve(process.env.DATABASE_PATH || resolve(root, 'data', 'focus.sqlite'));
const booksPath = resolve(process.env.BOOKS_PATH || resolve(root, 'data', 'books'));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

if (!process.env.AUTH_SECRET || Buffer.byteLength(process.env.AUTH_SECRET) < 32) {
    throw new Error('AUTH_SECRET must be set to a random value of at least 32 bytes.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
}

const database = new SQLiteDatabase(databasePath, resolve(root, 'migrations'));
const env = {
    DB: database,
    BOOKS: new FileBookStorage(booksPath),
    AUTH_SECRET: process.env.AUTH_SECRET,
    CORS_ORIGINS: process.env.CORS_ORIGINS || '',
    PUSH_VAPID_PUBLIC_KEY: process.env.PUSH_VAPID_PUBLIC_KEY || '',
    PUSH_VAPID_PRIVATE_JWK: process.env.PUSH_VAPID_PRIVATE_JWK || '',
    PUSH_VAPID_SUBJECT: process.env.PUSH_VAPID_SUBJECT || ''
};

const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

async function serveAsset(request, response) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end('Bad request');
        return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = resolve(assetsDirectory, relativePath);
    const fromRoot = relative(assetsDirectory, file);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
        response.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const fileStats = await stat(file);
        if (!fileStats.isFile()) {
            response.writeHead(404).end('Not found');
            return;
        }
        response.writeHead(200, {
            'Content-Type': contentTypes.get(extname(file)) || 'application/octet-stream',
            'Content-Length': fileStats.size,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') response.end();
        else await pipeline(createReadStream(file), response);
    } catch (error) {
        if (error.code === 'ENOENT') response.writeHead(404).end('Not found');
        else throw error;
    }
}

async function serveApi(incoming, outgoing) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) headers.set(name, value.join(', '));
        else if (value !== undefined) headers.set(name, value);
    }
    const method = incoming.method || 'GET';
    const hasBody = !['GET', 'HEAD'].includes(method);
    const request = new Request(`http://${headers.get('host') || 'localhost'}${incoming.url}`, {
        method,
        headers,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {})
    });
    const response = await handleRequest(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
        outgoing.end();
        return;
    }
    await pipeline(Readable.fromWeb(response.body), outgoing);
}

const server = createServer(async (request, response) => {
    try {
        if ((request.url || '').startsWith('/api/') || request.url === '/healthz') {
            await serveApi(request, response);
        } else if (request.method === 'GET' || request.method === 'HEAD') {
            await serveAsset(request, response);
        } else {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
        }
    } catch (error) {
        console.error('HTTP request failed:', error);
        if (!response.headersSent) response.writeHead(500);
        response.end('The request could not be completed.');
    }
});

server.listen(port, host, () => {
    console.log(`Focus is running at http://${host}:${port}`);
    console.log(`SQLite database: ${databasePath}`);
    console.log(`Book files: ${booksPath}`);
});
server.on('error', error => {
    console.error(`Focus could not listen on ${host}:${port}:`, error.message);
    database.close();
    process.exitCode = 1;
});

let remindersRunning = false;
const reminderTimer = setInterval(async () => {
    if (remindersRunning) return;
    remindersRunning = true;
    try {
        await deliverDueReminders(env);
    } catch (error) {
        console.error('Scheduled reminder delivery failed:', error);
    } finally {
        remindersRunning = false;
    }
}, 60_000);
reminderTimer.unref();

function shutdown() {
    clearInterval(reminderTimer);
    server.close(() => {
        database.close();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
