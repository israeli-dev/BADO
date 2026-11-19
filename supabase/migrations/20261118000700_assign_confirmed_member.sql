-- Allow an institution admin to add an existing, confirmed account by exact
-- email, scoped to one campus and read-only initially. No user may self-assign.
begin;
create or replace function public.assign_confirmed_member(
  p_institution_id uuid, p_campus_id uuid, p_email text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid;
  v_user_ids uuid[];
  v_matches integer;
  v_membership_id uuid;
begin
  if auth.uid() is null or not public.has_institution_role(p_institution_id, array['admin'::public.app_role]) then
    raise exception 'Only an active institution administrator may assign members.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.campuses c where c.id = p_campus_id and c.institution_id = p_institution_id and c.is_active) then
    raise exception 'Select an active campus in your institution.' using errcode = '22023';
  end if;
  if p_email is null or length(btrim(p_email)) < 3 or length(btrim(p_email)) > 254 then
    raise exception 'Enter a valid account email.' using errcode = '22023';
  end if;
  -- Refuse ambiguous addresses and unconfirmed accounts. Never return profile data
  -- for users outside this institution. This exact-match lookup is admin-only.
  select count(*)::integer, array_agg(u.id) into v_matches, v_user_ids from auth.users u
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if v_matches <> 1 then
    raise exception 'No unique confirmed account found for this email.' using errcode = '22023';
  end if;
  v_user_id := v_user_ids[1];
  insert into public.user_institutions (user_id, institution_id, role, allowed_campus_ids, is_active, invited_by)
    values (v_user_id, p_institution_id, 'read_only'::public.app_role, array[p_campus_id], true, auth.uid())
    on conflict (user_id, institution_id) do nothing returning id into v_membership_id;
  if v_membership_id is null then
    raise exception 'This account already has a membership in this institution; review it instead.' using errcode = '23505';
  end if;
  return v_membership_id;
end;
$$;
revoke all on function public.assign_confirmed_member(uuid, uuid, text) from public, anon;
grant execute on function public.assign_confirmed_member(uuid, uuid, text) to authenticated;
commit;
