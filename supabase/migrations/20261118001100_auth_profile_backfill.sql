-- Keep Auth as the identity source. Existing Auth accounts may predate the
-- profiles trigger. No institution membership or role is granted here.
begin;
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 140))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

-- Do not replace existing profile names or grant access to existing accounts.
insert into public.profiles (id, email, full_name)
select u.id, coalesce(u.email, ''), left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 140)
from auth.users u
on conflict (id) do nothing;

-- Keep profile contact email aligned when Auth confirms an email change.
create or replace function public.sync_auth_user_email()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set email = coalesce(new.email, ''), updated_at = now()
  where id = new.id and email is distinct from coalesce(new.email, '');
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.sync_auth_user_email() from public, anon, authenticated;
drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.sync_auth_user_email();
commit;
