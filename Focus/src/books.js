// Book files (PDF/EPUB). Binary data does not belong in SQLite/D1 (2 MB row limit),
// so the bytes go to an R2 bucket, keyed per user; the book list itself is in the `books` table.
import { HttpError, json, readBytes, BASE_HEADERS } from './http.js';

const MAX_BOOK_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'application/epub+zip'];

export async function deleteUserBookFiles(bucket, userId) {
    let cursor;
    do {
        const page = await bucket.list({
            prefix: `${userId}/`,
            ...(cursor ? { cursor } : {})
        });
        if (page.objects.length) {
            await bucket.delete(page.objects.map(object => object.key));
        }
        if (page.truncated && !page.cursor) {
            throw new Error('Book storage returned a truncated listing without a cursor.');
        }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
}

export async function handleBookFile(request, env, userId, pathname) {
    const match = pathname.match(/^\/api\/books\/(book_[A-Za-z0-9_-]{1,120})\/file$/);
    if (!match) throw new HttpError(400, 'Invalid book identifier.');
    if (!env.BOOKS) throw new HttpError(503, 'Book file storage is not configured.');
    const key = `${userId}/${match[1]}`;

    if (request.method === 'PUT') {
        const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.includes(type)) throw new HttpError(415, 'Book files must be PDF or EPUB documents.');
        const bytes = await readBytes(request, MAX_BOOK_FILE_BYTES);
        if (!bytes.length) throw new HttpError(400, 'Book file cannot be empty.');
        await env.BOOKS.put(key, bytes, { httpMetadata: { contentType: type } });
        return json(200, { saved: true });
    }

    if (request.method === 'GET') {
        const object = await env.BOOKS.get(key);
        if (!object) throw new HttpError(404, 'Book file not found.');
        return new Response(object.body, {
            headers: {
                ...BASE_HEADERS,
                'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
                'Content-Length': String(object.size),
                'Cache-Control': 'private, no-store'
            }
        });
    }

    if (request.method === 'DELETE') {
        await env.BOOKS.delete(key);
        return json(200, { deleted: true });
    }

    return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, PUT, DELETE' });
}
