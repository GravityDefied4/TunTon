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

## 3. Build your local database
The password should be your root MySQL password
```terminal
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/schema.sql"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/seed.sql"
```

Or open MySQL Workbench, then File > Open SQL Script, and run `schema.sql` followed by `seed.sql`.

What this does:
- `schema.sql` creates the `tunton` database and all tables. **It starts with `DROP DATABASE IF EXISTS tunton`, so re-running it erases your local data.**
- `seed.sql` adds the species, breeds, colors, barangays, sample users and reports, and creates the limited MySQL user `tunton_app`.

## 4. Create your `.env`
```terminal
cp .env.example .env     # fill GOOGLE_CLIENT_ID, JWT_SECRET, ADMIN_EMAILS, DB_USER, DB_PASSWORD
```

Paste the `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `DB_USER` and `DB_PASSWORD` values into `.env`, and set `DB_PORT` to your own MySQL port (default `3306`, but check yours).
Details for every key are in **`docs/AUTH.md`, section 2**. Never commit `.env`; it is already in `.gitignore`.

## 5. Run it
```terminal
npm start          # or: npm run dev   (auto-restarts on changes)
```
Open http://localhost:3000. Run `npm test` to check the matching logic.

**Using VS Code Live Server instead?** Set `API_BASE: 'http://localhost:3000/api'` in `frontend/js/config.js`
and keep the Live Server origin in `ALLOWED_ORIGINS` in `.env`. Don't commit that `config.js` change.

## Troubleshooting
| Problem | Fix |
|---|---|
| `ER_ACCESS_DENIED_ERROR` | `DB_USER` or `DB_PASSWORD` in `.env` is wrong, or `seed.sql` was never run. |
| `ECONNREFUSED 3306` | MySQL isn't running. Start the MySQL80 service (Windows: `services.msc`). |
| `Unknown database 'tunton'` | `schema.sql` was never run. |
| `You have an error in your SQL syntax` near `CHECK` or `SRID` | Your MySQL is older than 8.0.16. Upgrade it. |
| `'mysql' is not recognized` | Add MySQL's `bin` folder to PATH, or use MySQL Workbench. |
| Port 3000 in use | Change `PORT` in `.env`. |
| Google sign-in fails | Check `GOOGLE_CLIENT_ID` and that your origin is authorized in Google Cloud. |

## Important: your data is local only
Reports you create appear only in **your** database. Teammates won't see them, and you won't see theirs.
This is expected during development. For a shared demo, everyone uses one hosted deployment instead.

## When the schema changes
If someone changes `backend/db/schema.sql` or `backend/db/seed.sql`, after pulling you must re-run both files from step 3.
This resets your local data. The person who changes the schema should announce it in the team chat.
