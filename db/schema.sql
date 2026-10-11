-- TunTon schema (owner: Database team). Run schema.sql, then seed.sql.
-- Plan section 4: tables below are still TODO unless marked done.

CREATE DATABASE IF NOT EXISTS tunton CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tunton;

-- DONE (needed by Google sign-in). No password column: login is Google only.
CREATE TABLE IF NOT EXISTS users (
  user_id       CHAR(36)     PRIMARY KEY,
  google_sub    VARCHAR(255) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(150) NOT NULL,
  given_name    VARCHAR(100),
  picture       VARCHAR(500),
  phone         VARCHAR(30)  NULL,
  role          ENUM('user','admin')       NOT NULL DEFAULT 'user',
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL
);

-- TODO lookups:      species, breeds, colors
-- TODO geofence:     barangays (boundary POLYGON, SRID 4326)
-- TODO reports:      pet_reports (location POINT NOT NULL SRID 4326 + SPATIAL INDEX), report_colors, report_photos
-- TODO matching:     matches (UNIQUE lost_report_id + found_report_id for the upsert)
-- TODO claims:       claims, claim_proofs
-- TODO audit:        activity_logs
-- TODO view/trigger: v_public_reports (no contact info), trigger logging status changes
