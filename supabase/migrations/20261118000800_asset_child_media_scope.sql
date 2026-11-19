-- Align asset-child and Storage access with the parent asset's visibility.
-- Storage names are institution/campus/asset/photos|docs/filename.
begin;

-- Match the parent assets SELECT policy, including draft visibility.
create or replace function public.can_access_asset_record(p_institution_id uuid, p_asset_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.assets a
    where a.id = p_asset_id and a.institution_id = p_institution_id and a.archived_at is null
      and public.has_campus_access(a.institution_id, a.campus_id)
      and (a.verification_status <> 'draft' or a.created_by = auth.uid()
        or public.has_institution_role(a.institution_id, array['admin', 'supervisor']::public.app_role[]))
  );
$$;

-- The existing child-write helper also requires visibility of the parent. This
-- preserves role and campus checks and protects all Phase 3 child policies.
create or replace function public.can_write_asset_spatial_children(p_institution_id uuid, p_asset_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_access_asset_record(p_institution_id, p_asset_id)
    and public.has_institution_role(p_institution_id, array['admin', 'supervisor', 'field_technician', 'surveyor_gis']::public.app_role[]);
$$;

-- Invalid and malformed paths return false without attempting UUID casts. The
-- actual asset campus must match the path, not just a caller-controlled folder.
create or replace function public.can_access_asset_media_path(p_bucket text, p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  parts text[] := string_to_array(p_path, '/');
  inst uuid; campus uuid; asset uuid; expected_kind text;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if auth.uid() is null or p_write is null then return false; end if;
  expected_kind := case p_bucket when 'asset-photos' then 'photos' when 'asset-documents' then 'docs' else null end;
  if expected_kind is null or array_length(parts, 1) is distinct from 5
    or parts[1] !~ uuid_pattern or parts[2] !~ uuid_pattern or parts[3] !~ uuid_pattern
    or parts[4] <> expected_kind or parts[5] !~ '^[a-zA-Z0-9._-]+$' or parts[5] in ('.', '..') then return false; end if;
  inst := parts[1]::uuid; campus := parts[2]::uuid; asset := parts[3]::uuid;
  if not exists (select 1 from public.assets a where a.id = asset and a.institution_id = inst and a.campus_id = campus and a.archived_at is null) then return false; end if;
  if p_write then return public.can_write_asset_spatial_children(inst, asset); end if;
  return public.can_access_asset_record(inst, asset);
end;
$$;
revoke all on function public.can_access_asset_media_path(text,text,boolean) from public, anon;
grant execute on function public.can_access_asset_media_path(text,text,boolean) to authenticated;

-- The metadata path must reference the same asset as its parent row.
create or replace function public.asset_media_path_matches(p_bucket text, p_path text, p_institution_id uuid, p_asset_id uuid)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select lower(split_part(p_path, '/', 1)) = p_institution_id::text
     and lower(split_part(p_path, '/', 3)) = p_asset_id::text
     and ((p_bucket = 'asset-photos' and split_part(p_path, '/', 4) = 'photos')
       or (p_bucket = 'asset-documents' and split_part(p_path, '/', 4) = 'docs'));
$$;
revoke all on function public.asset_media_path_matches(text,text,uuid,uuid) from public, anon;
grant execute on function public.asset_media_path_matches(text,text,uuid,uuid) to authenticated;

-- Existing names are replaced rather than adding permissive OR policies.
drop policy if exists survey_benchmarks_select_member on public.survey_benchmarks;
create policy survey_benchmarks_select_member on public.survey_benchmarks for select to authenticated using (public.can_access_asset_record(institution_id, asset_id));
drop policy if exists survey_benchmarks_insert_surveyor on public.survey_benchmarks;
create policy survey_benchmarks_insert_surveyor on public.survey_benchmarks for insert to authenticated with check (public.can_access_asset_record(institution_id, asset_id) and public.has_institution_role(institution_id, array['admin', 'surveyor_gis']::public.app_role[]));
drop policy if exists survey_benchmarks_update_surveyor on public.survey_benchmarks;
create policy survey_benchmarks_update_surveyor on public.survey_benchmarks for update to authenticated using (public.can_access_asset_record(institution_id, asset_id) and public.has_institution_role(institution_id, array['admin', 'surveyor_gis']::public.app_role[])) with check (public.can_access_asset_record(institution_id, asset_id) and public.has_institution_role(institution_id, array['admin', 'surveyor_gis']::public.app_role[]));

drop policy if exists asset_observations_select_member on public.asset_observations;
create policy asset_observations_select_member on public.asset_observations for select to authenticated using (public.can_access_asset_record(institution_id, asset_id));
drop policy if exists asset_observations_insert_operator on public.asset_observations;
create policy asset_observations_insert_operator on public.asset_observations for insert to authenticated with check (public.can_write_asset_spatial_children(institution_id, asset_id));

drop policy if exists verification_history_select_member on public.asset_verification_history;
create policy verification_history_select_member on public.asset_verification_history for select to authenticated using (public.can_access_asset_record(institution_id, asset_id));
drop policy if exists verification_history_insert_reviewer on public.asset_verification_history;
create policy verification_history_insert_reviewer on public.asset_verification_history for insert to authenticated with check (public.can_access_asset_record(institution_id, asset_id) and public.has_institution_role(institution_id, array['admin', 'supervisor', 'surveyor_gis']::public.app_role[]));

drop policy if exists asset_photos_select_member on public.asset_photos;
create policy asset_photos_select_member on public.asset_photos for select to authenticated using (public.can_access_asset_record(institution_id, asset_id));
drop policy if exists asset_photos_insert_operator on public.asset_photos;
create policy asset_photos_insert_operator on public.asset_photos for insert to authenticated with check (public.can_write_asset_spatial_children(institution_id, asset_id) and public.asset_media_path_matches('asset-photos', storage_path, institution_id, asset_id) and public.can_access_asset_media_path('asset-photos', storage_path, true));
drop policy if exists asset_documents_select_member on public.asset_documents;
create policy asset_documents_select_member on public.asset_documents for select to authenticated using (public.can_access_asset_record(institution_id, asset_id));
drop policy if exists asset_documents_insert_operator on public.asset_documents;
create policy asset_documents_insert_operator on public.asset_documents for insert to authenticated with check (public.can_write_asset_spatial_children(institution_id, asset_id) and public.asset_media_path_matches('asset-documents', storage_path, institution_id, asset_id) and public.can_access_asset_media_path('asset-documents', storage_path, true));

drop policy if exists storage_asset_media_select_member on storage.objects;
create policy storage_asset_media_select_member on storage.objects for select to authenticated using (public.can_access_asset_media_path(bucket_id, name, false));
drop policy if exists storage_asset_media_insert_operator on storage.objects;
create policy storage_asset_media_insert_operator on storage.objects for insert to authenticated with check (public.can_access_asset_media_path(bucket_id, name, true));
commit;
