-- Run ONCE on a database that was already built from an older schema.sql (mysql ... tunton < this file).
-- A fresh schema.sql + seed.sql already has all of this.
--
-- Claims used to hang on a match and needed proof uploads. They now attach directly to an existing report:
--   "I found this pet" on a LOST report, "This is my pet" on a FOUND report. The report's owner approves or rejects.
-- WARNING: this drops the old claims, claim_proofs and v_released_contacts, so any claims made with the old flow are lost.
USE tunton;

DROP VIEW  IF EXISTS v_released_contacts;
DROP TABLE IF EXISTS claim_proofs;
DROP TABLE IF EXISTS claims;

CREATE TABLE claims (
    claim_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_id         INT UNSIGNED NOT NULL,
    claimant_user_id  INT UNSIGNED NOT NULL,
    claim_type        ENUM('found_it','my_pet') NOT NULL,
    status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    description       TEXT          NULL,
    markings          VARCHAR(500)  NULL,
    pet_location      VARCHAR(255)  NULL,
    event_date        DATE          NULL,
    lat               DECIMAL(9,6)  NULL,
    lng               DECIMAL(9,6)  NULL,
    barangay_id       SMALLINT UNSIGNED NULL,
    pet               JSON          NULL,
    contact           VARCHAR(255)  NULL,
    facebook          VARCHAR(255)  NULL,
    decision_reason   VARCHAR(500)  NULL,
    decided_at        TIMESTAMP     NULL,
    created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (claim_id),
    UNIQUE KEY uq_claim_per_user_report (report_id, claimant_user_id),
    KEY ix_claims_status (report_id, status),
    CONSTRAINT fk_claims_report    FOREIGN KEY (report_id)        REFERENCES pet_reports (report_id) ON DELETE CASCADE,
    CONSTRAINT fk_claims_claimant  FOREIGN KEY (claimant_user_id) REFERENCES users (user_id),
    CONSTRAINT fk_claims_barangay  FOREIGN KEY (barangay_id)      REFERENCES barangays (barangay_id)
) ENGINE=InnoDB;

CREATE TABLE claim_photos (
    photo_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    claim_id    INT UNSIGNED NOT NULL,
    file_path   VARCHAR(255) NOT NULL,
    image_data  LONGBLOB     NOT NULL,
    mime_type   VARCHAR(20)  NOT NULL,
    uploaded_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id),
    UNIQUE KEY uq_claim_photo_name (file_path),
    CONSTRAINT fk_claim_photos_claim FOREIGN KEY (claim_id) REFERENCES claims (claim_id) ON DELETE CASCADE
) ENGINE=InnoDB;
