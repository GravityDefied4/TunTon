# TunTon

Lost Pet Recovery System with Attribute Matching and Geofencing for Dagupan City.
Stack: HTML/CSS/JS + Leaflet, Node.js + Express, MySQL.

```
tunton/
├── .env                   secrets (never commit; copy from .env.example)
├── package.json           scripts and dependencies (run npm commands from here)
├── backend/               ALL server code
│   ├── server.js          entry point: middleware, mounts routes, serves frontend/
│   ├── routes/            URL -> controller only: auth, users, reports, geofence, matches, claims, admin
│   ├── controllers/       business logic, one per route file
│   ├── middleware/        auth.js (JWT), role.js, upload.js (multer), validate.js, errorHandler.js
│   ├── services/          google.js, matching.js (pure scoring), matchRunner.js (DB side), geofence.js
│   ├── db/                pool.js, schema.sql, seed.sql, userStore.js, reportQueries.js, activityLog.js
│   ├── tests/             matching.test.js (npm test)
│   └── uploads/           reports/ (pet photos), proofs/ (proof documents; private)
├── frontend/              index.html, css/, js/, pages/, assets/
└── docs/                  AUTH.md (Google sign-in), API.md (every endpoint)
```

Run: `cp .env.example .env`, fill it in, `npm install`, `npm start`, open http://localhost:3000.

## Status
| Area | Status |
|---|---|
| Google sign-in, JWT, role middleware, /api/auth/*, /api/users/me (GET, PUT) | done |
| backend/db/: users on MySQL (`userStore.js`), shared report queries, audit log + transactions | done |
| Reports (create/list/mine/detail/edit/status, photos, lookups), geofence (nearby, barangays) | done |
| Matching: pure scoring (`backend/services/matching.js`, unit tested) + runner with auto-trigger | done |
| Matches (mine/detail/dismiss), claims (proofs, decision, private files, contact release) | done |
| Admin (users, reports, claims, stats, logs) | done |
| Frontend wiring | not backend work: see docs/API.md |

Run: `npm test` (scoring unit tests). Full API reference: **docs/API.md**.
Database: `mysql -u root -p < backend/db/schema.sql` then `< backend/db/seed.sql`, put the app user in `.env`.

Rules (from the plan): frontend only calls the API; controllers hold logic; SQL uses `?` placeholders;
responses are `{ success, data, message }` (use `res.ok()` / `res.fail()`); contact info is never returned before an approved claim.
