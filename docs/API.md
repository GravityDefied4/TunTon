# TunTon API reference

Base URL `/api`. Every response is `{ success, data, message }`. Send `Authorization: Bearer <jwt>` on everything except `/auth/*` and `/health`.
Errors keep the same shape (`success: false`, `data: null`, `message` = text safe to show the user). Status codes: 400 invalid input, 401 not logged in, 403 not allowed, 404 not found (also used for "not yours to see"), 409 wrong state (e.g. already decided), 500 server error.

**Conventions**
- Location: always separate `lat` and `lng` (numbers). Pins must be inside Dagupan (lat 16.00 to 16.12, lng 120.30 to 120.42) or the API answers 400.
- Lists return `data: { items, total, limit, offset }`. Paging: `?limit=` (1 to 100) and `?offset=`.
- Dates are `YYYY-MM-DD`. Timestamps are ISO strings (UTC).
- Ids are integers. Report fields: `species_id`, `breed_id`, `color_ids`, `barangay_id` come from `GET /reports/lookups`.
- Contact details (phone, email) appear **only** in `GET /claims/:id/contact` after approval.

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
| PUT | /users/me | `{ full_name?, phone? }` send only what changes. `phone` like `09171234567` or `+639171234567`; `""` clears it |

## P2 Reports
| Method | Endpoint | Notes |
|---|---|---|
| GET | /reports/lookups | species, breeds (with `is_unknown`), colors, barangays (center lat/lng), sizes, sexes, age_groups, radius_km, bounds, max_photos |
| POST | /reports | **multipart/form-data**. Fields: `type` (lost\|found), `species_id`, `breed_id`, `size` (small, medium, large, extra_large), `sex`?, `age_group`?, `event_date`, `lat`, `lng`, `color_ids` (`"1,2"` or `[1,2]`), `primary_color_id`? (default first), `pet_name`?, `markings`?, `description`?, `barangay_id`? (auto-detected if omitted), `search_radius_km` (**lost only**, whole 1 to 5), files in `photos` (1 to 5, JPG/PNG/WebP, 5 MB each). Returns 201 `{ report, matches }`; matching runs automatically |
| GET | /reports | Filters: `type`, `species` (id or name), `status` (default `active`; `matched`, `resolved`, `closed`, `all`), `size`, `color_id`, `barangay_id`, `q` (text), and `lat`+`lng`+`radius` together (radius 1 to 5 km, nearest first) |
| GET | /reports/mine | Own reports (all statuses), each with `match_count`. Filters: `type`, `status` |
| GET | /reports/:id | `data.report` |
| PUT | /reports/:id | Owner, active reports only. Send only changed fields (JSON or multipart). Add photos in `photos`, delete with `remove_photo_ids` (`"4,5"`). Type cannot change. Re-runs matching. Returns `{ report, matches }` |
| PATCH | /reports/:id/status | `{ status: "closed"\|"resolved" }` owner only. `closed` is refused (409) while a claim is in progress |

Statuses: `active`, `matched` (claim approved), `resolved`, `closed`, `removed` (admin).

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

## P5 Matches and claims
| Method | Endpoint | Notes |
|---|---|---|
| GET | /matches/mine | Filters: `status` (default all except dismissed; or `suggested`, `claim_pending`, `confirmed`, `dismissed`, `all`), `as` (owner\|finder), `min_score`. Best score first. Item: `{ id, score, label, status, my_role: "owner"\|"finder", claim: {id,status}\|null, lost: <report>, found: <report> }` |
| GET | /matches/:id | Same item plus `breakdown` `{ breed, color, markings, size, sex, ageGroup, distance, recency }` (points per attribute) |
| PATCH | /matches/:id/dismiss | Either involved user. Only `suggested` matches (else 409) |
| POST | /claims | `{ match_id }`. Only the owner of the lost report, match must be `suggested`. 201 `{ claim }`, status `pending_proof`, match becomes `claim_pending` |
| POST | /claims/:id/proofs | **multipart**. `proof_type` (vet_record, older_photo, microchip_number, hidden_marks, other), `note`? (required for microchip_number and hidden_marks), files in `proofs` (up to 3, JPG/PNG/WebP/PDF). One request = one submission, **max 3 per claim**. Moves the claim to `under_review`. Allowed from `pending_proof` or `rejected` |
| GET | /claims/:id | Claimant, finder or admin. `{ claim: { id, status, role, decision_reason, match, lost, found, proofs[], attempts_used, attempts_left, can_submit_proof, contact_available } }` |
| GET | /claims/:id/proofs/:proofId/file | Private proof file. Needs the Bearer token, so fetch it with `authFetch` and use a blob URL (a plain `<img src>` cannot send the header) |
| PATCH | /claims/:id/decision | `{ decision: "approve"\|"reject", reason? }` finder or admin. `reason` required to reject. Approve: claim `approved`, match `confirmed`, both reports `matched`. A 3rd rejection is final (match dismissed, claim flagged in the audit log). Admin may also override a rejection |
| GET | /claims/:id/contact | **Only when approved** (else 403). Claimant receives `{ finder: {name, phone, email} }`, finder receives `{ claimant: {...} }`, admin both |

Claim flow: `pending_proof` -> (proof) `under_review` -> `approved` \| `rejected` -> (resubmit, up to 3 total) `under_review`.

## P6 Admin (role `admin`, otherwise 403)
| Method | Endpoint | Notes |
|---|---|---|
| GET | /admin/users | `q`, `role`, `status`. Item: `{ id, name, email, role, status, created_at, last_login_at, report_count, claim_count }` (no phone) |
| PATCH | /admin/users/:id/status | `{ status: "active"\|"suspended", reason? }`. Not yourself, not other admins. Suspended users get 403 on their next request |
| GET | /admin/reports | All reports including `removed`, plus `reporter_name`, `reporter_email`. Filters `type`, `status`, `species`, `barangay_id`, `user_id`, `q` |
| PATCH | /admin/reports/:id/remove | `{ reason }` required. Hidden from users, kept in the database |
| GET | /admin/claims | `status`. Item adds claimant/finder names, `attempts_used`, `proof_count`, `flagged` |
| GET | /admin/stats | `{ users, reports{lost,found,by_status,new_last_7_days}, matches, claims, recovery{lost_total,recovered,rate}, per_barangay[] }` (`rate` is a percent) |
| GET | /admin/logs | Audit trail, newest first. Filters `user_id`, `action`, `target_table`, `target_id` |

Audit actions written: `profile_updated`, `report_created`, `report_updated`, `report_status_changed`, `report_removed`, `match_created`, `match_dismissed`, `claim_created`, `proof_submitted`, `claim_approved`, `claim_rejected`, `claim_flagged`, `contact_viewed`, `user_suspended`, `user_reactivated`.

## Files
Pet photos: public read-only at `/uploads/reports/<name>`. Proof files: private (endpoint above). Uploads are checked by declared type **and** file signature, renamed to random names, max 5 MB.
