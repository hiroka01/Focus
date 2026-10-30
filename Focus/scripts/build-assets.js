// Copies the static frontend into ./dist so only the app files are published
// (not node_modules, .git, the Worker source, etc.).
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const file of ['index.html', 'login.html', 'style.css', 'login.css', 'manifest.webmanifest', 'service-worker.js', 'icon.svg', 'js']) {
    const source = join(root, file);
    if (!existsSync(source)) throw new Error(`Missing frontend file: ${file}`);
    cpSync(source, join(dist, file), { recursive: true });
}
console.log('Frontend copied to dist/');
