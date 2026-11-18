# BADO — Database Design

## Implemented Schema (Phase 1)

Defined in [`supabase/migrations/20261118000100_phase1_institutional_foundation.sql`](../supabase/migrations/20261118000100_phase1_institutional_foundation.sql).

### Extensions & Enums
- **Extensions:** `pgcrypto` (`gen_random_uuid()`), `postgis` (spatial geometry/geography types and GIST indexing).
- **`public.app_role`:** `'admin'`, `'supervisor'`, `'field_technician'`, `'surveyor_gis'`, `'read_only'`.
- **`public.audit_action`:** `'insert'`, `'update'`, `'delete'`, `'archive'`, `'approve'`, `'reject'`, `'import'`, `'export'`.

### Entity Hierarchy (Phase 1)

```text
institutions (1) ── (1) institution_settings
     │ (1)      ──< (N) campuses           [center_geom Point(4326), boundary_geom MultiPolygon(4326)]
     │ (1)      ──< (N) departments
     │ (1)      ──< (N) user_institutions >── (1) profiles (1:1 auth.users)
     │ (1)      ──< (N) audit_logs         [immutable append-only]
     └ (1)      ──< (N) sync_idempotency_ledger
```

### Key Relational & Integrity Decisions
1. **Composite Same-Institution Constraints:** Both `campuses` and `departments` declare `UNIQUE (id, institution_id)`. Child tables reference `(department_id, institution_id)` (and in Phase 2, `(campus_id, institution_id)`), making it structurally impossible for a record in Institution A to point to a campus or department owned by Institution B.
2. **Join-Table Membership (`user_institutions`):** Separating identity (`profiles`) from institutional membership allows a surveyor, auditor, or trainee to hold distinct roles in a Demonstration University and a live university without data overlap.
3. **Ordered Awareness Thresholds:** `institution_settings` enforces `0 < live_close_m < live_approaching_m < live_nearby_m <= 500` and `0 < default_dig_buffer_m <= 500` directly via SQL `CHECK` constraints.
4. **Validated Spatial Columns:** `campuses.center_geom` (`Point, 4326`) and `campuses.boundary_geom` (`MultiPolygon, 4326`) enforce `ST_SRID = 4326` and `ST_IsValid`, indexed with both geometry GIST and `geography` GIST indexes.
5. **Immutable `institution_id` & Audit Logs:** Triggers reject any `UPDATE` attempting to change `institution_id`, block removal/demotion of an institution's last active administrator, automatically write before/after JSONB snapshots into `audit_logs`, and block all `UPDATE`/`DELETE` operations on `audit_logs`.
6. **Offline Idempotency (`sync_idempotency_ledger`):** Stores processed client `mutation_id` UUIDs so retried offline requests cannot duplicate institutional records.

## Planned Schema Migrations (Phases 2–7)
- **Phase 2:** `asset_types`, `assets`, `asset_observations`, `asset_verification_history`, `asset_photos`, `asset_documents`, and private Supabase Storage buckets/policies.
- **Phase 3:** `utility_routes`, `utility_route_segments`, `utility_route_vertices`, `utility_depth_observations`, `utility_junctions`, `survey_benchmarks`, `survey_observations`, and typed QGIS views.
- **Phase 4–5:** PostGIS `check_before_dig` and `find_nearby_infrastructure` spatial RPC functions (`SECURITY INVOKER`).
- **Phase 6:** `asset_passports`, `borehole_passports`, `borehole_equipment`, `borehole_water_quality_tests`, `inspection_records`, `maintenance_records`, and restricted `get_public_passport` RPC.
