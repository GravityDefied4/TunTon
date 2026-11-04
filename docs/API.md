# TunTon API reference

Base URL `/api`. Every response is `{ success, data, message }`. Send `Authorization: Bearer <jwt>` on everything except `/auth/*` and `/health`.
Errors keep the same shape (`success: false`, `data: null`, `message` = text safe to show the user). Status codes: 400 invalid input, 401 not logged in, 403 not allowed, 404 not found (also used for "not yours to see"), 409 wrong state (e.g. already decided), 500 server error.

**Conventions**
- Location: always separate `lat` and `lng` (numbers). Pins must be inside Dagupan (lat 16.00 to 16.12, lng 120.30 to 120.42) or the API answers 400.
- Lists return `data: { items, total, limit, offset }`. Paging: `?limit=` (1 to 100) and `?offset=`.
- Dates are `YYYY-MM-DD`. Timestamps are ISO strings (UTC).
- Ids are integers. Report fields: `species_id`, `breed_id`, `color_ids`, `barangay_id` come from `GET /reports/lookups`.
- Contact details (phone, email, Facebook) of a claimant appear in every claim returned to any logged-in user.

**Report object** (used by every endpoint that returns reports)
```json
{ "id": 1, "type": "lost", "user_id": 1, "pet_name": "Bantay", "species_id": 1, "species": "Dog", "breed_id": 1, "breed": "Aspin",
  "breed_unknown": false, "size": "medium", "sex": "male", "age_group": "adult", "markings": "white patch on chest", "description": null,
  "event_date": "2026-10-01", "lat": 16.0485, "lng": 120.3395, "barangay_id": 1, "barangay": "Pantal", "search_radius_km": 3,
  "status": "active", "created_at": "...", "updated_at": "...",
  "colors": [{ "color_id": 1, "name": "Brown", "is_primary": true }],
  "photos": [{ "photo_id": 5, "url": "/uploads/reports/<uuid>.jpg", "is_primary": true }], "primary_photo": "/uploads/reports/<uuid>.jpg",
  "is_mine": true, "distance_km": 0.42 }
```
`distance_km` only appears when a search origin was given. `search_radius_km` is set for lost reports and `null` for found. Photos are plain `<img src>` URLs.

## P1 Accounts
| Method | Endpoint | Notes |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| POST | /auth/google | `{ credential, mode: "login"\|"signup" }` (see AUTH.md) |
| GET | /auth/me, POST /auth/logout | |
| GET | /users/me | `data.user = { id, name, given_name, email, picture, role, phone }` |
| PUT | /users/me | `{ full_name?, phone? }` send only what changes. `phone` like `09171234567` or `+63 917 123 4567` (spaces/hyphens ignored, stored as `09...`); `""` clears it |
| POST | /users/me/picture | multipart, field `picture` (JPG/PNG/WebP, max 5 MB, content checked). The file goes in `backend/uploads/avatars/`; `users.picture_url` stores only the file name (Google pictures keep their full URL). The API returns the full `/uploads/avatars/<name>` path in `picture`. The old file is deleted. Returns `data.user` |
| DELETE | /users/me/picture | Removes the custom picture |

