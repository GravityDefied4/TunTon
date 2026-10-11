# Google sign-in: setup and contract

## 1. Google Cloud setup (one person, once)
1. https://console.cloud.google.com > create a project > **APIs & Services > OAuth consent screen** (External, add your team as test users).
2. **Credentials > Create credentials > OAuth client ID > Web application.**
3. **Authorized JavaScript origins** (no paths, no trailing slash):
   - `http://localhost:3000`
   - `http://localhost:5500` and `http://127.0.0.1:5500` only if you use Live Server
   - your deployed domain later
   Leave "Authorized redirect URIs" empty (the button flow does not use it).
4. Copy the **Client ID** into `.env` as `GOOGLE_CLIENT_ID`. There is no client secret to store.

## 2. Run
```
cp .env.example .env     # fill GOOGLE_CLIENT_ID, JWT_SECRET, ADMIN_EMAILS
npm install
npm start                # http://localhost:3000 serves the site AND the API
```
Open http://localhost:3000 (not the file, not Live Server, unless you set API_BASE in `public/js/config.js`).

## 3. How it works
Browser: Google button -> Google returns an ID token -> `POST /api/auth/google`.
Server: verifies signature, expiry, issuer, audience and verified email with Google's keys -> finds/creates the user -> returns TunTon's own JWT.
Browser stores it in `localStorage.tunton_session` and sends `Authorization: Bearer <jwt>` on every API call (`authFetch` in `common.js`). A 401 logs the user out.

The frontend never trusts the decoded Google token by itself; only the server's verification counts.

## 4. API (all responses are `{ success, data, message }`)
| Method | Endpoint | Body | Notes |
|---|---|---|---|
| GET | /api/auth/config | | `data.googleClientId` |
| POST | /api/auth/google | `{ credential, mode: "login"\|"signup" }` | `data: { token, user }`. Login with no account: 404 `data.code = "NO_ACCOUNT"`. Suspended: 403 |
| GET | /api/auth/me | | Bearer. `data.user`. Used to validate a stored token |
| POST | /api/auth/logout | | Stateless; browser discards the JWT |

`user` = `{ id, name, given_name, email, picture, role }`. JWT payload = `{ sub: user_id, role, iat, exp }`.

Protecting future routes:
```js
const { requireAuth, requireRole } = require('./middleware/auth');
router.get('/reports/mine', requireAuth, ctrl.mine);                 // req.user is set
router.use('/admin', requireAuth, requireRole('admin'));             // admin only
```
Admins: put their Google emails in `ADMIN_EMAILS`.

## 5. For the database team
`db/userStore.js` is a temporary JSON file. Replace its 4 functions with mysql2 queries; nothing else changes. The plan's `users` table needs these changes for Google login (no passwords):
```sql
CREATE TABLE users (
  user_id       CHAR(36) PRIMARY KEY,            -- UUID (or INT AUTO_INCREMENT, then update the JWT subject)
  google_sub    VARCHAR(255) NOT NULL UNIQUE,    -- Google's stable account id; use this, not email, to identify people
  email         VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(150) NOT NULL,
  given_name    VARCHAR(100),
  picture       VARCHAR(500),
  phone         VARCHAR(30) NULL,                -- collected in Profile, hidden until a claim is approved
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL
);
```
`password_hash`, `/auth/register`, `/auth/login` and `/users/me/password` from the plan are no longer needed; bcrypt can be dropped from the library list.

## 6. Notes
- Reports/profile are still saved in the browser (localStorage) until the reports API exists; only login is real for now.
- If Google shows `origin_mismatch`, the URL in the address bar is not in Authorized JavaScript origins.
