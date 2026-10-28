# Push notifications setup

The app's service worker can display Web Push notifications. Calendar reminders and running timer completion alerts are sent by the Worker cron trigger, which runs once per minute. Push delivery requires HTTPS, a configured VAPID key pair, and the database migration.

1. Generate a VAPID key pair locally:

   ```sh
   node scripts/generate-vapid-keys.js
   ```

2. Set the private key, public key, and a contact address as Worker secrets. Use the values printed by the script; never commit the private key:

   ```sh
   npx wrangler secret put PUSH_VAPID_PUBLIC_KEY
   npx wrangler secret put PUSH_VAPID_PRIVATE_JWK
   npx wrangler secret put PUSH_VAPID_SUBJECT
   ```

   For `PUSH_VAPID_SUBJECT`, use a contact such as `mailto:you@example.com`.

3. Apply the database migration and deploy:

   ```sh
   npm run db:migrate:remote
   npm run deploy
   ```

4. Open Settings on the deployed HTTPS site and enable notifications on each device. On iPhone/iPad, first add the site to the Home Screen, then open the installed web app and enable notifications.

The web app can display notifications and deliver scheduled event reminders and timer completion alerts through browser push when the app is closed. The timer's scheduled end is stored on the server while it runs; pausing or resetting cancels that scheduled alert. It does not provide native iOS Live Activities or home-screen widgets; those require separate platform-specific app extensions.
