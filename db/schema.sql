-- =====================================================================
-- Tunton: Lost Pet Recovery System for Dagupan City
-- schema.sql | Target: MySQL 8.0.16+ (CHECK constraints + spatial SRID 4326)
-- =====================================================================
DROP DATABASE IF EXISTS tunton;
CREATE DATABASE tunton CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tunton;

-- 1. USERS (Strong Entity)
CREATE TABLE users (
    user_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    google_sub     VARCHAR(255)  NULL,
    full_name      VARCHAR(100)  NOT NULL,
    email          VARCHAR(50)   NOT NULL,
    phone          VARCHAR(15)   NULL,
    password_hash  VARCHAR(255)  NULL,
    picture_url    VARCHAR(255)  NULL,
    role           ENUM('user','admin') NOT NULL DEFAULT 'user',
    status         ENUM('active','suspended') NOT NULL DEFAULT 'active',
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at  TIMESTAMP     NULL,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_google_sub (google_sub),
    CONSTRAINT chk_users_email CHECK (email LIKE '%@%._%'),
    CONSTRAINT chk_users_phone CHECK (phone IS NULL OR phone REGEXP '^(\\+63|09)[0-9]{9}$')
) ENGINE=InnoDB;

-- 2. LOOKUP TABLES (Resolves Transitive Dependencies for 3NF)
CREATE TABLE species (
    species_id  TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(40)      NOT NULL,
    PRIMARY KEY (species_id),
    UNIQUE KEY uq_species_name (name)
) ENGINE=InnoDB;

CREATE TABLE breeds (
    breed_id    SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    species_id  TINYINT UNSIGNED  NOT NULL,
    name        VARCHAR(60)       NOT NULL,
    is_unknown  BOOLEAN           NOT NULL DEFAULT FALSE,
    PRIMARY KEY (breed_id),
    UNIQUE KEY uq_breeds_species_name (species_id, name),
    UNIQUE KEY uq_breeds_id_species (breed_id, species_id),
    CONSTRAINT fk_breeds_species FOREIGN KEY (species_id) REFERENCES species (species_id)
) ENGINE=InnoDB;

CREATE TABLE colors (
    color_id  TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name      VARCHAR(30)      NOT NULL,
    PRIMARY KEY (color_id),
    UNIQUE KEY uq_colors_name (name)
) ENGINE=InnoDB;

-- 3. BARANGAYS (Strong Entity for Geofencing)
CREATE TABLE barangays (
    barangay_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(60)       NOT NULL,
    center       POINT             NOT NULL SRID 4326,
    boundary     POLYGON           NULL SRID 4326,
    PRIMARY KEY (barangay_id),
    UNIQUE KEY uq_barangays_name (name),
    SPATIAL INDEX sp_barangays_center (center)
) ENGINE=InnoDB;

-- 4. PET REPORTS (Weak Entity dependent on Users)
-- FDS Note: 'lat' and 'lng' are GENERATED columns to avoid update anomalies (3NF compliance).
CREATE TABLE pet_reports (
    report_id         INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    user_id           INT UNSIGNED      NOT NULL,
    report_type       ENUM('lost','found') NOT NULL,
    pet_name          VARCHAR(60)       NULL,
    species_id        TINYINT UNSIGNED  NOT NULL,
    breed_id          SMALLINT UNSIGNED NOT NULL,
    size              ENUM('small','medium','large','extra_large') NOT NULL,
    sex               ENUM('male','female','unknown') NOT NULL DEFAULT 'unknown',
    age_group         ENUM('baby','young','adult','senior','unknown') NOT NULL DEFAULT 'unknown',
    markings          TEXT              NULL,
    description       TEXT              NULL,
    event_date        DATE              NOT NULL,
    location          POINT             NOT NULL SRID 4326,
    lat               DECIMAL(9,6) GENERATED ALWAYS AS (ST_Latitude(location)) STORED,
    lng               DECIMAL(9,6) GENERATED ALWAYS AS (ST_Longitude(location)) STORED,
    barangay_id       SMALLINT UNSIGNED NULL,
    search_radius_km  TINYINT UNSIGNED  NULL,
    status            ENUM('active','matched','resolved','closed','removed') NOT NULL DEFAULT 'active',
    created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    CONSTRAINT fk_reports_user     FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_reports_species  FOREIGN KEY (species_id) REFERENCES species (species_id),
    CONSTRAINT fk_reports_breed    FOREIGN KEY (breed_id, species_id) REFERENCES breeds (breed_id, species_id),
    CONSTRAINT fk_reports_barangay FOREIGN KEY (barangay_id) REFERENCES barangays (barangay_id),
    CONSTRAINT chk_reports_radius  CHECK ((report_type = 'lost' AND search_radius_km BETWEEN 1 AND 5) OR (report_type = 'found' AND search_radius_km IS NULL)),
    CONSTRAINT chk_reports_bounds  CHECK (ST_Latitude(location) BETWEEN 16.00 AND 16.12 AND ST_Longitude(location) BETWEEN 120.30 AND 120.42),
    SPATIAL INDEX sp_reports_location (location),
    KEY ix_reports_match_filter (report_type, species_id, status, event_date)
) ENGINE=InnoDB;

