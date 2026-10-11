# TunTon

Lost Pet Recovery System with Attribute Matching and Geofencing for Dagupan City.
Stack: HTML/CSS/JS + Leaflet, Node.js + Express, MySQL.

```
tunton/
├── server.js              entry point: middleware, mounts routes, serves public/
├── .env                   secrets (never commit; copy from .env.example)
├── package.json
├── public/                FRONTEND (index.html, css/, js/, pages/, assets/)
├── routes/                URL -> controller only: auth, users, reports, geofence, matches, claims, admin
├── controllers/           business logic, one per route file
├── middleware/            auth.js (JWT), role.js, upload.js (multer), errorHandler.js
├── services/              google.js, matching.js (pure scoring), geofence.js (Dagupan bounds, distance)
├── db/                    pool.js, schema.sql, seed.sql, userStore.js (temporary, see docs/AUTH.md)
├── uploads/               reports/ (pet photos), proofs/ (proof documents; private)
└── docs/                  AUTH.md (Google sign-in setup + contract)
```

Run: `cp .env.example .env`, fill it in, `npm install`, `npm start`, open http://localhost:3000.

## Status
| Area | Status |
|---|---|
| Google sign-in, JWT, role middleware, /api/auth/*, GET /api/users/me | done |
| services/geofence.js (bounds, radius check, distance), matching.js config | done |
| middleware/upload.js, db/pool.js | written, untested until deps are installed |
| reports, geofence, matches, claims, admin routes | stubs (return 501) with the plan's endpoints |
| matching scoring functions, schema.sql beyond `users`, seed.sql | TODO |

Rules (from the plan): frontend only calls the API; controllers hold logic; SQL uses `?` placeholders;
responses are `{ success, data, message }` (use `res.ok()` / `res.fail()`); contact info is never returned before an approved claim.
