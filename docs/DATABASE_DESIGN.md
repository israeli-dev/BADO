# BADO — Database Design

## Implemented Schema (Phases 1–2)

Defined in:
1. [`supabase/migrations/20261118000100_phase1_institutional_foundation.sql`](../supabase/migrations/20261118000100_phase1_institutional_foundation.sql)
2. [`supabase/migrations/20261118000200_phase2_core_asset_registry.sql`](../supabase/migrations/20261118000200_phase2_core_asset_registry.sql)

### Extensions & Enums
- **Extensions:** `pgcrypto` (`gen_random_uuid()`), `postgis` (spatial geometry/geography types and GIST indexing).
- **Phase 1 Enums:** `app_role`, `audit_action`.
- **Phase 2 Enums:** `asset_category` (`surface`, `underground`, `survey_reference`), `utility_group`, `operational_status`, `physical_condition`, `verification_status` (`draft`, `submitted`, `under_review`, `verified`, `rejected`, `needs_resurvey`), `data_quality` (`verified`, `unverified`, `needs_resurvey`, `incomplete`, `outdated`), `position_source`, `capture_method`, `gnss_fix_quality` (`autonomous`, `differential`, `rtk_float`, `rtk_fixed`, `unknown`), `depth_measurement_method`, `photo_kind`, `document_kind`.

### Entity Hierarchy (Phases 1–2)

```text
institutions (1) ── (1) institution_settings
     │ (1)      ──< (N) campuses            [center_geom Point(4326), boundary_geom MultiPolygon(4326)]
     │ (1)      ──< (N) departments
     │ (1)      ──< (N) user_institutions  >── (1) profiles (1:1 auth.users)
     │ (1)      ──< (N) asset_types         [configurable field_schema JSONB, seeded 20 default types]
     │ (1)      ──< (N) assets              [geom Geometry(Geometry, 4326), GNSS metadata, soft archive]
     │                   ├── (0..1) survey_benchmarks           [1:1 geodetic control metadata]
     │                   ├──< (N)   asset_observations          [field positional/depth observations]
     │                   ├──< (N)   asset_verification_history  [immutable approval & QA timeline]
     │                   ├──< (N)   asset_photos                [private bucket: asset-photos]
     │                   └──< (N)   asset_documents             [private bucket: asset-documents]
     │ (1)      ──< (N) audit_logs          [immutable append-only]
     └ (1)      ──< (N) sync_idempotency_ledger
```

### Key Relational, Spatial & Governance Decisions
1. **Composite Same-Institution Foreign Keys:** `campuses`, `departments`, `asset_types`, and `assets` expose composite `UNIQUE (id, institution_id)` keys. Child records bind both entity ID and `institution_id`, making cross-institution foreign-key links structurally impossible.
2. **Configurable Asset Type Catalog (`asset_types`):** `seed_default_asset_types(institution_id)` runs via an `AFTER INSERT ON institutions` trigger (and backfills existing institutions) with 20 university asset types covering surface infrastructure, buried utilities, and survey control monuments, including dynamic JSONB `field_schema` specifications.
3. **Validated PostGIS Geometries & GNSS Readiness:** `assets.geom` stores `geometry(Geometry, 4326)` validated with `ST_SRID = 4326`, `NOT ST_IsEmpty`, and `ST_IsValid`, indexed by both planar GIST and `geography` GIST indexes. Each asset records `position_source`, `capture_method`, `receiver_model`, `horizontal_accuracy_m`, `vertical_accuracy_m`, `fix_quality`, `correction_source`, `source_crs`, `measured_at`, `is_manually_adjusted`, and preserved field `captured_at`.
4. **Explicit Burial Depth Separation:** Underground burial depth (`recorded_depth_m`) is stored alongside `depth_is_variable`, `depth_measurement_method`, and `documented_before_covering`. A database constraint requires `depth_measurement_method` whenever `recorded_depth_m IS NOT NULL`, ensuring depth is never silently inferred from unreliable GPS altitude.
5. **Survey Benchmarks (`survey_benchmarks`):** Links 1:1 to `assets` (`category = 'survey_reference'`) storing institution-unique `reference_code`, `monument_type`, `elevation_m`, `vertical_datum`, `horizontal_crs`, `survey_method`, horizontal/vertical accuracy, `survey_date`, and `surveyor_name`. Any field asset can link via `assets.reference_benchmark_id`.
6. **Server-Enforced Verification & Soft Archival:** `enforce_asset_governance()` guarantees newly inserted assets can only start as `draft` or `submitted`, restricts `verified`/`rejected` to `admin` and `supervisor`, allows `surveyor_gis` to set `under_review`/`needs_resurvey`, increments optimistic lock `version`, restricts soft archival (`archived_at`) to `admin`/`supervisor`, and cascades immutable transitions into `asset_verification_history` and `audit_logs`. `review_asset_verification()` enforces mandatory reviewer remarks on `rejected` and `needs_resurvey`.
7. **Private Storage Buckets:** `asset-photos` (JPEG/PNG/WebP, ≤10 MB) and `asset-documents` (PDF/CSV/GeoJSON/JSON/TXT, ≤15 MB) enforce storage RLS scoped to `{institution_id}/{campus_id}/{asset_id}/{filename}`.

## Planned Schema Migrations (Phases 3–7)
- **Phase 3:** Linear route enrichment (`utility_route_segments`, `utility_route_vertices`, `utility_depth_observations`, `utility_junctions`, `survey_observations`) and typed QGIS PostGIS views.
- **Phase 4–5:** PostGIS `check_before_dig` and `find_nearby_infrastructure` spatial RPC functions (`SECURITY INVOKER`).
- **Phase 6:** `asset_passports`, `borehole_passports`, `borehole_equipment`, `borehole_water_quality_tests`, `inspection_records`, `maintenance_records`, and restricted `get_public_passport` RPC.
