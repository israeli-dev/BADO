-- Atomic route writes; functions execute with caller privileges so RLS and governance triggers remain in force.
begin;

create or replace function public.create_linear_route_atomic(
  p_institution_id uuid, p_asset jsonb, p_vertices jsonb, p_depths jsonb, p_junctions jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_asset_id uuid := (p_asset->>'id')::uuid;
  v_asset public.assets;
begin
  if auth.uid() is null or v_asset_id is null or p_asset->>'institution_id' is distinct from p_institution_id::text then
    raise exception 'Invalid route identity' using errcode = '42501';
  end if;
  if jsonb_typeof(p_vertices) is distinct from 'array' or jsonb_array_length(p_vertices) < 2 then
    raise exception 'Route vertices must be an array of at least two points' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_vertices) j where j->>'asset_id' is distinct from v_asset_id::text or j->>'institution_id' is distinct from p_institution_id::text) then
    raise exception 'Route vertex institution and asset must match the route' using errcode = '22023';
  end if;
  if p_junctions is not null and p_junctions <> 'null'::jsonb then
    if jsonb_typeof(p_junctions) <> 'array' then
      raise exception 'Junctions must be an array' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_junctions) j where j->>'asset_id' is distinct from v_asset_id::text or j->>'institution_id' is distinct from p_institution_id::text) then
      raise exception 'Junction institution and asset must match the route' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(p_depths) is distinct from 'array' then
    raise exception 'Depth observations must be an array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_depths) j where j->>'asset_id' is distinct from v_asset_id::text or j->>'institution_id' is distinct from p_institution_id::text) then
    raise exception 'Depth observation institution and asset must match the route' using errcode = '22023';
  end if;
  insert into public.assets (id, institution_id, campus_id, department_id, asset_type_id, asset_code, name, category, utility_group, description, geom, installation_date, operational_status, physical_condition, verification_status, data_quality, is_critical_hazard, material, diameter_mm, cable_specification, recorded_depth_m, depth_is_variable, depth_measurement_method, documented_before_covering, direction_description, construction_record_ref, custom_attributes, reference_benchmark_id, location_reference_text, notes, position_source, capture_method, receiver_model, horizontal_accuracy_m, vertical_accuracy_m, fix_quality, correction_source, source_crs, measured_at, is_manually_adjusted, captured_at)
    select x.id, x.institution_id, x.campus_id, x.department_id, x.asset_type_id, x.asset_code, x.name, x.category, x.utility_group, x.description, x.geom, x.installation_date, x.operational_status, x.physical_condition, x.verification_status, x.data_quality, x.is_critical_hazard, x.material, x.diameter_mm, x.cable_specification, x.recorded_depth_m, x.depth_is_variable, x.depth_measurement_method, x.documented_before_covering, x.direction_description, x.construction_record_ref, x.custom_attributes, x.reference_benchmark_id, x.location_reference_text, x.notes, x.position_source, x.capture_method, x.receiver_model, x.horizontal_accuracy_m, x.vertical_accuracy_m, x.fix_quality, x.correction_source, x.source_crs, x.measured_at, x.is_manually_adjusted, x.captured_at from jsonb_populate_record(null::public.assets, p_asset) x
    returning * into v_asset;
  if geometrytype(v_asset.geom) not in ('LINESTRING', 'MULTILINESTRING') or st_length(v_asset.geom::geography) <= 0 then
    raise exception 'Route geometry must be non-zero and linear' using errcode = '22023';
  end if;
  insert into public.utility_route_vertices (id, institution_id, asset_id, part_index, sequence_index, vertex_kind, geom, chainage_m, horizontal_accuracy_m, vertical_accuracy_m, fix_quality, notes, recorded_at)
    select x.id, x.institution_id, x.asset_id, x.part_index, x.sequence_index, x.vertex_kind, x.geom, x.chainage_m, x.horizontal_accuracy_m, x.vertical_accuracy_m, x.fix_quality, x.notes, x.recorded_at from jsonb_populate_recordset(null::public.utility_route_vertices, p_vertices) x;
  insert into public.utility_depth_observations (id, institution_id, asset_id, geom, depth_m, measurement_method, documented_before_covering, chainage_m, horizontal_accuracy_m, notes, observed_at)
    select x.id, x.institution_id, x.asset_id, x.geom, x.depth_m, x.measurement_method, x.documented_before_covering, x.chainage_m, x.horizontal_accuracy_m, x.notes, x.observed_at from jsonb_populate_recordset(null::public.utility_depth_observations, p_depths) x;
  insert into public.utility_junctions (id, institution_id, asset_id, connected_asset_id, junction_kind, label, geom, depth_m, depth_measurement_method, notes, recorded_at)
    select x.id, x.institution_id, x.asset_id, x.connected_asset_id, x.junction_kind, x.label, x.geom, x.depth_m, x.depth_measurement_method, x.notes, x.recorded_at from jsonb_populate_recordset(null::public.utility_junctions, coalesce(nullif(p_junctions, 'null'::jsonb), '[]'::jsonb)) x;
  return to_jsonb(v_asset) || jsonb_build_object('geom', st_asgeojson(v_asset.geom)::jsonb);
