USE tunton;

-- 1. Species & Breeds
INSERT INTO species (species_id, name) VALUES (1, 'Dog'), (2, 'Cat');
INSERT INTO breeds (breed_id, species_id, name, is_unknown) VALUES 
(1, 1, 'Aspin', FALSE), (2, 1, 'Unknown / Mixed', TRUE),
(3, 2, 'Puspin', FALSE), (4, 2, 'Unknown / Mixed', TRUE);

-- 2. Colors
INSERT INTO colors (color_id, name) VALUES (1, 'Brown'), (2, 'White'), (3, 'Black'), (4, 'Orange');

-- 3. Barangays (Pantal and Bonuan Binloc with approximate Dagupan coordinates)
INSERT INTO barangays (barangay_id, name, center) VALUES 
(1, 'Pantal', ST_GeomFromText('POINT(120.3395 16.0485)', 4326, 'axis-order=long-lat')),
(2, 'Bonuan Binloc', ST_GeomFromText('POINT(120.3870 16.0550)', 4326, 'axis-order=long-lat'));

-- 4. Users (Password for both is 'password123', hashed with bcrypt)
-- Hash generated for 'password123'
INSERT INTO users (user_id, full_name, email, phone, password_hash, role, status) VALUES 
(1, 'Juan Dela Cruz', 'user1@example.com', '09171234567', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGfa3ZlW', 'user', 'active'),
(2, 'Maria Santos', 'user2@example.com', '09187654321', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGfa3ZlW', 'user', 'active'),
(3, 'Admin User', 'admin@tunton.com', '09190000000', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGfa3ZlW', 'admin', 'active');

-- 5. Pet Reports (Lost brown Aspin in Pantal, Found brown Aspin nearby)
INSERT INTO pet_reports (report_id, user_id, report_type, pet_name, species_id, breed_id, size, sex, age_group, markings, event_date, location, barangay_id, search_radius_km, status) VALUES 
(1, 1, 'lost', 'Bantay', 1, 1, 'medium', 'male', 'adult', 'white patch on chest', '2026-10-01', ST_GeomFromText('POINT(120.3395 16.0485)', 4326, 'axis-order=long-lat'), 1, 3, 'active'),
(2, 2, 'found', NULL, 1, 1, 'medium', 'male', 'adult', 'white patch on chest', '2026-10-02', ST_GeomFromText('POINT(120.3400 16.0490)', 4326, 'axis-order=long-lat'), 1, NULL, 'active');

-- 6. Report Colors
INSERT INTO report_colors (report_id, color_id, is_primary) VALUES 
(1, 1, TRUE), -- Report 1 is primarily Brown
(2, 1, TRUE); -- Report 2 is primarily Brown

-- 7. Matches (Pre-calculated Strong match for demo)
INSERT INTO matches (match_id, lost_report_id, found_report_id, score, status) VALUES 
(1, 1, 2, 88.50, 'suggested');

-- 8. Set up App User (Least Privilege Principle - FDS Security Concept)
CREATE USER IF NOT EXISTS 'tunton_app'@'localhost' IDENTIFIED BY 'tuntonsahere1!';
GRANT SELECT, INSERT, UPDATE, DELETE ON tunton.* TO 'tunton_app'@'localhost';
FLUSH PRIVILEGES;