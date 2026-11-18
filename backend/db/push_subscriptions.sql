-- Existing database? Run this once (a fresh install gets the table from schema.sql).
USE tunton;
CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED  NOT NULL,
    endpoint         VARCHAR(1000) NOT NULL,
    endpoint_hash    CHAR(64)      NOT NULL,
    p256dh           VARCHAR(255)  NOT NULL,
    auth             VARCHAR(255)  NOT NULL,
    user_agent       VARCHAR(255)  NULL,
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (subscription_id),
    UNIQUE KEY uq_push_endpoint (endpoint_hash),
    KEY ix_push_user (user_id, updated_at),
    CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
