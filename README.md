# BADO — Buried Asset Documentation & Operations (University Edition)

> **Document Before Covering. Check Before Digging.**

BADO is a mobile-first, offline-first infrastructure documentation, GIS mapping, asset management, and spatial awareness platform built for universities and tertiary institutions (initial pilot target: **Federal University of Technology, Akure — FUTA, Nigeria**, represented through standard multi-institution database records rather than hardcoded logic).

---

## Current Implementation Status (Phase 1 — Foundation)

### Implemented in Phase 1
- **Frontend Foundation:** React 19, Vite, strict TypeScript, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, and Zod validation.
- **Reusable Accessible UI Kit:** Mobile-first components (`Button`, `Input`, `Select`, `Badge`, `Card`, `EmptyState`, `Alert`, `LegendIcon`) and field status indicators (`SyncStatusBadge`, `DemoEnvironmentBanner`).
- **Responsive App Shell & Dashboard:** Desktop sidebar + mobile drawer/bottom navigation, institution and campus selectors, five prominent field action entry points, register KPI summary, and live configurable map legend display.
- **Institutional Database & PostGIS Foundation (`supabase/migrations/20261118000100_phase1_institutional_foundation.sql`):** `institutions`, `institution_settings`, `campuses` (PostGIS `EPSG:4326` geometry + GIST indexes), `departments`, `profiles`, `user_institutions`, append-only `audit_logs`, and `sync_idempotency_ledger`, protected by forced Row Level Security (RLS) and integrity triggers.
- **Authentication, RBAC & Multi-Institution Isolation:** Five roles (`admin`, `supervisor`, `field_technician`, `surveyor_gis`, `read_only`), dual-mode data gateway (`SupabaseDataGateway` for production + clearly labelled `LocalDemoDataGateway` for simulated training and automated testing), and working Administration console (Campuses, Departments, Users & Roles, Legend & Awareness Thresholds, Audit Logs).
- **Offline Storage Foundation:** Dexie.js (`IndexedDB`) schema, idempotent `syncQueue` operations preserving field capture timestamps, conflict review state, cache freshness metadata, and Sync Queue inspector (`/sync`).

### Scheduled for Upcoming Phases (Not Yet Implemented)
- **Phase 2:** Core Asset Management (surface, underground, benchmark registration, photos/documents, supervisor verification workflow).
- **Phase 3:** Interactive Leaflet GIS Map & Linear Utility Mapping (GPS walk-and-record, manual drawing, GeoJSON import/export, depth observations).
- **Phase 4:** Check Before You Dig spatial query and excavation buffer workflow.
- **Phase 5:** BADO Live foreground GPS proximity awareness and offline cached awareness.
- **Phase 6:** Borehole Passport, inspections/maintenance history, QR generation/scanning, and printable labels.
- **Phase 7:** Full PWA service worker, photo upload queue, and automated background synchronisation engine.
- **Phase 8–9:** Institutional CSV/GeoJSON/PDF reports, QGIS desktop connection guide, E2E testing, and production deployment hardening.

---

## Getting Started

### Prerequisites
- Node.js 20+ and npm 10+
- *(For live cloud mode)* A Supabase project with PostgreSQL and the `postgis` extension enabled

### Local Development
```bash
npm install
cp .env.example .env   # Leave Supabase vars blank for Simulated Demo Mode, or populate for live Supabase
npm run dev
```

### Applying Database Migrations to Supabase
Apply `supabase/migrations/20261118000100_phase1_institutional_foundation.sql` via the Supabase CLI (`supabase db push`) or the Supabase SQL Editor. Optional fictional training records are provided in `supabase/seed.sql`.

> **Security:** Never place `SUPABASE_SERVICE_ROLE_KEY` or direct database passwords in `.env` or any `VITE_*` variable. BADO includes a runtime startup guard that rejects `service_role` and `sb_secret_*` keys in frontend configuration.

### Verification Commands
```bash
npm run typecheck   # TypeScript project-reference check
npm run lint        # ESLint static analysis
npm test            # Vitest automated unit & UI integration suite
npm run build       # Production bundle build
```

---

## Documentation Index

- [`docs/PRODUCT_OVERVIEW.md`](docs/PRODUCT_OVERVIEW.md)
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md)
- [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md)
- [`docs/SECURITY_AND_PERMISSIONS.md`](docs/SECURITY_AND_PERMISSIONS.md)
- [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)