## P2 Reports
| Method | Endpoint | Notes |
|---|---|---|
| GET | /reports/lookups | species, breeds (with `is_unknown`), colors, barangays (center lat/lng), sizes, sexes, age_groups, radius_km, bounds, max_photos |
| POST | /reports | **multipart/form-data**. Fields: `type` (lost\|found), `species_id`, `breed_id`, `size` (small, medium, large, extra_large), `sex`?, `age_group`?, `event_date`, `lat`, `lng`, `color_ids` (`"1,2"` or `[1,2]`), `primary_color_id`? (default first), `pet_name`?, `markings`?, `description`?, `barangay_id`? (auto-detected if omitted), `search_radius_km` (**lost only**, whole 1 to 5), files in `photos` (1 to 5, JPG/PNG/WebP, 5 MB each). Returns 201 `{ report, matches }`; matching runs automatically |
| GET | /reports | Filters: `type`, `species` (id or name), `status` (default `active`; `matched`, `resolved`, `closed`, `all`), `size`, `color_id`, `barangay_id`, `q` (text), and `lat`+`lng`+`radius` together (radius 1 to 5 km, nearest first) |
| GET | /reports/mine | Own reports (all statuses), each with `match_count`. Filters: `type`, `status` |
| GET | /reports/:id | `data.report` |
| PUT | /reports/:id | Owner, active reports only. Send only changed fields (JSON or multipart). Add photos in `photos`, delete with `remove_photo_ids` (`"4,5"`). Type cannot change. Re-runs matching. Returns `{ report, matches }` |
| PATCH | /reports/:id/status | `{ status: "closed"\|"resolved" }` owner only |
| DELETE | /reports/:id | Owner only. **Permanently deletes** the report, its photos (files too), colors and match suggestions. Claims sent on it (and their photos) are deleted with it. Audit action `report_deleted` |

Statuses: `active`, `matched` (a claim was approved), `resolved`, `closed`, `removed` (admin).

## P3 Geofence
| Method | Endpoint | Notes |
|---|---|---|
| GET | /geofence/nearby?lat=&lng=&radius= | Radius 1 to 5. Optional `type`, `species`, `status`, `limit` (default 100). Returns `{ center, radius_km, items, total }`, nearest first |
| GET | /geofence/barangays | `items: [{ id, name, lat, lng, boundary, active_reports }]`. `boundary` is GeoJSON (`[lng, lat]` order) or `null` until the database team loads polygons |
| GET | /geofence/barangay/:id/reports | `{ barangay, items, total }`. Optional `type`, `species`, `status` |

## P4 Matching
| Method | Endpoint | Notes |
|---|---|---|
| POST | /matching/run/:reportId | Owner or admin. Recomputes matches. `data: { created, updated, removed, matches[] }` |

Runs automatically after a report is created, edited, closed or removed. Hard filters: opposite type, same species, both active, found pin inside the lost report's radius, found date not earlier than lost date minus 2 days, never the same user. Score 0 to 100 (weights in `backend/services/matching.js` `CONFIG`); stored at 50+. Labels: 80+ Strong, 65 to 79 Likely, 50 to 64 Possible. Re-running updates scores and never duplicates; dismissed matches stay dismissed; suggestions that stop qualifying are removed.

## P5 Matches
| Method | Endpoint | Notes |
|---|---|---|
| GET | /matches/mine | Filters: `status` (default all except dismissed; or `suggested`, `claim_pending`, `confirmed`, `dismissed`, `all`), `as` (owner\|finder), `min_score`. Best score first. Item: `{ id, score, label, status, my_role: "owner"\|"finder", lost: <report>, found: <report> }` |
| GET | /matches/:id | Same item plus `breakdown` `{ breed, color, markings, size, sex, ageGroup, distance, recency }` (points per attribute) |
| PATCH | /matches/:id/dismiss | Either involved user. Only `suggested` matches (else 409) |


## P5b Claims (a response to an existing report)
A user sends a claim on an existing report: **"I found this pet"** on a *lost* report (`type: found_it`) or **"This is my pet"** on a *found* report (`type: my_pet`). The type follows the report, the client does not send it. The owner of the report approves or rejects it.

