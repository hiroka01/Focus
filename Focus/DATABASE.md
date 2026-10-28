# Focus database (serverless SQLite)

Focus now has a real database: **Cloudflare D1**, which is SQLite running serverless.
There is no database server to run, patch or pay for while idle. A small Worker
(`src/worker.js`) exposes the API the frontend already calls, and also serves the app itself.

```
Browser ──► Cloudflare Worker ──► D1 (SQLite)   users + all app data
 (unchanged)  src/worker.js  └──► R2 bucket     uploaded PDF/EPUB files
```

The frontend calls `/api/auth/*`, `/api/data/*`, `/api/books/*/file` and `/api/account/*`.
Settings can permanently delete the account, its database data and uploaded book files.

## What's stored

Schema: `migrations/0001_init.sql`. Each user's data is in ordinary tables you can query:

| Table | Holds |
|---|---|
| `users`, `sync_state` | accounts (PBKDF2-hashed passwords) |
| `calendar_events`, `tasks`, `notes`, `journal_entries` | one row per item |
| `books`, `study_plans`, `results` | one row per item |
| `timetable_slots`, `pomo_stats`, `preferences` | timetable cells, timer stats, theme |

Every row is keyed by `user_id` (cascade-deleted with the user). Any extra JSON field the
app adds later is kept in an `extra` column, so nothing is lost. Book **files** live in R2,
because D1 rows are capped at 2 MB; the book list/metadata is in `books`.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars        # then put a random 32+ byte value in AUTH_SECRET
npm run dev                           # builds, creates the local SQLite DB, starts on :8787
```

Open the URL Wrangler prints (not `index.html` directly). Local data is kept in `.wrangler/`.

Run the API tests (no Wrangler or network needed; uses Node's built-in SQLite):

```bash
npm test
```

## Deploy

```bash
npx wrangler login
npx wrangler d1 create focus-db            # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create focus-books
npm run db:migrate:remote                  # creates the tables
npx wrangler secret put AUTH_SECRET        # paste a random 32+ byte value
npm run deploy
```

Generate a secret with:
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`

Changing `AUTH_SECRET` signs everyone out. Sessions last 24 hours.

## Browse or back up the data

```bash
npx wrangler d1 execute focus-db --remote --command "SELECT id, email, created_at FROM users"
npx wrangler d1 export focus-db --remote --output focus-backup.sql
```

## Notes

- **Frontend on another host (e.g. GitHub Pages):** set `window.FOCUS_API_BASE_URL` in
  `js/config.js` to the Worker URL and add `"vars": { "CORS_ORIGINS": "https://you.github.io" }`
  in `wrangler.jsonc`.
- **Changing the schema:** add `migrations/0002_*.sql` and run the migrate command again.
  Never edit `0001`.
- **Limits:** 1.5 MB of JSON per section, 5,000 items per section, 50 MB per book file.
- **Account deletion:** the Settings action permanently deletes the account and all relational data,
  uploaded R2 book files, and browser-local app data for that account.
- **Password hashing** uses PBKDF2 (100,000 iterations, Workers' maximum). If signup/login
  ever fails with a CPU-time error on the free plan, that is the cause; the paid plan lifts it.
- The old Node/MySQL backend (`server.js`, Docker files) is untouched in git history but no
  longer needed.
