# BADO — Buried Asset Documentation & Operations (University Edition)

> **Document Before Covering. Check Before Digging.**

BADO is a mobile-first, offline-first infrastructure documentation, GIS mapping, asset management, and spatial awareness platform built for universities and tertiary institutions (initial pilot target: **Federal University of Technology, Akure — FUTA, Nigeria**, represented through standard multi-institution database records rather than hardcoded logic).

---

## Current Implementation Status (Phases 1–2 Completed)

### Implemented in Phase 1 — Institutional Foundation
- **Frontend Foundation:** React 19, Vite, strict TypeScript, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, and Zod validation.
- **Reusable Accessible UI Kit:** Mobile-first components (`Button`, `Input`, `Textarea`, `Select`, `Badge`, `Card`, `EmptyState`, `Alert`, `LegendIcon`) and field status indicators (`SyncStatusBadge`, `DemoEnvironmentBanner`).
- **Responsive App Shell & Dashboard:** Desktop sidebar + mobile drawer/bottom navigation, institution and campus selectors, five prominent field action entry points, live filtered register KPI summary cards, and configurable map legend display.
- **Institutional Database & PostGIS Foundation (`supabase/migrations/20261118000100_phase1_institutional_foundation.sql`):** `institutions`, `institution_settings`, `campuses` (PostGIS `EPSG:4326` geometry + GIST indexes), `departments`, `profiles`, `user_institutions`, append-only `audit_logs`, and `sync_idempotency_ledger`, protected by forced Row Level Security (RLS) and integrity triggers.
- **Authentication, RBAC & Multi-Institution Isolation:** Five roles (`admin`, `supervisor`, `field_technician`, `surveyor_gis`, `read_only`), dual-mode data gateway (`SupabaseDataGateway` for production + clearly labelled `LocalDemoDataGateway` for simulated training and automated testing), and working Administration console (Campuses, Departments, Users & Roles, Legend & Awareness Thresholds, Audit Logs).

### Implemented in Phase 2 — Core Asset Management
- **Core Asset & Benchmark Schema (`supabase/migrations/20261118000200_phase2_core_asset_registry.sql`):** Institution-owned configurable `asset_types` (automatically seeded with 20 university asset types across surface, underground, and survey reference categories), `assets` with PostGIS `EPSG:4326` geometries + GIST indexes + GNSS-ready positioning fields + soft archival, `survey_benchmarks`, `asset_observations`, immutable `asset_verification_history`, `asset_photos`, `asset_documents`, `review_asset_verification()` RPC, and private path-scoped Supabase Storage buckets (`asset-photos`, `asset-documents`).
- **Institutional Asset Register (`/assets`):** Searchable, URL-filterable register by campus, category, asset type, utility group, verification status (including pending review), and Survey Benchmark Reference ID, showing verification, accuracy, hazard, depth/elevation, and offline pending indicators.
- **Dynamic Asset Registration (`/assets/new`):** Mobile-first registration adapting fields per selected asset type (`fieldSchema`), single-point GPS capture + coordinate entry + fine pin-adjustment tracking (`isManuallyAdjusted`), survey-grade GNSS metadata, underground burial depth attribution (explicitly separated from GPS altitude), Survey Benchmark geodetic registration (`admin`/`surveyor_gis`), benchmark references, validated & client-compressed photographs, PDF/CSV/GeoJSON/TXT documents, Save Draft vs Submit for Verification, and offline queueing.
- **Asset Detail, Approval Workflow & Soft Archival (`/assets/:assetId`):** Full specification and GNSS metadata view, photo gallery + upload, document download + upload, draft submission, Supervisor/Administrator approval workflow (`verified`, `under_review`, `needs_resurvey`, `rejected`) + Surveyor spatial review (`under_review`, `needs_resurvey`) with mandatory remarks on rejection/re-survey, immutable chronological verification history, and audited soft-archive flow.
- **Offline Storage (Dexie v2):** Local IndexedDB stores for asset types, assets, benchmarks, observations, verification history, media metadata, and compressed media blobs alongside the idempotent `syncQueue` outbox (`/sync`).

### Scheduled for Upcoming Phases (Not Yet Implemented)
- **Phase 3:** Interactive Leaflet GIS Map & Linear Utility Mapping (GPS walk-and-record, manual drawing/editing, GeoJSON import/export, positioned depth observations).
- **Phase 4:** Check Before You Dig spatial query and excavation buffer workflow.
- **Phase 5:** BADO Live foreground GPS proximity awareness and offline cached awareness.
- **Phase 6:** Borehole Passport, unified inspections/maintenance history, QR generation/scanning, and printable labels.
- **Phase 7:** Full PWA service worker, broader offline operations, automated background synchronisation and conflict resolution UI. Foreground replay covers newly captured points, routes, depth observations, photos and documents; see `docs/LINEAR_MAPPING.md` for limitations.
- **Phase 8–9:** Institutional CSV/GeoJSON/PDF reports, QGIS desktop connection guide, E2E testing, and production deployment hardening.

---

## Getting Started

### Prerequisites
- Node.js 20+ and npm 10+
- *(For live cloud mode)* A Supabase project with PostgreSQL, the `postgis` extension enabled, and Supabase Storage enabled

### Local Development
```bash
npm install
cp .env.example .env   # Leave Supabase vars blank for Simulated Demo Mode, or populate for live Supabase
npm run dev
```

### Applying Database Migrations to Supabase
Apply the ordered SQL migrations in `supabase/migrations/` (`20261118000100_phase1_institutional_foundation.sql` followed by `20261118000200_phase2_core_asset_registry.sql`) via the Supabase CLI (`supabase db push`) or the Supabase SQL Editor. Optional fictional training records are provided in `supabase/seed.sql`.

> **Security:** Never place `SUPABASE_SERVICE_ROLE_KEY` or direct database passwords in `.env` or any `VITE_*` variable. BADO includes a runtime startup guard that rejects `service_role` and `sb_secret_*` keys in frontend configuration.

### Verification Commands
```bash
npm run typecheck   # TypeScript project-reference check
npm run lint        # ESLint static analysis
npm test            # Vitest automated unit & UI integration suite (38 tests)
npm run build       # Production bundle build
```

---

## Documentation Index

- [`docs/PRODUCT_OVERVIEW.md`](docs/PRODUCT_OVERVIEW.md)
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md)
- [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md)
- [`docs/SECURITY_AND_PERMISSIONS.md`](docs/SECURITY_AND_PERMISSIONS.md)
- [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)
