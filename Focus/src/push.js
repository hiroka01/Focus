const encoder = new TextEncoder();
const PUSH_TTL_SECONDS = 60;

function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function encodeBase64Url(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function concatBytes(...values) {
    const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
    let offset = 0;
    for (const value of values) {
        result.set(value, offset);
        offset += value.length;
    }
    return result;
}

async function hmacSha256(keyBytes, input) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
}

async function hkdfExpand(prk, info, length) {
    const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
    return block.slice(0, length);
}

async function encryptPushMessage(subscription, message) {
    const uaPublicKey = decodeBase64Url(subscription.p256dh);
    const authSecret = decodeBase64Url(subscription.auth);
    const uaKey = await crypto.subtle.importKey('raw', uaPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
    const asPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
    const keyLabel = encoder.encode('WebPush: info\0');
    const keyPrk = await hmacSha256(authSecret, sharedSecret);
    const inputKey = await hkdfExpand(keyPrk, concatBytes(keyLabel, uaPublicKey, asPublicKey), 32);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const contentPrk = await hmacSha256(salt, inputKey);
    const cek = await hkdfExpand(contentPrk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdfExpand(contentPrk, encoder.encode('Content-Encoding: nonce\0'), 12);
    const plaintext = concatBytes(encoder.encode(message), new Uint8Array([2]));
    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));
    const recordSize = new Uint8Array([0, 0, 16, 0]);
    return concatBytes(salt, recordSize, new Uint8Array([asPublicKey.length]), asPublicKey, ciphertext);
}

async function createVapidAuthorization(endpoint, env) {
    if (!env.PUSH_VAPID_PRIVATE_JWK || !env.PUSH_VAPID_PUBLIC_KEY || !env.PUSH_VAPID_SUBJECT) {
        throw new Error('Web Push is not configured. Set PUSH_VAPID_PRIVATE_JWK, PUSH_VAPID_PUBLIC_KEY, and PUSH_VAPID_SUBJECT.');
    }

    const audience = new URL(endpoint).origin;
    const header = encodeBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const payload = encodeBase64Url(encoder.encode(JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: env.PUSH_VAPID_SUBJECT
    })));
    const unsignedToken = `${header}.${payload}`;
    const privateKey = await crypto.subtle.importKey(
        'jwk',
        JSON.parse(env.PUSH_VAPID_PRIVATE_JWK),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        encoder.encode(unsignedToken)
    );
    return `vapid t=${unsignedToken}.${encodeBase64Url(signature)}, k=${env.PUSH_VAPID_PUBLIC_KEY}`;
}

export async function sendWebPush(subscription, message, env) {
    const body = await encryptPushMessage(subscription, JSON.stringify(message));
    const authorization = await createVapidAuthorization(subscription.endpoint, env);
    const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            Authorization: authorization,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(PUSH_TTL_SECONDS),
            Urgency: 'high'
        },
        body
    });
    if (!response.ok) {
        const error = new Error(`Push service returned ${response.status}.`);
        error.status = response.status;
        throw error;
    }
}

export function pushIsConfigured(env) {
    return Boolean(env.PUSH_VAPID_PRIVATE_JWK && env.PUSH_VAPID_PUBLIC_KEY && env.PUSH_VAPID_SUBJECT);
}
