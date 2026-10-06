# Deploy and verify the installed-app badge

The implementation covers the [badge design's first gate](BADGE_DESIGN.md). Foreground badges and opt-in test pushes are implemented. Cron, scheduled fan-out, outbox delivery, and automatic reading notifications are not implemented yet. Prove delivery on a physical iPhone before building those components.

## Configure the test backend

The production app works without D1 or VAPID configuration, but its background-test button stays disabled in debug mode.

1. Authenticate with the account that owns `airq.b65.dev`:

   ```sh
   npx wrangler login
   npx wrangler whoami
   ```

2. Create the badge database:

   ```sh
   npx wrangler d1 create airq-badge
   ```

   If that database already exists, find its ID with `npx wrangler d1 list --json`. Do not create another database.

3. Add the returned database ID to `wrangler.jsonc`:

   ```json
   "d1_databases": [{
     "binding": "BADGE_DB",
     "database_name": "airq-badge",
     "database_id": "ID_FROM_CLOUDFLARE",
     "migrations_dir": "migrations"
   }]
   ```

4. Apply the migration:

   ```sh
   npx wrangler d1 migrations apply airq-badge --remote
   ```

5. Create VAPID secrets using your contact address:

   ```sh
   node scripts/setup-push-secrets.mjs mailto:you@example.com
   ```

   The script sends the keys directly to Wrangler's standard input. It does not print the private key or save it to disk. It refuses to overwrite any existing VAPID secret. Do not rotate these keys casually; existing push subscriptions depend on the public key. A partial upload requires checking the secret inventory before recovery.

6. Verify and deploy:

   ```sh
   npm run verify
   npm run deploy
   curl --fail https://airq.b65.dev/api/badge/config
   ```

   Expect `enabled: true` and `testOnly: true`. The public key is public configuration. The private key is never returned.

## Test on a physical iPhone

Test enrollment, notification requests, badge-clearing controls, and delivery diagnostics appear only when the app URL includes `?debug`, for example `https://airq.b65.dev/?debug`. The normal installed-app launch URL does not include this flag. The flag changes the UI, not API authorization or an existing push enrollment.

Use iOS 16.4 or later. Browser automation cannot prove native Home Screen icon display, notification permissions, or closed-app delivery.

1. Open `https://airq.b65.dev` in Safari. Select **Share**, then **Add to Home Screen**.
2. Open AirQ from the new Home Screen icon. If updating an existing install, close its windows before reopening so the new service worker can activate.
3. Select **Use my location** or choose an official region. Note the displayed rounded PM2.5 value and reading time.
4. Select **Enable foreground-only badge** and allow notifications. Check that the Home Screen badge displays the rounded reading. If the reading is zero, expect no numeric badge.
5. Return to AirQ and select **Enable background test and notifications**. This consents to device-local saved weights and visible background notifications. It does not enable automatic delivery.
6. Select **Clear badge for test**. Check the Home Screen and confirm that the number is absent. Push enrollment stays enabled. Refreshing AirQ does not restore the number while the test-clear state is active. If the button reports an old service worker, close every AirQ window and reopen the installed app.
7. Select **Send test notification**, then close AirQ immediately. The server starts delivery after ten seconds. Test requests are limited to one per minute per enrollment.
8. Before reopening AirQ, confirm that a visible notification arrives and the badge reappears with its rounded reading. This proves the push restored the badge even when the official reading is unchanged. A zero reading has no numeric badge, so choose a nonzero region for this test. The notification labels the saved location or region, units, and official reading time.
9. Open the notification. Confirm that it opens AirQ. Choose another region, clear the badge for testing, and send another test. Verify the badge uses that region.
10. Select **Disable badge and notifications**. Confirm the number clears. An already in-flight push may still show a nonnumeric status notification, but must not restore a number.

Record device model, iOS version, reading time, expected rounded value, observed badge, notification arrival, and opt-out result. Only a successful physical-device result passes the gate.

## Inspect and recover a test

In the installed app's browser storage, `airq:push-enrollment:v1` holds the enrollment ID and revocation token. Treat the token and push subscription endpoint as secrets. Do not paste them into issue reports.

An authenticated `GET /api/badge/subscriptions/<id>/test` with `Authorization: Bearer <token>` returns `none`, `pending`, `accepted`, or `failed`. `accepted` means the push service accepted delivery, not that the device received it. The test API reports expired enrollment with HTTP 410; disable and enable again to renew it. Push services returning 404 or 410 cause server-side enrollment deletion.

The test delay uses `ctx.waitUntil`, not a durable queue. It can fail during process interruption. Reopen the app and retry after a minute. This path is for the device gate, not production scheduling.

Subscriptions expire after 30 days and expired rows are removed when another enrollment occurs. The test backend permits at most 1,000 active subscriptions. There is no scheduler to send after an enrollment expires. Saved-location weights stop being usable after 24 hours, but expiry clears the badge only on the next app or push execution. An offline phone cannot be forced to clear at an exact time. Region targets remain regional readings, subject to reading freshness.

## Run local checks

`npm run verify` exercises calculation, ordering, expiry, endpoint security, real local D1 storage, install assets, and the real service-worker command and push handlers. The service-worker test intercepts native badge and notification presentation; it is not a physical-device delivery test.

Use `npm run icons` to regenerate the committed 192px, 512px, and Apple touch icons from `public/icons/icon.svg`. The icon artwork is static. The estimate appears through the platform's numeric badge, not by replacing installed icon artwork.

The app does not cache its shell for guaranteed offline startup. Offline public-reading fallback applies only when the page itself can load. The service worker does not proxy or cache geolocation or API traffic.

For iPhone requirements, see [WebKit's Home Screen badging guide](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/). For the test's execution limit, see [Cloudflare's `waitUntil` documentation](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).
