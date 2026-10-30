// Focus API on Cloudflare Workers + D1 (SQLite). Static files are served by the
// Workers assets binding; this code only runs for /api/* and /healthz.
import { authenticatedUserId, handleAccount, handleLogin, handleSignup } from './auth.js';
import { handleBookFile } from './books.js';
import { handleData } from './data.js';
import { deliverDueReminders, handleNotifications } from './notifications.js';
import { HttpError, isJsonRequest, json } from './http.js';

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin'
    };
}

function originAllowed(request, env, url) {
    const origin = request.headers.get('Origin');
    if (!origin || origin === url.origin) return true;
    return (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).includes(origin);
}

async function route(request, env, url) {
    const { pathname } = url;

    if (pathname === '/healthz') {
        await env.DB.prepare('SELECT 1').first();
        return json(200, { status: 'ok' });
    }

    if (pathname === '/api/auth/signup' || pathname === '/api/auth/login') {
        if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
        if (!isJsonRequest(request)) throw new HttpError(415, 'Content-Type must be application/json.');
        return pathname.endsWith('/signup') ? handleSignup(request, env) : handleLogin(request, env);
    }

    const isData = pathname === '/api/data' || pathname.startsWith('/api/data/');
    const isNotification = pathname.startsWith('/api/notifications/');
    const isBook = /^\/api\/books\/.*\/file$/.test(pathname);
    const isAccount = pathname === '/api/account/me';
    if (!isData && !isNotification && !isBook && !isAccount) throw new HttpError(404, 'Not found.');

    const userId = await authenticatedUserId(request, env);
    if (!userId) throw new HttpError(401, 'Authentication required.');

    if (isData) {
        if (['POST', 'PUT'].includes(request.method) && !isJsonRequest(request)) {
            throw new HttpError(415, 'Content-Type must be application/json.');
        }
        return handleData(request, env, userId, pathname);
    }
    if (isNotification) {
        if (['POST', 'DELETE'].includes(request.method) && !isJsonRequest(request)) {
            throw new HttpError(415, 'Content-Type must be application/json.');
        }
        return handleNotifications(request, env, userId, pathname);
    }
    if (isBook) return handleBookFile(request, env, userId, pathname);
    return handleAccount(request, env, userId, pathname);
}

export async function handleRequest(request, env) {
    const url = new URL(request.url);

    if (!originAllowed(request, env, url)) return json(403, { error: 'This origin is not allowed.' });
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
        return request.headers.get('Origin')
            ? new Response(null, { status: 204, headers: cors })
            : json(400, { error: 'Origin header is required.' });
    }

    let response;
    try {
        response = await route(request, env, url);
    } catch (error) {
        if (error instanceof HttpError) {
            response = json(error.status, { error: error.message });
        } else {
            console.error(`${request.method} ${url.pathname} failed:`, error);
            response = json(500, { error: 'The request could not be completed. Please try again.' });
        }
    }
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
}

export default {
    async scheduled(_controller, env, context) {
        context.waitUntil(deliverDueReminders(env));
    },

    fetch: handleRequest
};
