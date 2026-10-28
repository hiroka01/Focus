import { webcrypto } from 'node:crypto';

const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
);
const privateJwk = await webcrypto.subtle.exportKey('jwk', keys.privateKey);
const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');

console.log(`PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`PUSH_VAPID_PRIVATE_JWK=${JSON.stringify(privateJwk)}`);
console.log('Set PUSH_VAPID_SUBJECT to a mailto: address or HTTPS URL you control.');
