# BADO — System Architecture

*Reflects completed **Phase 1 (Institutional Foundation)** and **Phase 2 (Core Asset Management)** implementation plus approved extension seams for Phases 3–9.*

## High-Level Topology

```text
┌──────────────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite SPA (Mobile-First, PWA-ready)          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Feature Modules (auth, dashboard, assets, admin, sync)         │  │
│  └──────────────────────────────┬─────────────────────────────────┘  │
│                                 │ TanStack Query + Dexie liveQuery   │
│  ┌──────────────────────────────▼─────────────────────────────────┐  │
│  │ BadoDataGateway (src/lib/data/gateway.ts)                      │  │
│  │  • SupabaseDataGateway (PostGIS + RPC + Storage + RLS)         │  │
│  │  • LocalDemoDataGateway (labelled simulated IndexedDB sandbox) │  │
│  └───────────────┬────────────────────────────────┬───────────────┘  │
│                  │                                │                  │
│                  ▼                                ▼                  │
│    Dexie.js v2 (IndexedDB)               Supabase JS Client          │
│    • Asset/benchmark/media caches        • Public anon key only      │
│    • Compressed localMediaBlobs          • Auth session (JWT)        │
│    • Idempotent syncQueue outbox         • Short-lived signed URLs   │
└───────────────────────────────────────────────────┼──────────────────┘
                                                    │ HTTPS
                                                    ▼
                               ┌───────────────────────────────────────┐
                               │ Supabase Platform                     │
                               │ • Supabase Auth                       │
                               │ • PostgreSQL + PostGIS (EPSG:4326)    │
                               │ • Forced Row Level Security (RLS)     │
                               │ • Governance & audit_logs triggers    │
                               │ • Private Storage (photos/documents)  │
                               └───────────────────────────────────────┘
```

## Directory Layout (Phases 1–2)

- `supabase/config.toml` — Supabase CLI configuration (public self-signup disabled; min password length 10).
- `supabase/migrations/` — Version-controlled PostgreSQL + PostGIS + Storage + RLS migrations (Phases 1–2).
- `supabase/seed.sql` — Clearly labelled simulated demonstration university, campuses, benchmarks, and assets.
- `src/app/` — Root router, providers, lazy route splitting, navigation model, and responsive layout shell.
- `src/components/ui/` — Accessible mobile-first UI primitives (`Button`, `Input`, `Textarea`, `Select`, `Badge`, `Card`, `EmptyState`, `Alert`, `LegendIcon`).
- `src/components/feedback/` — `SyncStatusBadge` and `DemoEnvironmentBanner`.
- `src/features/auth/` — Session provider, `ProtectedRoute` guard, and `SignInPage`.
- `src/features/dashboard/` — Main Dashboard with five prominent actions, live linked asset KPI metrics, sync status, and active legend convention.
- `src/features/assets/` — Institutional Asset Register (`AssetListPage`), dynamic GPS/GNSS-ready `AssetRegistrationPage`, `AssetDetailPage` (with photos, documents, verification workflow, and soft archival), status/accuracy badges, and TanStack Query hooks.
- `src/features/admin/` — Administration console (Campuses, Departments, Users & Roles, Legend & Thresholds, Audit Logs) and hooks.
- `src/features/sync/` — Offline storage, cache freshness, and sync queue inspector.
- `src/features/shared/` — Transparent placeholder view for modules scheduled in Phases 3–8.
- `src/lib/assets/` — Default 20-type asset catalog, labels/datum/CRS constants, and Zod + dynamic schema validators.
- `src/lib/geo/` — Foreground single-point geolocation capture (`captureSingleGpsPosition`) and coordinate extraction utilities.
- `src/lib/media/` — Photo/document MIME & size validation, filename sanitisation, and client-side JPEG compression.
- `src/lib/config/` — Zod runtime environment validation (with secret-key guard) and configurable map legend defaults.
- `src/lib/permissions/` — Role-based capability definitions mirroring SQL RLS policies.
- `src/lib/db/` & `src/lib/sync/` — Dexie v2 IndexedDB schema, idempotent queue helpers, cache metadata, and online/offline listener.
- `src/lib/data/` — `BadoDataGateway` contract, Supabase PostGIS/Storage adapter, local demo adapter, and simulated demo seed.
- `src/types/` — Domain models (GeoJSON geometries, assets, benchmarks, GNSS, verification, media) and typed Supabase database definitions.
