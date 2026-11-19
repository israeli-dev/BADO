# Supabase sign-in and email setup

This guide is for a project administrator. The repository does not have access to your Supabase project, so these settings, migrations, and real email delivery must be verified there. Start with a **separate staging project and fictional data**. BADO is not production-ready until its RLS, Storage, Auth, and field workflows have been reviewed and tested.

## 1. Understand where users live

- **Authentication → Users** is the Supabase Auth user list. The system-managed `auth.users` table holds each account and UUID; do not create a separate public users table or insert directly into `auth.users`.
- `public.profiles.id` references that UUID. The database trigger creates a profile for a new Auth user. Migration `20261118001100` backfills profiles for existing Auth users and syncs subsequent Auth email changes. It does **not** grant access.
- `public.user_institutions.user_id` references `profiles.id` and binds a user to an institution and role. This table is expected to be empty before an administrator assigns access. An account can authenticate yet see “No Active Institutional Assignment”.
- The Supabase dashboard table editor usually defaults to the `public` schema, not `auth`. An empty Auth Users page means no accounts exist in **that project**, or the app points to a different project. Creating a profile or membership alone is not account registration.

## 2. Connect the correct project and apply the schema

1. Back up an existing project and inspect its migration history and existing functions/policies. Use a new staging project if unsure. Do **not** blindly reapply migrations or repair migration history. In particular migration `20261118000300` was corrected in-place previously; compare the actual function definitions and history before deciding on any repair.
2. Enable PostGIS as needed and use the Supabase CLI with your usual authenticated administrative workflow to link the intended project and apply **all** ordered migrations through `20261118001100` (e.g. `supabase db push` after linking). Inspect the pending changes first. Migration 009 needs role-creation privileges and staging security review. If using the dashboard SQL editor instead, coordinate migration history explicitly; executing SQL manually does not automatically establish CLI migration history. Do not run `supabase db reset` against a hosted project with data.
3. In the SQL editor, check that `public.profiles`, `public.user_institutions`, `public.institutions`, and `public.campuses` exist, and that the `on_auth_user_created` and `on_auth_user_email_updated` triggers are present on `auth.users`. If applying migration 011 fails because of ownership/permissions or existing data, stop and investigate; do not disable RLS or triggers to work around it.
4. Set the deployed frontend's `VITE_SUPABASE_URL` to that project's URL and `VITE_SUPABASE_ANON_KEY` to its **publishable/anon** key, and set `VITE_BADO_DATA_MODE=supabase` so missing configuration cannot silently select demo mode. Rebuild/redeploy after changes; Vite variables are embedded at build time. For local development copy `.env.example` to `.env` and restart the dev server. Never put service-role/secret keys or database passwords in browser variables, source control, or chat.

The repository's `supabase/seed.sql` contains fictional demo records; it is not required for a real institution and does not create Auth accounts. The local IndexedDB demo accounts are also not Supabase users. The local `supabase/config.toml` disables sign-up by default; changing it does not configure a hosted project.

## 3. Enable signup and confirmation email

In the **same Supabase project** as the app:

1. In Authentication settings, enable email/password sign-in and, if desired, self-signup. Enable email confirmations. New accounts have no institutional access until assigned by an admin.
2. Set the Auth Site URL to the deployed app origin. Add the exact deployed `https://your-app-domain/login` to the allowed redirect URLs; add your actual local development URL such as `http://localhost:5173/login` only for local testing. The app requests `${window.location.origin}/login`; each preview/deployment origin must be allowlisted. Never allow arbitrary redirect URLs. Your hosting must serve the SPA on `/login` (refresh/deep links must not 404).
3. Configure and verify a custom SMTP provider and sender/domain for real recipients. Supabase's default email service is intended for limited testing and may restrict recipients or rate; it is not a production mail service. Configure DNS/domain verification, sender authentication, rate limits and templates with your provider. Do not share SMTP credentials. Check Supabase Auth logs, SMTP provider delivery logs, recipient spam/junk, and address spelling. Respect resend cooldowns and limits; do not repeatedly retry.
4. Create a test account via BADO **Create an account**, open the confirmation email on the intended app origin, then sign in. Use **Resend confirmation email** on the sign-in page if appropriate. A generic confirmation response does not prove that an account exists or that mail was delivered. Expired or already-used links may require a new confirmation email. Link-scanning security software can consume one-time links; review your organisation's email security setup if links are used before recipients open them.