| Method | Endpoint | Notes |
|---|---|---|
| POST | /claims | JSON or **multipart**. `report_id` (required), `description`?, `markings`?, `pet_location`? (where the pet is now), `event_date`? (when found / last seen), `lat`+`lng`? (inside Dagupan, barangay is derived), `contact`?, `facebook`?, `photos` (up to 3 JPG/PNG/WebP). For `my_pet` also `pet_name`?, `species`?, `breed`?, `color`?, `size`? (`small\|medium\|large\|extra_large`). At least a photo, `description`, `markings` or pet details is required. 201 `{ claim }`, status `pending`. Not on your own report (403), only while the report is `active` (409), one claim per person per report (409) |
| GET | /reports/:id/claims | `{ items, total }`. **Every logged-in user**: `pending` and `approved` claims. Each claim includes the claimant's contact details. Rejected claims never show here (the claimant still sees their own) |
| GET | /claims/mine | Claims I sent, any status (so I can see a rejection), each with `report: { id, type, pet_name, species, status, primary_photo }` |
| GET | /claims/:id | The claimant, the owner of the report, or an admin |
| PUT | /claims/:id | Claimant only, while `pending`. Send only what changes. Add photos in `photos`, delete with `remove_photo_ids` (`"4,5"`). Pet fields (`pet_name`, `species`, `breed`, `color`, `size`) are replaced together |
| DELETE | /claims/:id | Claimant only, while `pending`: withdraws the claim |
| PATCH | /claims/:id/decision | `{ decision: "approve"\|"reject", reason? }`, **owner of the report only** (403 for anyone else, 409 if not `pending`). **approve**: claim `approved` and it **stays on the report**, the report becomes `matched`, every other pending claim on it is rejected, open match suggestions are cleared. **reject**: claim `rejected` and it **disappears** from the report (the claimant still sees it in `/claims/mine` and cannot send another claim on that report) |

Claim item: `{ id, report_id, type, status: "pending"\|"approved"\|"rejected", is_mine, created_at, claimant: {id, name}, description, markings, pet_location, event_date, lat, lng, barangay, pet: {name,species,breed,color,size}\|null, photos: [{photo_id, url}], decision_reason, decided_at, contact: { text, facebook, phone, email }\|null }`. `contact` is visible to every logged-in user. Photo `url`s (`/uploads/claims/<random name>`) can be used directly in `<img src>`.

Claim flow: `pending` -> `approved` \| `rejected`. There is no proof upload step and no approval is needed before the owner sees the claimant's contact details.

## P6 Admin (role `admin`, otherwise 403)
| Method | Endpoint | Notes |
|---|---|---|
| GET | /admin/users | `q`, `role`, `status`. Item: `{ id, name, email, role, status, created_at, last_login_at, report_count, claim_count }` (no phone) |
| PATCH | /admin/users/:id/status | `{ status: "active"\|"suspended", reason? }`. Not yourself, not other admins. Suspended users get 403 on their next request |
| GET | /admin/reports | All reports including `removed`, plus `reporter_name`, `reporter_email`, `claims_count`. Filters `type`, `status`, `species`, `barangay_id`, `user_id`, `q` |
| PATCH | /admin/reports/:id/remove | `{ reason }` required. Hidden from users, kept in the database |
| GET | /admin/reports/:id/claims | Every claim on one report, **including rejected ones**; existing rows only (empty list when nobody claimed it). Item: `{ id, type, status, created_at, claimant_name, claimant_email, message, photo_count, decision_reason }` (no phone) |
| GET | /admin/claims | `status` (`pending\|approved\|rejected\|all`), `type` (`found_it\|my_pet`). Item: `{ id, type, status, report_id, report_type, report_pet_name, report_owner_name, claimant_name, decision_reason, created_at, decided_at }` |
| GET | /admin/stats | `{ users, reports{lost,found,by_status,new_last_7_days}, matches, claims, recovery{lost_total,recovered,rate}, per_barangay[] }` (`rate` is a percent) |
| GET | /admin/logs | Audit trail, newest first. Filters `user_id`, `action`, `target_table`, `target_id` |

Audit actions written: `profile_updated`, `report_created`, `report_updated`, `report_status_changed`, `report_removed`, `report_deleted`, `match_created`, `match_dismissed`, `claim_created`, `claim_updated`, `claim_withdrawn`, `claim_approved`, `claim_rejected`, `user_suspended`, `user_reactivated`.

## Files
Pet photos: public read-only at `/uploads/reports/<name>`. Proof files: private (endpoint above). Uploads are checked by declared type **and** file signature, renamed to random names, max 5 MB.