# Focus: local and ZimaOS hosting

Focus can run as a self-hosted Node.js app. Its API, SQLite database, and uploaded
PDF/EPUB files are all stored on the same machine. The Cloudflare Worker/D1 setup
is still available as an optional development/deployment path.

## Run locally on Windows

Requirements: Node.js 22.13 or newer and npm.

From PowerShell:

```powershell
cd "D:\path\to\Focus"
npm install
Copy-Item .dev.vars.example .dev.vars
```

Edit `.dev.vars` and replace `AUTH_SECRET` with a random value of at least 32
bytes. Generate one without printing it to the terminal:

```powershell
node -e "require('node:fs').writeFileSync('.dev.vars', 'AUTH_SECRET=' + require('node:crypto').randomBytes(48).toString('base64url') + '\n')"
```

Then start the app:

```powershell
npm run dev
```

Open <http://localhost:8787>. The app creates `data\focus.sqlite` for the
database and stores uploaded book files in `data\books`. Both are local and
ignored by Git. Run `npm test` for the API and persistence tests.

If port 8787 is already being used, pick another port in the same PowerShell
window before starting the app:

```powershell
$env:PORT = "8788"
npm run dev
```

`npm run dev:cloudflare` runs the older Wrangler/D1 local setup instead.

## Deploy to ZimaOS with Docker Compose

This is the recommended setup when your data must stay on the home server. The
container stores the SQLite database and book files in the `data` directory next
to `compose.yaml`. The database is not exposed as a network service; only the
Focus web app/API listens on port 8787.

1. Copy or clone the `Focus` folder onto the ZimaOS server. It must include
   `Dockerfile`, `compose.yaml`, `package.json`, `package-lock.json`, `src`,
   `migrations`, `scripts`, and the frontend files.
2. In that folder, create a `.env` file containing a unique secret. Generate it
   on the server with:

   ```sh
   umask 077
   printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-64)" > .env
   ```

   Keep `.env` private; it is ignored by Git. Do not reuse the development
   secret or post it in a support request.
3. Build and start Focus:

   ```sh
   docker compose up -d --build
   docker compose logs -f focus
   ```

4. On your home network, open `http://<ZIMAOS-LAN-IP>:8787`. Check
   `http://<ZIMAOS-LAN-IP>:8787/healthz`; it should return `{"status":"ok"}`.
5. In ZimaOS, you can also deploy `compose.yaml` as a custom Docker Compose app
   instead of using SSH. Ensure the app's persistent host storage maps to `/data`
   and that the configured `.env` secret is available to Compose.

Commands to manage the service:

```sh
docker compose stop
docker compose start
docker compose up -d --build
docker compose logs -f focus
```

The `./data:/data` bind mount is the persistent storage. Back up the entire
`data` directory regularly, preferably while Focus is stopped. This includes
both `focus.sqlite` and uploaded books.

### Remote access

For access outside your home network, use a VPN such as Tailscale or an HTTPS
reverse proxy/tunnel. Do not forward the database (or port 8787 directly) from
your router to the public internet. If you publish Focus behind a domain, enable
HTTPS; browsers require a secure context for service workers and push
notifications. The SQLite file itself stays on ZimaOS.

### Existing Cloudflare data

Switching to ZimaOS does not automatically copy accounts or data from a
Cloudflare D1 database. Keep the old deployment and its backups until you have
exported and verified any data you need. Do not point both deployments at the
same SQLite file. New accounts and data created in the ZimaOS instance are
stored locally on that server.

## Cloudflare Wrangler (optional)

The alternative Worker setup uses Cloudflare D1 and R2, not the ZimaOS storage:

```sh
npm install
npm run dev:cloudflare
npm test
```

To deploy that version, configure a Cloudflare D1 database, R2 bucket, and
Worker secrets in `wrangler.jsonc`, then run `npm run deploy`.
