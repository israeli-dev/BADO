# BADO — Security & Permissions

## Defense-in-Depth Model

1. **Authentication:** Supabase Auth email/password sessions (with public self-signup disabled in `supabase/config.toml`; accounts are invited/assigned by university administrators).
2. **Forced Row Level Security (RLS):** Every table in `public` has both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
3. **Non-Recursive Security Definer Helpers:**
   - `public.current_user_institution_ids()`
   - `public.current_user_role(p_institution_id)`
   - `public.has_institution_role(p_institution_id, p_roles)`
   - `public.has_campus_access(p_institution_id, p_campus_id)`
   All four lock `search_path = public, pg_temp`, revoke `PUBLIC` execution, and grant execute only to `authenticated`.
4. **Privilege Escalation Prevention:**
   - Users cannot insert or modify their own `user_institutions` row unless they already hold `'admin'` in that exact institution.
   - Database trigger `prevent_institution_reassignment()` blocks tampering with `institution_id` on updates.
   - Database trigger `protect_last_institution_admin()` prevents locking an institution out of administrative control.
   - Database trigger `prevent_audit_log_mutation()` prevents altering or deleting audit history.
5. **Secret Protection:**
   - `.gitignore` excludes all `.env` and `.env.*` files except `.env.example`.
   - `src/lib/config/env.ts` runs `assertNotServiceRoleKey()` at startup, immediately rejecting any `sb_secret_*` key or JWT carrying `"role": "service_role"`.
   - Frontend RBAC checks (`src/lib/permissions/rbac.ts` and `ProtectedRoute`) improve UI clarity only — authoritative access control always resides in PostgreSQL RLS.

## Role Capability Summary

| Role | Core Scope |
|---|---|
| `admin` | Full institutional governance: settings, legend, campuses, departments, user role assignments, audit logs, and all operational modules. |
| `supervisor` | Infrastructure viewing, asset registration, verification review/approval, archival, maintenance oversight, and report/GIS exports. |
| `field_technician` | Field asset registration, GPS & route capture, photo upload, QR scanning, Check Before You Dig, BADO Live, and inspection/maintenance logging. |
| `surveyor_gis` | Survey benchmarks, spatial geometry editing, validated GeoJSON import/export, spatial accuracy review, and field mapping. |
| `read_only` | View-only access to permitted campuses, maps, asset registers, proximity checks, reports, and authorised digital passports. |
