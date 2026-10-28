// Accounts: PBKDF2 password hashing and HS256 session tokens, all on WebCrypto
// (available in Workers with no dependencies).
import { HttpError, json, readJson } from './http.js';
import { deleteUserBookFiles } from './books.js';

const PBKDF2_ITERATIONS = 100000; // Workers' maximum for PBKDF2
const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const encoder = new TextEncoder();

const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const toBase64Url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = text => {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(password, stored) {
    const [scheme, iterations, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2-sha256') return false;
    const actual = await derive(password, fromBase64(salt), Number(iterations));
    return constantTimeEqual(actual, fromBase64(hash));
}

// Used when the email is unknown so that response time does not reveal which accounts exist.
const DUMMY_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function signingKey(env, usages) {
    requireAuthSecret(env);
    return crypto.subtle.importKey('raw', encoder.encode(env.AUTH_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

function requireAuthSecret(env) {
    if (!env.AUTH_SECRET || encoder.encode(env.AUTH_SECRET).length < 32) {
        throw new Error('AUTH_SECRET must be set to a random value of at least 32 bytes.');
    }
}

async function createToken(env, userId) {
    const now = Math.floor(Date.now() / 1000);
    const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = toBase64Url(encoder.encode(JSON.stringify({
        sub: String(userId), iat: now, exp: now + TOKEN_LIFETIME_SECONDS
    })));
    const input = `${header}.${payload}`;
    const signature = await crypto.subtle.sign('HMAC', await signingKey(env, ['sign']), encoder.encode(input));
    return `${input}.${toBase64Url(signature)}`;
}

// Returns the numeric user id for a valid Bearer token, or null.
export async function authenticatedUserId(request, env) {
    const match = (request.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9._-]+)$/);
    if (!match) return null;
    const parts = match[1].split('.');
    if (parts.length !== 3) return null;

    let header, payload, signature;
    try {
        header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
        payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
        signature = fromBase64Url(parts[2]);
    } catch {
        return null;
    }
    // crypto.subtle.verify compares the HMAC in constant time.
    const valid = await crypto.subtle.verify('HMAC', await signingKey(env, ['verify']),
        signature, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT'
        || !payload || typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub)
        || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
        return null;
    }
    return Number(payload.sub);
}

function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email;
}

export async function handleSignup(request, env) {
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || name.length > 80) throw new HttpError(400, 'Name must be between 1 and 80 characters.');
    if (!email) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8 || encoder.encode(password).length > 128) {
        throw new HttpError(400, 'Password must be at least 8 characters and no more than 128 bytes.');
    }

    requireAuthSecret(env);
    const passwordHash = await hashPassword(password);
    try {
        const result = await env.DB
            .prepare('INSERT INTO users (name, email, password_hash) VALUES (?1, ?2, ?3)')
            .bind(name, email, passwordHash).run();
        return json(201, { token: await createToken(env, result.meta.last_row_id) });
    } catch (error) {
        if (/UNIQUE constraint failed/i.test(String(error && error.message))) {
            throw new HttpError(409, 'An account with this email already exists.');
        }
        throw error;
    }
}

export async function handleLogin(request, env) {
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || encoder.encode(password).length > 128) {
        throw new HttpError(400, 'Enter a valid email and password.');
    }

    const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?1')
        .bind(email).first();
    const matches = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.');
    return json(200, { token: await createToken(env, user.id) });
}

export async function handleAccount(request, env, userId, pathname) {
    if (pathname === '/api/account/me') {
        if (request.method === 'GET') {
            const user = await env.DB.prepare(
                'SELECT name, email, created_at FROM users WHERE id = ?1 LIMIT 1')
                .bind(userId).first();
            if (!user) throw new HttpError(401, 'Authentication required.');
            return json(200, {
                name: user.name,
                email: user.email,
                createdAt: user.created_at
            });
        }
        if (request.method !== 'DELETE') {
            return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, DELETE' });
        }
        if (!env.BOOKS || typeof env.BOOKS.list !== 'function') {
            throw new HttpError(503, 'Account deletion is unavailable because book storage is not configured.');
        }

        await deleteUserBookFiles(env.BOOKS, userId);
        await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId).run();
        return json(200, { deleted: true });
    }

    return json(404, { error: 'Not found.' });
}
