# BADO — System Architecture

*Reflects completed **Phase 1 — Foundation** implementation plus approved extension seams for Phases 2–9.*

## High-Level Topology

```text
┌──────────────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite SPA (Mobile-First, PWA-ready)          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Feature Modules (auth, dashboard, admin, sync; + Phases 2–8)   │  │
│  └──────────────────────────────┬─────────────────────────────────┘  │
│                                 │ TanStack Query + Dexie liveQuery   │
│  ┌──────────────────────────────▼─────────────────────────────────┐  │
│  │ Data Gateway Interface (src/lib/data/gateway.ts)               │  │
│  │  • SupabaseDataGateway (production PostgreSQL + PostGIS + RLS) │  │
│  │  • LocalDemoDataGateway (labelled simulated IndexedDB sandbox) │  │
│  └───────────────┬────────────────────────────────┬───────────────┘  │
│                  │                                │                  │
│                  ▼                                ▼                  │
│    Dexie.js (IndexedDB)                  Supabase JS Client          │
│    • Reference caches + cacheMeta        • Public anon key only      │
│    • Idempotent syncQueue outbox         • Auth session (JWT)        │
└───────────────────────────────────────────────────┼──────────────────┘
                                                    │ HTTPS
                                                    ▼
                               ┌───────────────────────────────────────┐
                               │ Supabase Platform                     │
                               │ • Supabase Auth                       │
                               │ • PostgreSQL + PostGIS (EPSG:4326)    │
                               │ • Forced Row Level Security (RLS)     │
                               │ • Append-only audit_logs triggers     │
                               │ • Supabase Storage (Phase 2+)         │
                               └───────────────────────────────────────┘
```

## Directory Layout (Phase 1)

- `supabase/config.toml` — Supabase CLI configuration (public self-signup disabled; min password length 10).
- `supabase/migrations/` — Version-controlled PostgreSQL + PostGIS + RLS migrations.
- `supabase/seed.sql` — Clearly labelled simulated demonstration university seed.
- `src/app/` — Root router, providers, lazy route splitting, navigation model, and responsive layout shell.
- `src/components/ui/` — Accessible reusable UI primitives.
- `src/components/feedback/` — `SyncStatusBadge` and `DemoEnvironmentBanner`.
- `src/features/auth/` — Session provider, `ProtectedRoute` guard, and `SignInPage`.
- `src/features/dashboard/` — Main Dashboard with five prominent actions, register metrics, sync summary, and active legend convention.
- `src/features/admin/` — Working Administration console (Campuses, Departments, Users & Roles, Legend & Thresholds, Audit Logs) and TanStack Query hooks.
- `src/features/sync/` — Offline storage, cache freshness, and sync queue inspector.
- `src/features/shared/` — Transparent placeholder view for modules scheduled in Phases 2–8.
- `src/lib/config/` — Zod runtime environment validation (with secret-key guard) and configurable map legend defaults.
- `src/lib/permissions/` — Role-based capability definitions mirroring SQL RLS policies.
- `src/lib/db/` & `src/lib/sync/` — Dexie IndexedDB schema, idempotent queue helpers, cache metadata, and online/offline listener.
- `src/lib/data/` — Data gateway contract, Supabase adapter, local demo adapter, and demonstration seed.
- `src/types/` — Domain models and typed Supabase database definitions.