end;
$$;

create or replace function public.update_linear_route_atomic(
  p_institution_id uuid, p_asset_id uuid, p_update jsonb, p_vertices jsonb, p_junctions jsonb, p_expected_version integer default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_asset_id uuid := p_asset_id;
  v_asset public.assets;
begin
  if auth.uid() is null or not public.can_replace_asset_geometry(p_institution_id, p_asset_id) then
    raise exception 'Not authorised to edit this route' using errcode = '42501';
  end if;
  if jsonb_typeof(p_vertices) is distinct from 'array' or jsonb_array_length(p_vertices) < 2 then
    raise exception 'Route vertices must be an array of at least two points' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_vertices) j where j->>'asset_id' is distinct from v_asset_id::text or j->>'institution_id' is distinct from p_institution_id::text) then
    raise exception 'Route vertex institution and asset must match the route' using errcode = '22023';
  end if;
  if p_junctions is not null and p_junctions <> 'null'::jsonb then
    if jsonb_typeof(p_junctions) <> 'array' then
      raise exception 'Junctions must be an array' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_junctions) j where j->>'asset_id' is distinct from v_asset_id::text or j->>'institution_id' is distinct from p_institution_id::text) then
      raise exception 'Junction institution and asset must match the route' using errcode = '22023';
    end if;
  end if;
  update public.assets a set
    geom = st_geomfromewkt(p_update->>'geom'),
    is_manually_adjusted = coalesce((p_update->>'is_manually_adjusted')::boolean, a.is_manually_adjusted),
    measured_at = coalesce((p_update->>'measured_at')::timestamptz, a.measured_at),
    position_source = case when p_update ? 'position_source' then (p_update->>'position_source')::public.position_source else a.position_source end,
    capture_method = case when p_update ? 'capture_method' then (p_update->>'capture_method')::public.capture_method else a.capture_method end,
    horizontal_accuracy_m = case when p_update ? 'horizontal_accuracy_m' then (p_update->>'horizontal_accuracy_m')::numeric else a.horizontal_accuracy_m end
    where a.institution_id = p_institution_id and a.id = p_asset_id and a.archived_at is null
      and (p_expected_version is null or a.version = p_expected_version)
    returning a.* into v_asset;
  if not found then
    raise exception 'Route has changed or is no longer accessible. Reload before saving.' using errcode = '40001';
  end if;
  if geometrytype(v_asset.geom) not in ('LINESTRING', 'MULTILINESTRING') or st_length(v_asset.geom::geography) <= 0 then
    raise exception 'Route geometry must be non-zero and linear' using errcode = '22023';
  end if;
  delete from public.utility_route_vertices where institution_id = p_institution_id and asset_id = p_asset_id;
  insert into public.utility_route_vertices (id, institution_id, asset_id, part_index, sequence_index, vertex_kind, geom, chainage_m, horizontal_accuracy_m, vertical_accuracy_m, fix_quality, notes, recorded_at)
    select x.id, x.institution_id, x.asset_id, x.part_index, x.sequence_index, x.vertex_kind, x.geom, x.chainage_m, x.horizontal_accuracy_m, x.vertical_accuracy_m, x.fix_quality, x.notes, x.recorded_at from jsonb_populate_recordset(null::public.utility_route_vertices, p_vertices) x;
  if p_junctions is not null and p_junctions <> 'null'::jsonb then
    delete from public.utility_junctions where institution_id = p_institution_id and asset_id = p_asset_id;
  insert into public.utility_junctions (id, institution_id, asset_id, connected_asset_id, junction_kind, label, geom, depth_m, depth_measurement_method, notes, recorded_at)
    select x.id, x.institution_id, x.asset_id, x.connected_asset_id, x.junction_kind, x.label, x.geom, x.depth_m, x.depth_measurement_method, x.notes, x.recorded_at from jsonb_populate_recordset(null::public.utility_junctions, p_junctions) x;
  end if;
  return to_jsonb(v_asset) || jsonb_build_object('geom', st_asgeojson(v_asset.geom)::jsonb);
end;
$$;

revoke all on function public.create_linear_route_atomic(uuid,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.update_linear_route_atomic(uuid,uuid,jsonb,jsonb,jsonb,integer) from public;
grant execute on function public.create_linear_route_atomic(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.update_linear_route_atomic(uuid,uuid,jsonb,jsonb,jsonb,integer) to authenticated;
commit;
