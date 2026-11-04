-- Run ONCE on an already-seeded database (mysql ... tunton < this file). A fresh schema.sql + seed.sql already has all of this.
-- All 31 Dagupan barangays (names match the report form's dropdown). Centers: PhilAtlas (philatlas.com).
USE tunton;

-- Pantal and Bonuan Binloc already exist: correct their centers (Bonuan Binloc was far off) and keep their ids
UPDATE barangays SET center = ST_GeomFromText('POINT(120.3389 16.0461)', 4326, 'axis-order=long-lat') WHERE name = 'Pantal';
UPDATE barangays SET center = ST_GeomFromText('POINT(120.3798 16.1018)', 4326, 'axis-order=long-lat') WHERE name = 'Bonuan Binloc';

-- The other 29 (INSERT IGNORE skips any that already exist)
INSERT IGNORE INTO barangays (name, center) VALUES
('Bacayao Norte', ST_GeomFromText('POINT(120.3444 16.0322)', 4326, 'axis-order=long-lat')),
('Bacayao Sur', ST_GeomFromText('POINT(120.3449 16.0224)', 4326, 'axis-order=long-lat')),
('Barangay I (T. Bugallon)', ST_GeomFromText('POINT(120.3364 16.044)', 4326, 'axis-order=long-lat')),
('Barangay II (Nueva)', ST_GeomFromText('POINT(120.3394 16.0425)', 4326, 'axis-order=long-lat')),
('Barangay IV (Zamora)', ST_GeomFromText('POINT(120.336 16.0408)', 4326, 'axis-order=long-lat')),
('Bolosan', ST_GeomFromText('POINT(120.3646 16.0467)', 4326, 'axis-order=long-lat')),
('Bonuan Boquig', ST_GeomFromText('POINT(120.3565 16.0764)', 4326, 'axis-order=long-lat')),
('Bonuan Gueset', ST_GeomFromText('POINT(120.3339 16.0696)', 4326, 'axis-order=long-lat')),
('Calmay', ST_GeomFromText('POINT(120.3257 16.0451)', 4326, 'axis-order=long-lat')),
('Carael', ST_GeomFromText('POINT(120.3163 16.0387)', 4326, 'axis-order=long-lat')),
('Caranglaan', ST_GeomFromText('POINT(120.3496 16.0315)', 4326, 'axis-order=long-lat')),
('Herrero-Perez', ST_GeomFromText('POINT(120.3422 16.0421)', 4326, 'axis-order=long-lat')),
('Lasip Chico', ST_GeomFromText('POINT(120.3402 16.0217)', 4326, 'axis-order=long-lat')),
('Lasip Grande', ST_GeomFromText('POINT(120.3433 16.0285)', 4326, 'axis-order=long-lat')),
('Lomboy', ST_GeomFromText('POINT(120.3248 16.0548)', 4326, 'axis-order=long-lat')),
('Lucao', ST_GeomFromText('POINT(120.3241 16.0141)', 4326, 'axis-order=long-lat')),
('Malued', ST_GeomFromText('POINT(120.3354 16.0289)', 4326, 'axis-order=long-lat')),
('Mamalingling', ST_GeomFromText('POINT(120.3621 16.0522)', 4326, 'axis-order=long-lat')),
('Mangin', ST_GeomFromText('POINT(120.3678 16.0361)', 4326, 'axis-order=long-lat')),
('Mayombo', ST_GeomFromText('POINT(120.3468 16.0384)', 4326, 'axis-order=long-lat')),
('Poblacion Oeste', ST_GeomFromText('POINT(120.3293 16.0436)', 4326, 'axis-order=long-lat')),
('Pogo Chico', ST_GeomFromText('POINT(120.3374 16.0374)', 4326, 'axis-order=long-lat')),
('Pogo Grande', ST_GeomFromText('POINT(120.3379 16.0337)', 4326, 'axis-order=long-lat')),
('Pugaro Suit', ST_GeomFromText('POINT(120.3227 16.0655)', 4326, 'axis-order=long-lat')),
('Salapingao', ST_GeomFromText('POINT(120.3216 16.059)', 4326, 'axis-order=long-lat')),
('Salisay', ST_GeomFromText('POINT(120.3716 16.0414)', 4326, 'axis-order=long-lat')),
('Tambac', ST_GeomFromText('POINT(120.3563 16.0459)', 4326, 'axis-order=long-lat')),
('Tapuac', ST_GeomFromText('POINT(120.3308 16.0334)', 4326, 'axis-order=long-lat')),
('Tebeng', ST_GeomFromText('POINT(120.3601 16.0345)', 4326, 'axis-order=long-lat'));