These emails are Supabase Auth confirmation emails. BADO does not currently send institutional assignment invitations, asset alerts, or general notification emails. Assignment itself does not send an email.

## 4. Bootstrap the first institution administrator

The app intentionally cannot grant a user their own role. A trusted project administrator must bootstrap the first admin once, after independently verifying the confirmed account and institution. Use the Supabase SQL editor with administrative access **only after migrations have succeeded**. The following example creates a new institution; change the email, name, slug and short code locally. It aborts if the email is not a unique confirmed Auth user or its profile is missing. Use a unique institution slug; do not run this example again for an existing institution.

```sql
begin;
do $$
declare
  admin_email text := 'replace-with-confirmed-admin@example.edu';
  target_user uuid;
  target_institution uuid;
begin
  select u.id into strict target_user
  from auth.users u
  where lower(u.email) = lower(btrim(admin_email))
    and u.email_confirmed_at is not null;
  if not exists (select 1 from public.profiles p where p.id = target_user) then
    raise exception 'Profile missing; check migration 011 and the Auth trigger';
  end if;
  insert into public.institutions (name, slug, short_code)
  values ('Replace with institution name', 'replace-with-unique-slug', 'REPLACE')
  returning id into target_institution;
  insert into public.user_institutions (user_id, institution_id, role, is_active)
  values (target_user, target_institution, 'admin', true);
end $$;
commit;
```

The new institution's settings and default asset types are normally created by database triggers. An admin has access to all campuses. Sign in as that confirmed administrator, create the first campus in Administration, and assign other confirmed accounts in **Administration → Users & Roles**. The app assignment function starts them as read-only in the selected campus. For an existing institution or existing membership, do not run the example blindly: have a trusted database administrator review IDs, active status, uniqueness, permissions and audit implications and use a controlled administrative process. Do not overwrite existing memberships without review. Administrative SQL actions may lack an application actor in audit logs; record the change through your organisation's change-control process.

## 5. Troubleshooting

- **“Signups not allowed”**: check hosted Auth settings; local config and hosted config are separate.
- **“Email not confirmed”**: complete the confirmation or request resend. Check spam, SMTP logs, rate limits, and the app origin/redirect allowlist.
- **Account exists in Auth but no profile / account-load error**: check all migrations, the profile triggers, and Auth logs. Migration 011 backfills existing identities without memberships. Use **Try again** after an administrator fixes the cause. Don't silently create roles or disable security.
- **No Active Institutional Assignment**: sign-in worked; contact the institution admin and use **Check assignment** after they assign your confirmed account. Check membership, institution active status, and RLS if it still fails.
- **No data or unexpected demo users**: check the visible demo badge, app build-time URL/key, and project reference. Demo mode stores fictional data locally and does not populate Supabase.
- **Confirmation goes to the wrong URL / page not found**: inspect Site URL, allowed redirects, actual origin, email template and SPA rewrite configuration. Avoid sharing login links or tokens.

Verify with real Supabase Auth and PostgREST: signup, confirmation, resend and errors, existing-account behavior, email change, sign-in/out, profile backfill, assignment, revoked access and cross-institution/campus RLS. Automated PostgreSQL tests use shims and cannot confirm hosted mail delivery. Existing institution-wide or project-specific permissive policies can still expose data across campuses; review them before adding users. Legacy replay-ledger entries require manual reconciliation and must not be blindly retried.
