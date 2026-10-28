// Small HTTP helpers shared by the Worker modules.

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export const BASE_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
};

export function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...headers }
    });
}

export function isJsonRequest(request) {
    return (request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json');
}

// Reads a request body as bytes, refusing anything larger than maxBytes
// (even when the client lies about, or omits, Content-Length).
export async function readBytes(request, maxBytes) {
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError(413, 'Request body is too large.');
    }
    if (!request.body) return new Uint8Array(0);

    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new HttpError(413, 'Request body is too large.');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

export async function readJson(request, maxBytes) {
    const bytes = await readBytes(request, maxBytes);
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new HttpError(400, 'Request body must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new HttpError(400, 'Request body must be a JSON object.');
    }
    return parsed;
}

export function utf8Length(value) {
    return new TextEncoder().encode(value).length;
}