-- 5. REPORT COLORS (Resolves M:N Relationship and 1NF Repeating Groups)
-- FDS Note: Separated to achieve 1NF (atomic values) and handle multi-valued attributes.
CREATE TABLE report_colors (
    report_id     INT UNSIGNED     NOT NULL,
    color_id      TINYINT UNSIGNED NOT NULL,
    is_primary    BOOLEAN          NOT NULL DEFAULT FALSE,
    primary_flag  TINYINT GENERATED ALWAYS AS (IF(is_primary, 1, NULL)) STORED,
    PRIMARY KEY (report_id, color_id),
    UNIQUE KEY uq_one_primary_color (report_id, primary_flag),
    CONSTRAINT fk_rc_report FOREIGN KEY (report_id) REFERENCES pet_reports (report_id) ON DELETE CASCADE,
    CONSTRAINT fk_rc_color  FOREIGN KEY (color_id)  REFERENCES colors (color_id)
) ENGINE=InnoDB;

-- 6. REPORT PHOTOS (Resolves 1NF Repeating Groups)
CREATE TABLE report_photos (
    photo_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_id     INT UNSIGNED NOT NULL,
    file_path     VARCHAR(255) NOT NULL,
    is_primary    BOOLEAN      NOT NULL DEFAULT FALSE,
    primary_flag  TINYINT GENERATED ALWAYS AS (IF(is_primary, 1, NULL)) STORED,
    uploaded_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id),
    UNIQUE KEY uq_one_primary_photo (report_id, primary_flag),
    CONSTRAINT fk_photos_report FOREIGN KEY (report_id) REFERENCES pet_reports (report_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. MATCHES (Composite Entity / Associative Entity)
-- FDS Note: Resolves the M:N relationship between a lost report and a found report.
CREATE TABLE matches (
    match_id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    lost_report_id   INT UNSIGNED NOT NULL,
    found_report_id  INT UNSIGNED NOT NULL,
    score            DECIMAL(5,2) NOT NULL,
    label            VARCHAR(8) GENERATED ALWAYS AS (CASE WHEN score >= 80 THEN 'Strong' WHEN score >= 65 THEN 'Likely' ELSE 'Possible' END) VIRTUAL,
    status           ENUM('suggested','dismissed','claim_pending','confirmed') NOT NULL DEFAULT 'suggested',
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (match_id),
    UNIQUE KEY uq_match_pair (lost_report_id, found_report_id),
    CONSTRAINT fk_matches_lost  FOREIGN KEY (lost_report_id)  REFERENCES pet_reports (report_id) ON DELETE CASCADE,
    CONSTRAINT fk_matches_found FOREIGN KEY (found_report_id) REFERENCES pet_reports (report_id) ON DELETE CASCADE,
    CONSTRAINT chk_matches_score CHECK (score BETWEEN 0 AND 100)
) ENGINE=InnoDB;

-- 8. CLAIMS AND PROOFS
CREATE TABLE claims (
    claim_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    match_id          INT UNSIGNED NOT NULL,
    claimant_user_id  INT UNSIGNED NOT NULL,
    status            ENUM('pending_proof','under_review','approved','rejected') NOT NULL DEFAULT 'pending_proof',
    decision_reason   VARCHAR(500) NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at        TIMESTAMP    NULL,
    decided_by        INT UNSIGNED NULL,
    PRIMARY KEY (claim_id),
    UNIQUE KEY uq_claim_per_user_match (match_id, claimant_user_id),
    CONSTRAINT fk_claims_match    FOREIGN KEY (match_id)         REFERENCES matches (match_id),
    CONSTRAINT fk_claims_claimant FOREIGN KEY (claimant_user_id) REFERENCES users (user_id),
    CONSTRAINT fk_claims_decider  FOREIGN KEY (decided_by)       REFERENCES users (user_id)
) ENGINE=InnoDB;

CREATE TABLE claim_proofs (
    proof_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    claim_id    INT UNSIGNED NOT NULL,
    attempt_no  TINYINT UNSIGNED NOT NULL DEFAULT 1,
    proof_type  ENUM('vet_record','older_photo','microchip_number','hidden_marks','other') NOT NULL,
    file_path   VARCHAR(255) NULL,
    note        TEXT         NULL,
    uploaded_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (proof_id),
    CONSTRAINT fk_proofs_claim FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE,
    CONSTRAINT chk_proof_attempt CHECK (attempt_no BETWEEN 1 AND 3),
    CONSTRAINT chk_proof_content CHECK (file_path IS NOT NULL OR note IS NOT NULL)
) ENGINE=InnoDB;

-- 9. AUDIT TRAIL (Weak Entity dependent on Users/Actions)
CREATE TABLE activity_logs (
    log_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED NULL,
    action        VARCHAR(60)  NOT NULL,
    target_table  VARCHAR(40)  NOT NULL,
    target_id     INT UNSIGNED NOT NULL,
    details       JSON         NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
-- VIEWS (FDS: Virtual Tables for Security and Simplified Queries)
-- =====================================================================
-- FDS Note: Prevents transitive exposure of contact info (Security + 3NF principle)
CREATE VIEW v_public_reports AS
SELECT r.report_id, r.user_id, r.report_type, r.pet_name,
       r.species_id, sp.name AS species, r.breed_id, br.name AS breed,
       r.size, r.sex, r.age_group, r.markings, r.description, r.event_date,
       r.lat, r.lng, r.barangay_id, bg.name AS barangay,
       r.search_radius_km, r.status, r.created_at,
       (SELECT GROUP_CONCAT(c.name ORDER BY rc.is_primary DESC SEPARATOR ', ')
        FROM report_colors rc JOIN colors c ON c.color_id = rc.color_id WHERE rc.report_id = r.report_id) AS colors,
       (SELECT p.file_path FROM report_photos p WHERE p.report_id = r.report_id ORDER BY p.is_primary DESC LIMIT 1) AS primary_photo
FROM pet_reports r
JOIN species sp ON sp.species_id = r.species_id
JOIN breeds br ON br.breed_id = r.breed_id
LEFT JOIN barangays bg ON bg.barangay_id = r.barangay_id
WHERE r.status <> 'removed';

CREATE VIEW v_released_contacts AS
SELECT c.claim_id, c.decided_at,
       c.claimant_user_id, cu.full_name AS claimant_name, cu.phone AS claimant_phone, cu.email AS claimant_email,
       fr.user_id AS finder_user_id, fu.full_name AS finder_name, fu.phone AS finder_phone, fu.email AS finder_email
FROM claims c
JOIN matches m ON m.match_id = c.match_id
JOIN pet_reports fr ON fr.report_id = m.found_report_id
JOIN users cu ON cu.user_id = c.claimant_user_id
JOIN users fu ON fu.user_id = fr.user_id
WHERE c.status = 'approved';