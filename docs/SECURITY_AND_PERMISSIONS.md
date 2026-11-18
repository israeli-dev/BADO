# BADO — Security & Permissions

## Defense-in-Depth Model (Phases 1–2)

1. **Authentication:** Supabase Auth email/password sessions (with public self-signup disabled in `supabase/config.toml`; accounts are invited/assigned by university administrators).
2. **Forced Row Level Security (RLS):** Every table in `public` (Phases 1 and 2) has both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, enforcing mandatory `institution_id` and `has_campus_access(institution_id, campus_id)` isolation.
3. **Non-Recursive Security Definer Helpers:**
   - `public.current_user_institution_ids()`
   - `public.current_user_role(p_institution_id)`
   - `public.has_institution_role(p_institution_id, p_roles)`
   - `public.has_campus_access(p_institution_id, p_campus_id)`
   All lock `search_path = public, pg_temp`, revoke `PUBLIC` execution, and grant execute only to `authenticated`.
4. **Asset Governance & Anti-Self-Verification (Phase 2):**
   - Newly registered assets may only start as `'draft'` or `'submitted'` — never auto-`'verified'`.
   - Unsubmitted `'draft'` records are private to their author (`created_by`) and institutional reviewers (`admin`, `supervisor`, `surveyor_gis`).
   - Only `'admin'` and `'supervisor'` can transition an asset to `'verified'` or `'rejected'`, or soft-archive an asset (`archived_at`).
   - `'surveyor_gis'` can transition spatial QA status to `'under_review'` or `'needs_resurvey'`, and only `'admin'` and `'surveyor_gis'` can create or modify `survey_reference` assets and `survey_benchmarks`.
   - Rejecting or flagging `'needs_resurvey'` requires substantive reviewer remarks, and every status transition is recorded immutably in `asset_verification_history` and `audit_logs`.
   - Hard deletion of `assets`, `asset_verification_history`, and `audit_logs` is blocked; institutional records use audited soft archival.
5. **Private Media Storage Isolation (Phase 2):**
   - `asset-photos` (JPEG/PNG/WebP, ≤10 MB stored) and `asset-documents` (PDF/CSV/GeoJSON/JSON/TXT, ≤15 MB) are private buckets accessed via short-lived signed URLs.
   - Storage RLS policies validate the `{institution_id}/{campus_id}/{asset_id}/{filename}` object prefix against the caller's active membership and campus scope; filenames are sanitised against path traversal.
6. **Privilege Escalation & Secret Protection:**
   - Clients cannot modify `institution_id` or self-assign `user_institutions.role`; `protect_last_institution_admin()` prevents admin lockout.
   - `.gitignore` excludes all `.env` and `.env.*` files except `.env.example`.
   - `src/lib/config/env.ts` runs `assertNotServiceRoleKey()` at startup, rejecting any `sb_secret_*` key or JWT carrying `"role": "service_role"`.
   - Frontend RBAC checks improve UI ergonomics only — authoritative enforcement resides in PostgreSQL RLS and triggers.

## Role Capability Summary

| Role | Core Scope |
|---|---|
| `admin` | Full institutional governance: settings, legend, asset types, campuses, departments, user role assignments, benchmarks, verification, archival, audit logs, and all operational modules. |
| `supervisor` | Infrastructure viewing, asset registration, verification review/approval (`verified`/`rejected`/`needs_resurvey`/`under_review`), soft archival, maintenance oversight, and report/GIS exports. |
| `field_technician` | Surface & underground asset registration, draft management, GPS capture, compressed photo & document upload, QR scanning, Check Before You Dig, BADO Live, and inspection/maintenance logging. |
| `surveyor_gis` | Survey benchmarks & control points, spatial accuracy review (`under_review`/`needs_resurvey`), spatial geometry editing, validated GeoJSON import/export, and field mapping. |
| `read_only` | View-only access to non-draft assets, benchmarks, spatial metadata, photos, documents, maps, proximity checks, and authorised passports within permitted campuses. |
