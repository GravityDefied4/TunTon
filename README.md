# TunTon

Lost Pet Recovery System with Attribute Matching and Geofencing for Dagupan City.
Stack: HTML/CSS/JS + Leaflet, Node.js + Express, MySQL.

**Contents:** [Getting started](#getting-started) · [Project structure](#project-structure) · [Status](#status) · [Rules](#rules) · [Notifications](#notifications) · [Authentication](#authentication) · [API reference](#api-reference) · [Troubleshooting](#troubleshooting) · [Upgrading an existing database](#upgrading-an-existing-database)

---

## Getting started

Git only shares code. Your MySQL database lives on your own computer, so everyone builds a local copy from `backend/db/schema.sql` and `backend/db/seed.sql`. Do this once after cloning.

### 1. Prerequisites
- **Node.js 18+** (`node -v`)
- **MySQL 8.0.16+** (`mysql --version`). Older versions fail on the CHECK constraints and SRID 4326 spatial columns.
- **Git**

### 2. Install
```bash
npm install
```

### 3. Build your local database
```bash
mysql -u root -p -h 127.0.0.1 -P <your-mysql-port> -e "source backend/db/schema.sql"
mysql -u root -p -h 127.0.0.1 -P <your-mysql-port> -e "source backend/db/seed.sql"
```
- On Windows, `setup_db.bat` runs both (edit the MySQL path and port at the top if yours differ). In PowerShell the `<` redirect does not work, so use the `-e "source ..."` form with forward slashes.
- Or open MySQL Workbench, choose File > Open SQL Script, and run `schema.sql` then `seed.sql`.
- `schema.sql` creates the `tunton` database and all tables. **It starts with `DROP DATABASE IF EXISTS tunton`, so re-running it erases your local data.**
- `seed.sql` adds species, breeds, colors, barangays, sample users and reports, and creates the limited MySQL user `tunton_app`.

Seed accounts (development only; password for all is `password123`):

| Email | Role |
|---|---|
| user1@example.com | user |
| user2@example.com | user |
| admin@tunton.com | admin |

### 4. Create your `.env`
```bash
cp .env.example .env
```
Set at least `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `DB_USER`, `DB_PASSWORD`, and `DB_PORT` (default `3306`, but check yours). Never commit `.env`; it is in `.gitignore`.

| Key | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `JWT_EXPIRES_IN` | Sign-in (see [Authentication](#authentication)) |
| `ALLOWED_ORIGINS` | Only if the frontend is served from another origin (e.g. Live Server) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `PUBLIC_URL`, `TRUST_PROXY` | Public https address (tunnels) and trusted proxies |
| `SSL_KEY_FILE`, `SSL_CERT_FILE` | Serve https directly (needed for GPS/Google/push on a phone) |
| `TILE_USER_AGENT` | Identifies the app to OpenStreetMap tile servers (optional) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_TIMEZONE` | E-mail. Empty `SMTP_HOST` = nothing is sent |
| `EMAIL_BATCH_SIZE`, `EMAIL_BATCH_INTERVAL_SECONDS`, `EMAIL_SEND_DELAY_MS`, `EMAIL_DAILY_LIMIT`, `EMAIL_MAX_ATTEMPTS`, `EMAIL_MIN_SCORE` | E-mail batching and the minimum match score that triggers an e-mail (default 80) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (optional, see [Notifications](#push-notifications)) |
| `PUSH_TTL_SECONDS`, `PUSH_MAX_DEVICES_PER_USER`, `PUSH_EXTRA_HOSTS` | Push tuning (optional) |

### 5. Run
```bash
npm start      # or: npm run dev   (auto-restarts on changes)
npm test       # unit tests
```
Open http://localhost:3000. The Express server serves both the site and the API.

**Using VS Code Live Server instead?** Set `API_BASE: 'http://localhost:3000/api'` in `frontend/js/config.js` and keep the Live Server origin in `ALLOWED_ORIGINS`. Don't commit the `config.js` change. Push needs `/sw.js` from the Express server, so test push through http://localhost:3000.

### Your data is local only
Reports you create appear only in **your** database, and teammates' do not appear in yours. For a shared demo, use one hosted deployment.

### When the schema changes
If someone changes `schema.sql` or `seed.sql`, re-run both after pulling (step 3). This resets your local data. Whoever changes the schema should announce it in the team chat.

---

## Project structure

```
tunton/
├── .env                   secrets (never commit; copy from .env.example)
├── package.json           scripts and dependencies (run npm commands from here)
├── setup_db.bat           Windows helper: runs schema.sql then seed.sql
├── backend/               ALL server code
│   ├── server.js          entry point: middleware, mounts routes, serves frontend/
│   ├── routes/            URL -> controller only: auth, users, reports, geofence, matches, claims, admin, push, tiles
│   ├── controllers/       business logic, one per route file
│   ├── middleware/        auth.js (JWT), role.js, upload.js (multer), validate.js, errorHandler.js
│   ├── services/          google.js, matching.js (pure scoring), matchRunner.js (DB side), geofence.js, push.js
│   ├── db/                pool.js, schema.sql, seed.sql, userStore.js, reportQueries.js, activityLog.js, migration .sql files
│   ├── tests/             auth, matching, notifier, profile, push, suspensions (npm test)
│   └── uploads/           avatars/ (profile pictures)
├── frontend/              index.html, css/, js/, pages/, assets/, sw.js, manifest.webmanifest
└── README.md
```

## Status

| Area | Status |
|---|---|
| Google + e-mail sign-in, JWT, role middleware, `/api/auth/*`, `/api/users/me` | done |
| Users on MySQL (`userStore.js`), shared report queries, audit log + transactions | done |
| Reports (create/list/mine/detail/edit/status, photos, lookups), geofence (nearby, barangays) | done |
| Matching: pure scoring (unit tested) + runner with auto-trigger | done |
| Matches (mine/detail/dismiss) | done |
| Claims on reports ("I found this pet" / "This is my pet"), owner approves or rejects | done |
| Admin (users, reports, claims, stats, logs, suspensions) | done |
| E-mail notifications (match, claim, suspension, reactivation) and web push | done |
| Change-password endpoint (`/users/me/password`) | not implemented |

## Rules

- The frontend only calls the API; controllers hold the logic; SQL uses `?` placeholders.
- Responses are `{ success, data, message }` (use `res.ok()` / `res.fail()`).
- **Claimant contact details are public to every logged-in user** who can see a claim (product decision, see `claimsController.js`). Rejected claims are visible only to the claimant and admins. Contact details are never put in e-mails.
- Admin role can only be set in MySQL (see [Authentication](#authentication)).

---

## Notifications

### In-app bell (frontend only)
Files: `pages/user/dashboard/js/notifications.js` and `css/notifications.css`; every dashboard page loads `js/notifications.js` after `common.js`. It uses the existing API only (reports, `/claims/mine`, `/reports/:id/claims`).

Settings at the top of `notifications.js`: `NEARBY_KM` (3), `NEARBY_DAYS` (3), `REFRESH_MS` (2 min).

Limits:
- Updates only while a TunTon tab is open (checks every 2 min and when you return to the tab).
- "Read" state is stored per browser, not per account.
- "Nearby" uses the user's current location (GPS or IP estimate); no location means no nearby alerts. The server never stores user locations.

### Push notifications
Sends an alert to the user's phone or computer even when TunTon is closed or the device is offline (delivered on reconnect). Events:
1. Someone sends a claim on your report (to the owner).
2. The owner approves or rejects a claim you sent (to the claimant).
3. A new report strongly matches yours, score 80+ (to the owner, once per pair of reports).

Tapping the alert opens the report (or the Matching tab). If a TunTon tab is open and in front, no pop-up is shown and the bell just updates.

**Setup (optional, once per developer):**
1. Make sure `web-push` is installed (`npm install`; if `package.json` doesn't list it, run `npm install web-push` and commit `package.json` and `package-lock.json`).
2. Generate keys: `npx web-push generate-vapid-keys`.
3. Add to `.env` (never commit it, never share the private key):
   ```
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:your-email@example.com
   ```
   `VAPID_SUBJECT` is a real contact address for the push services (`mailto:...` or an `https://` site).
4. Restart. The console prints `[push] web push is on`, or a warning naming the missing keys. Without the keys the app works normally and push is off.
5. Each user opens the bell and taps **Turn on** (per device).

Notes:
- Do not regenerate the keys later: every device that enabled alerts would stop receiving. If you change them, turn alerts Off then On in the browser.
- Browsers allow push only on `https://` pages or `localhost`. For a phone use an https tunnel or `SSL_KEY_FILE` / `SSL_CERT_FILE`.
- iPhone/iPad: push works only after Share > Add to Home Screen (iOS 16.4+).
- Alerts are sent after the database commit and never awaited, so a push problem cannot fail a claim or report.
- Suspended users receive nothing; expired subscriptions (404/410) are deleted automatically.
- The server only sends to real push-service hosts (Google, Mozilla, Apple, Microsoft).
- Logging out removes that device from the account, so a shared phone doesn't show the previous user's alerts.
- Subscriptions are local to your database and tied to your VAPID keys; re-running `schema.sql` empties them.
- Files: frontend `sw.js` (must stay in the site root), `manifest.webmanifest`, `js/push.js`; backend `services/push.js`, `controllers/pushController.js`, `routes/push.js`, `db/push_subscriptions.sql`, `tests/push.test.js`.

---

## Authentication

### Google Cloud setup (one person, once)
1. https://console.cloud.google.com > create a project > **APIs & Services > OAuth consent screen** (External, add your team as test users).
2. **Credentials > Create credentials > OAuth client ID > Web application.**
3. **Authorized JavaScript origins** (no paths, no trailing slash): `http://localhost:3000`; `http://localhost:5500` and `http://127.0.0.1:5500` only if you use Live Server; your deployed domain later. Leave "Authorized redirect URIs" empty.
4. Copy the **Client ID** into `.env` as `GOOGLE_CLIENT_ID`. There is no client secret.

If Google shows `origin_mismatch`, the URL in the address bar is not in Authorized JavaScript origins.

### How it works
Browser: Google button -> Google returns an ID token -> `POST /api/auth/google`.
Server: verifies signature, expiry, issuer, audience and verified email -> finds or creates the user -> returns TunTon's own JWT.
The browser stores it in `localStorage.tunton_session` and sends `Authorization: Bearer <jwt>` on every call (`authFetch` in `common.js`). A 401 logs the user out. The frontend never trusts the decoded Google token by itself.

E-mail + password sign-in also exists (`/auth/register`, `/auth/login`; bcrypt hash, cost 12).

### Endpoints
| Method | Endpoint | Body | Notes |
|---|---|---|---|
| GET | /api/auth/config | | `data.googleClientId` |
| POST | /api/auth/register | `{ name, email, password }` | `data: { token, user }`, 201. Duplicate e-mail: 409. Always role `user`. Password 8 to 72 chars |
| POST | /api/auth/login | `{ email, password }` | `data: { token, user }`. Wrong e-mail/password and Google-only accounts: the same 401. Suspended: 403. 10 failed tries per 15 min per IP |
| POST | /api/auth/google | `{ credential, mode: "login"\|"signup" }` | `data: { token, user }`. Login with no account: 404 `data.code = "NO_ACCOUNT"`. Suspended: 403 |
| GET | /api/auth/me | | Bearer. `data.user` plus a fresh `data.token` carrying the role currently in the database |
| POST | /api/auth/logout | | Stateless; the browser discards the JWT |

`user` = `{ id, name, given_name, email, picture, role }`. JWT payload = `{ sub: user_id, role, iat, exp }`.

Protecting routes:
```js
const { requireAuth, requireRole } = require('../middleware/auth');
router.get('/reports/mine', requireAuth, ctrl.mine);          // req.user is set
router.use('/admin', requireAuth, requireRole('admin'));      // admin only
```

### Admins
Admins are made in MySQL, or by an existing admin through `PATCH /admin/users/:id/role`:
```sql
UPDATE users SET role = 'admin' WHERE email = 'someone@example.com';   -- promote
UPDATE users SET role = 'user'  WHERE email = 'someone@example.com';   -- demote
```
New accounts (e-mail or Google) are always `user`, and sign-in never changes an existing role. The role is read from the database on every request, so changes apply immediately.

### Security notes
- Password sign-ups are never admin (the e-mail is unverified).
- When someone signs in with Google using an e-mail that already has a password account, that account's password is removed, so someone who registered another person's e-mail first cannot keep access.

---

## API reference

Base URL `/api`. Every response is `{ success, data, message }`. Send `Authorization: Bearer <jwt>` on everything except `/auth/*` and `/health`.
Errors keep the same shape (`success: false`, `data: null`, `message` = text safe to show). Status codes: 400 invalid input, 401 not logged in, 403 not allowed, 404 not found (also "not yours to see"), 409 wrong state (e.g. already decided), 500 server error.

**Conventions**
- Location: always separate `lat` and `lng` (numbers). Pins must be inside Dagupan (lat 16.00 to 16.12, lng 120.30 to 120.42) or the API answers 400.
- Lists return `data: { items, total, limit, offset }`. Paging: `?limit=` (1 to 100) and `?offset=`.
- Dates are `YYYY-MM-DD`. Timestamps are ISO strings (UTC).
- Ids are integers. `species_id`, `breed_id`, `color_ids`, `barangay_id` come from `GET /reports/lookups`.
- A claimant's contact details appear in every claim returned to any logged-in user.

**Report object** (returned by every endpoint that returns reports)
```json
{ "id": 1, "type": "lost", "user_id": 1, "pet_name": "Bantay", "species_id": 1, "species": "Dog", "breed_id": 1, "breed": "Aspin",
  "breed_unknown": false, "size": "medium", "sex": "male", "age_group": "adult", "markings": "white patch on chest", "description": null,
  "event_date": "2026-10-01", "lat": 16.0485, "lng": 120.3395, "barangay_id": 1, "barangay": "Pantal", "search_radius_km": 3,
  "status": "active", "created_at": "...", "updated_at": "...",
  "colors": [{ "color_id": 1, "name": "Brown", "is_primary": true }],
  "photos": [{ "photo_id": 5, "url": "/uploads/reports/<uuid>.jpg", "is_primary": true }], "primary_photo": "/uploads/reports/<uuid>.jpg",
  "is_mine": true, "distance_km": 0.42 }
```
`distance_km` appears only when a search origin was given. `search_radius_km` is set for lost reports and `null` for found. Photos are plain `<img src>` URLs.

### Accounts
| Method | Endpoint | Notes |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| GET | /users/me | `data.user = { id, name, given_name, email, picture, role, phone }` |
| PUT | /users/me | `{ full_name?, phone? }`, send only what changes. `phone` like `09171234567` or `+63 917 123 4567` (stored as `09...`); `""` clears it |
| POST | /users/me/picture | multipart, field `picture` (JPG/PNG/WebP, max 5 MB, content checked). Saved in `backend/uploads/avatars/`; `users.picture_url` stores only the file name (Google pictures keep their full URL). The old file is deleted. Returns `data.user` |
| DELETE | /users/me/picture | Removes the custom picture |

(Auth endpoints are listed under [Authentication](#authentication).)

### Reports
| Method | Endpoint | Notes |
|---|---|---|
| GET | /reports/lookups | species, breeds (with `is_unknown`), colors, barangays (center lat/lng), sizes, sexes, age_groups, radius_km, bounds, max_photos |
| POST | /reports | **multipart/form-data**. `type` (lost\|found), `species_id`, `breed_id`, `size` (small, medium, large, extra_large), `sex`?, `age_group`?, `event_date`, `lat`, `lng`, `color_ids` (`"1,2"` or `[1,2]`), `primary_color_id`? (default first), `pet_name`?, `markings`?, `description`?, `barangay_id`? (auto-detected), `search_radius_km` (**lost only**, whole 1 to 5), files in `photos` (1 to 5, JPG/PNG/WebP, 5 MB each). Returns 201 `{ report, matches }`; matching runs automatically |
| GET | /reports | Filters: `type`, `species` (id or name), `status` (default `active`; `matched`, `resolved`, `closed`, `all`), `size`, `color_id`, `barangay_id`, `q` (text), and `lat`+`lng`+`radius` together (1 to 5 km, nearest first) |
| GET | /reports/mine | Own reports (all statuses), each with `match_count`. Filters: `type`, `status` |
| GET | /reports/:id | `data.report` |
| PUT | /reports/:id | Owner, active reports only. Send only changed fields (JSON or multipart). Add photos in `photos`, delete with `remove_photo_ids` (`"4,5"`). Type cannot change. Re-runs matching. Returns `{ report, matches }` |
| PATCH | /reports/:id/status | `{ status: "closed"\|"resolved" }`, owner only |
| DELETE | /reports/:id | Owner only. **Permanently deletes** the report, its photos (files too), colors, match suggestions, and the claims sent on it. Audit action `report_deleted` |

Statuses: `active`, `matched` (a claim was approved), `resolved`, `closed`, `removed` (admin).

### Geofence
| Method | Endpoint | Notes |
|---|---|---|
| GET | /geofence/nearby?lat=&lng=&radius= | Radius 1 to 5. Optional `type`, `species`, `status`, `limit` (default 100). Returns `{ center, radius_km, items, total }`, nearest first |
| GET | /geofence/barangays | `items: [{ id, name, lat, lng, boundary, active_reports }]`. `boundary` is GeoJSON (`[lng, lat]` order) or `null` until polygons are loaded |
| GET | /geofence/barangay/:id/reports | `{ barangay, items, total }`. Optional `type`, `species`, `status` |

### Matching
| Method | Endpoint | Notes |
|---|---|---|
| POST | /matching/run/:reportId | Owner or admin. Recomputes matches. `data: { created, updated, removed, matches[] }` |

Runs automatically after a report is created, edited, closed or removed. Hard filters: opposite type, same species, both active, found pin inside the lost report's radius, found date not earlier than lost date minus 2 days, never the same user. Score 0 to 100 (weights in `backend/services/matching.js` `CONFIG`); stored at 10+. Labels: 80+ Strong, 65 to 79 Likely, 50 to 64 Possible, 10 to 49 Weak. Re-running updates scores and never duplicates; dismissed matches stay dismissed; suggestions that stop qualifying are removed.

| Method | Endpoint | Notes |
|---|---|---|
| GET | /matches/mine | Filters: `status` (default all except dismissed; or `suggested`, `claim_pending`, `confirmed`, `dismissed`, `all`), `as` (owner\|finder), `min_score`. Best score first. Item: `{ id, score, label, status, my_role: "owner"\|"finder", lost: <report>, found: <report> }` |
| GET | /matches/:id | Same item plus `breakdown` `{ breed, color, markings, size, sex, ageGroup, distance, recency }` |
| PATCH | /matches/:id/dismiss | Either involved user. Only `suggested` matches (else 409) |

### Claims
A user sends a claim on an existing report: **"I found this pet"** on a *lost* report (`type: found_it`) or **"This is my pet"** on a *found* report (`type: my_pet`). The type follows the report; the client does not send it. The report's owner approves or rejects it. Flow: `pending` -> `approved` | `rejected`. There is no proof-upload step, and the owner does not need to approve before contact details are visible.

| Method | Endpoint | Notes |
|---|---|---|
| POST | /claims | JSON or **multipart**. `report_id` (required), `description`?, `markings`?, `pet_location`?, `event_date`?, `lat`+`lng`? (inside Dagupan; barangay derived), `contact`? (max 50), `facebook`?, `photos` (up to 3 JPG/PNG/WebP). For `my_pet` also `pet_name`?, `species`?, `breed`?, `color`?, `size`?. At least a photo, `description`, `markings` or pet details is required. 201 `{ claim }`, status `pending`. Not on your own report (403), only while the report is `active` (409), one claim per person per report (409) |
| GET | /reports/:id/claims | `{ items, total }`. Any logged-in user sees `pending` and `approved` claims with the claimant's contact details. Rejected claims never show (the claimant still sees their own) |
| GET | /claims/mine | Claims I sent, any status, each with `report: { id, type, pet_name, species, status, primary_photo }` |
| GET | /claims/:id | The claimant, the report's owner, or an admin |
| PUT | /claims/:id | Claimant only, while `pending`. Send only what changes. Add photos in `photos`, delete with `remove_photo_ids`. Pet fields (`pet_name`, `species`, `breed`, `color`, `size`) are replaced together |
| DELETE | /claims/:id | Claimant only, while `pending`: withdraws the claim |
| PATCH | /claims/:id/decision | `{ decision: "approve"\|"reject", reason? }`, report owner only (403 otherwise, 409 if not `pending`). **approve**: claim becomes `approved` and stays on the report, the report becomes `matched`, other pending claims are rejected, open match suggestions are cleared. **reject**: the claim disappears from the report (the claimant still sees it in `/claims/mine` and cannot claim that report again) |

Claim item: `{ id, report_id, type, status, is_mine, created_at, claimant: {id, name}, description, markings, pet_location, event_date, lat, lng, barangay, pet: {name,species,breed,color,size}|null, photos: [{photo_id, url}], decision_reason, decided_at, contact: { text, facebook, phone, email }|null }`. Photo URLs (`/uploads/claims/<random name>`) can be used directly in `<img src>`.

### Admin (role `admin`, otherwise 403)
| Method | Endpoint | Notes |
|---|---|---|
| GET | /admin/users | `q`, `role`, `status`. Item: `{ id, name, email, role, status, created_at, last_login_at, report_count, claim_count }` |
| PATCH | /admin/users/:id/status | `{ status: "active"\|"suspended", reason, duration }`. `reason` is required when suspending (max 300 chars, stored as `suspension_reason`, cleared on reactivation). `duration` (only when suspending): `"3d"`, `"7d"`, `"30d"` or `"permanent"` (default). Not yourself, not other admins. See [Suspensions](#suspensions) |
| PATCH | /admin/users/:id/role | `{ role: "admin"\|"user" }`. Not yourself (400); only active accounts can be promoted (409); 409 if unchanged. Audited as `user_promoted_admin` / `user_demoted_user`. The user's session picks it up on the next `/auth/me` |
| GET | /admin/reports | All reports including `removed`, plus `reporter_name`, `reporter_email`, `claims_count`. Filters `type`, `status`, `species`, `barangay_id`, `user_id`, `q` |
| PATCH | /admin/reports/:id/remove | `{ reason }` required. Hidden from users, kept in the database |
| GET | /admin/reports/:id/claims | Every claim on one report, **including rejected**. Item: `{ id, type, status, created_at, claimant_name, claimant_email, message, photo_count, decision_reason }` |
| GET | /admin/claims | `status` (`pending\|approved\|rejected\|all`), `type` (`found_it\|my_pet`). Item: `{ id, type, status, report_id, report_type, report_pet_name, report_owner_name, claimant_name, decision_reason, created_at, decided_at }` |
| GET | /admin/stats | `{ users, reports{lost,found,by_status,new_last_7_days}, matches, claims, recovery{lost_total,recovered,rate}, per_barangay[] }` (`rate` is a percent) |
| GET | /admin/logs | Audit trail, newest first. Filters `user_id`, `action`, `target_table`, `target_id` |

Audit actions: `profile_updated`, `report_created`, `report_updated`, `report_status_changed`, `report_removed`, `report_deleted`, `match_created`, `match_dismissed`, `claim_created`, `claim_updated`, `claim_withdrawn`, `claim_approved`, `claim_rejected`, `user_suspended`, `user_reactivated`, `user_promoted_admin`, `user_demoted_user`.

### Suspensions
A suspended user gets 403 on their next request. Both logins (`POST /auth/login`, `POST /auth/google`) answer with `403 { success: false, message: "This account is suspended.", data: { code: "ACCOUNT_SUSPENDED", reason, until } }`. `reason` is `null` for accounts suspended before reasons were saved; `until` is an ISO date (`null` = permanent). The website shows the reason in a popup.

A timed suspension is lifted automatically when it ends (a timer checks every minute, and the user's own login or request lifts it at once). Their reports come back like a manual reactivation, and the audit log gets `user_reactivated` with `auto: true`.

### E-mails
All e-mails go into the `email_notifications` table and are sent by a background worker in batches (`EMAIL_BATCH_SIZE` every `EMAIL_BATCH_INTERVAL_SECONDS`, optional `EMAIL_DAILY_LIMIT`), so bursts cannot exceed the mail provider's limits. With `SMTP_HOST` empty nothing is sent. Users with no e-mail address are skipped. Replies go to `MAIL_REPLY_TO` (blank = `MAIL_FROM`).

| Kind | When | Content |
|---|---|---|
| `match` | A created or edited report is a **Strong** match (score 80+, `EMAIL_MIN_SCORE`) for another user's report | Score label, short pet summary, link to the Matching tab. One e-mail per owner per lost/found pair, ever. The percentage is the saved `matches.score` |
| `claim` | Someone sends a claim (`POST /claims`) | Who claimed, what they say, a short message, link to the report. One per claim; withdrawing removes it if not yet sent |
| `suspension` | An admin suspends an account (or suspends it again with a new reason or length; repeating the same permanent suspension sends nothing) | The reason and, for a timed suspension, the length and end date (in `MAIL_TIMEZONE`, default `Asia/Manila`). No link back to the site; asks the user to reply |
| `reactivation` | An admin reactivates, or the suspension time ran out | Says which one it was |

### Files
Pet photos are public read-only at `/uploads/reports/<name>`; claim photos at `/uploads/claims/<name>`. Uploads are checked by declared type **and** file signature, renamed to random names, max 5 MB.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ER_ACCESS_DENIED_ERROR` | `DB_USER` or `DB_PASSWORD` in `.env` is wrong, or `seed.sql` was never run |
| `ECONNREFUSED 3306` | MySQL isn't running. Start the MySQL80 service (Windows: `services.msc`) |
| `Unknown database 'tunton'` | `schema.sql` was never run |
| SQL syntax error near `CHECK` or `SRID` | MySQL is older than 8.0.16. Upgrade it |
| `'mysql' is not recognized` | Add MySQL's `bin` folder to PATH, or use MySQL Workbench |
| PowerShell: `The '<' operator is reserved for future use` | Use `-e "source file.sql"` as in step 3, or `Get-Content file.sql -Raw \| mysql -u ... -p` |
| Port 3000 in use | Change `PORT` in `.env` |
| Google sign-in fails | Check `GOOGLE_CLIENT_ID` and that your origin is authorized in Google Cloud |
| Console: `[push] ... are not set up` | The three `VAPID_*` values are missing from `.env`. Restart after adding them |
| Console: `web-push is not installed` | Run `npm install` (or `npm install web-push`) |
| Bell shows "Not found." on **Turn on** | The server is running old code. Restart it and check that `backend/routes/push.js` exists and `server.js` mounts `/api/push` |
| Bell shows "Push alerts are not set up on the server yet." | VAPID keys missing or invalid |
| `Table 'tunton.push_subscriptions' doesn't exist` | Run `push_subscriptions.sql` (see below) |
| "Notifications are blocked for this site" | Allow notifications for the site in browser settings, then reload |
| Push works on `localhost` but not on a phone | The phone needs an `https://` address (tunnel or SSL files) |
| Failing `notifier.test.js` ("claim message says who claimed what...") | Known: the test still expects a "Seen at:" row but the e-mail now shows "Pet location". Update the test |

## Upgrading an existing database

A fresh `schema.sql` already includes all of these. Run only the ones your older database lacks, using the same `-e "source backend/db/<file>.sql"` form, then restart the server. (Only `push_subscriptions.sql` is in `backend/db/` of the zip you sent; if the others no longer exist, delete their rows and rebuild from `schema.sql` instead.)

| File | Needed if your database predates | What it does |
|---|---|---|
| `003_report_claims.sql` | Claims moving onto reports | Drops the old claims tables |
| `006_suspension_reason.sql` | Suspension reasons | Adds `suspension_reason` and `suspended_at` to `users` (older suspensions show "No reason was recorded") |
| `reactivation_email.sql` | Reactivation e-mails | Adds `reactivation` to `email_notifications.kind`. Without it, reactivating a user fails when the e-mail is queued |
| `push_subscriptions.sql` | Web push | Adds the `push_subscriptions` table; erases nothing |

Also needed on old databases:
```sql
ALTER TABLE users ADD COLUMN suspended_until DATETIME NULL AFTER suspended_at;
```