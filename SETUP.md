# TunTon: Setup Guide

Git only shares code. Your MySQL database lives on your own computer, so everyone builds their own
local copy from `backend/db/schema.sql` and `backend/db/seed.sql`. Do this once after cloning.

## 1. Install the prerequisites
- **Node.js 18 or newer** (check with `node -v`)
- **MySQL 8.0.16 or newer** (check with `mysql --version`). Older versions fail on the CHECK constraints and SRID 4326 spatial columns.
- **Git**

## 2. npm install
```terminal
npm install
```

Web push needs the `web-push` package. If `package.json` does not list it yet, run this once and commit
`package.json` and `package-lock.json`, so teammates get it from a normal `npm install`:
```terminal
npm install web-push
```

## 3. Build your local database
The password should be your root MySQL password
```terminal
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/schema.sql"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/seed.sql"
```

Or open MySQL Workbench, then File > Open SQL Script, and run `schema.sql` followed by `seed.sql`.

`006_suspension_reason.sql` is only needed on a database built before suspension reasons existed: it adds the `suspension_reason` and `suspended_at` columns to `users` (a fresh `schema.sql` already has them). Run it once, then restart the server. Accounts suspended before this show "No reason was recorded" in the login popup.

`003_report_claims.sql` is only needed on a database built before claims moved onto reports (it drops the old claims tables). A fresh `schema.sql` already includes it.

`push_subscriptions.sql` is only needed on a database built before web push was added (a fresh `schema.sql`
already has the `push_subscriptions` table). It only adds one table and erases nothing. Run it once:
```terminal
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/push_subscriptions.sql"
```
(In PowerShell the `<` redirect does not work, which is why the `-e "source ..."` form is used. Use forward slashes in the path.)

What this does:
- `schema.sql` creates the `tunton` database and all tables. **It starts with `DROP DATABASE IF EXISTS tunton`, so re-running it erases your local data.**
- `seed.sql` adds the species, breeds, colors, barangays, sample users and reports, and creates the limited MySQL user `tunton_app`.

## 4. Create your `.env`
```terminal
cp .env.example .env     # fill GOOGLE_CLIENT_ID, JWT_SECRET, DB_USER, DB_PASSWORD
```

Paste the `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `DB_USER` and `DB_PASSWORD` values into `.env`, and set `DB_PORT` to your own MySQL port (default `3306`, but check yours).
Details for every key are in **`docs/AUTH.md`, section 2**. Never commit `.env`; it is already in `.gitignore`.

### Push notifications (optional)
Push sends an alert to the user's phone or computer even when TunTon is closed or the device is offline
(it is delivered when the device reconnects). It is sent when:
- someone sends a claim on your report,
- the owner approves or rejects a claim you sent,
- a new report strongly matches yours (score 80+).

Each developer makes their own keys:
```terminal
npx web-push generate-vapid-keys
```
Then add to `.env` (never commit it, and never share the private key):
```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:your-email@example.com
```
- `VAPID_SUBJECT` is a contact address for the push services (Google, Apple, Mozilla). Use a real email of whoever runs the site, written as `mailto:...` (an `https://` website address also works).
- Do not regenerate the keys later: every device that turned alerts on would stop receiving.
- Without these three values the app works normally and push is simply off; the console prints a warning.
- Add the three names (empty) to `.env.example` so teammates know they exist:
  ```
  VAPID_PUBLIC_KEY=
  VAPID_PRIVATE_KEY=
  VAPID_SUBJECT=mailto:your-email@example.com
  ```
- Optional settings (all have defaults): `PUSH_TTL_SECONDS` (how long an alert waits for an offline device, default 259200 = 3 days), `PUSH_MAX_DEVICES_PER_USER` (default 10), `PUSH_EXTRA_HOSTS` (extra push-service hosts, comma separated; rarely needed).
- Browsers only allow push on `https://` pages or `localhost`. For a phone, use an https tunnel or set `SSL_KEY_FILE` and `SSL_CERT_FILE`.
- iPhone/iPad: push only works after Share > Add to Home Screen (iOS 16.4 or newer).

## 5. Run it
```terminal
npm start          # or: npm run dev   (auto-restarts on changes)
```
Open http://localhost:3000. Run `npm test` to check the matching, e-mail and push logic.

When push is configured, the console prints `[push] web push is on`. To try it: log in, open the bell (sidebar or top bar), tap **Turn on**, allow notifications, then have another account send a claim on one of your reports and close the TunTon tab.

**Using VS Code Live Server instead?** Set `API_BASE: 'http://localhost:3000/api'` in `frontend/js/config.js`
and keep the Live Server origin in `ALLOWED_ORIGINS` in `.env`. Don't commit that `config.js` change.
(Push needs the service worker at `/sw.js` served by the Express server, so test push through http://localhost:3000, not Live Server.)

## Troubleshooting
| Problem | Fix |
|---|---|
| `ER_ACCESS_DENIED_ERROR` | `DB_USER` or `DB_PASSWORD` in `.env` is wrong, or `seed.sql` was never run. |
| `ECONNREFUSED 3306` | MySQL isn't running. Start the MySQL80 service (Windows: `services.msc`). |
| `Unknown database 'tunton'` | `schema.sql` was never run. |
| `You have an error in your SQL syntax` near `CHECK` or `SRID` | Your MySQL is older than 8.0.16. Upgrade it. |
| `'mysql' is not recognized` | Add MySQL's `bin` folder to PATH, or use MySQL Workbench. |
| PowerShell: `The '<' operator is reserved for future use` | Use `-e "source file.sql"` as in step 3, or `Get-Content file.sql -Raw \| mysql -u ... -p`. |
| Port 3000 in use | Change `PORT` in `.env`. |
| Google sign-in fails | Check `GOOGLE_CLIENT_ID` and that your origin is authorized in Google Cloud. |
| Console: `[push] ... are not set up` | The three `VAPID_*` values are missing from `.env`. Restart after adding them. |
| Console: `web-push is not installed` | Run `npm install web-push` (or `npm install`). |
| Bell shows "Not found." when you tap **Turn on** | The server is running old code. Restart it, and check that `backend/routes/push.js` exists and `server.js` mounts `/api/push`. |
| Bell shows "Push alerts are not set up on the server yet." | VAPID keys missing or invalid. See the push section in step 4. |
| `Table 'tunton.push_subscriptions' doesn't exist` | Run `push_subscriptions.sql` (step 3). |
| "Notifications are blocked for this site" | Allow notifications for the site in the browser's site settings, then reload. |
| Push works on `localhost` but not on a phone | The phone must use an `https://` address (tunnel or SSL files). |
| One failing test in `notifier.test.js` ("claim message says who claimed what...") | Known and unrelated to push: the test still expects a "Seen at:" row, but the e-mail now shows "Pet location". |

## Important: your data is local only
Reports you create appear only in **your** database. Teammates won't see them, and you won't see theirs.
This is expected during development. For a shared demo, everyone uses one hosted deployment instead.

Push subscriptions are local too: they live in your database and are tied to your VAPID keys. Re-running
`schema.sql` empties them (devices re-register on their next page load). If you change your VAPID keys, in
the browser turn alerts **Off** and then **On** again.

## When the schema changes
If someone changes `backend/db/schema.sql` or `backend/db/seed.sql`, after pulling you must re-run both files from step 3.
This resets your local data. The person who changes the schema should announce it in the team chat.