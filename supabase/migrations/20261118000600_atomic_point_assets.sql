-- Atomic point registration and idempotent replay; all writes retain caller RLS.
begin;
create or replace function public.create_point_asset_atomic(p_institution_id uuid, p_asset jsonb, p_benchmark jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_asset public.assets; v_benchmark public.survey_benchmarks;
begin
  if auth.uid() is null or p_asset->>'id' is null or p_asset->>'institution_id' is distinct from p_institution_id::text then
    raise exception 'Invalid asset identity.' using errcode = '42501';
  end if;
  insert into public.assets (id, institution_id, campus_id, department_id, asset_type_id, asset_code, name, category, utility_group, description, geom, installation_date, operational_status, physical_condition, verification_status, data_quality, is_critical_hazard, material, diameter_mm, cable_specification, recorded_depth_m, depth_is_variable, depth_measurement_method, documented_before_covering, direction_description, construction_record_ref, custom_attributes, reference_benchmark_id, location_reference_text, notes, position_source, capture_method, receiver_model, horizontal_accuracy_m, vertical_accuracy_m, fix_quality, correction_source, source_crs, measured_at, is_manually_adjusted, captured_at)
    select x.id, x.institution_id, x.campus_id, x.department_id, x.asset_type_id, x.asset_code, x.name, x.category, x.utility_group, x.description, x.geom, x.installation_date, x.operational_status, x.physical_condition, x.verification_status, x.data_quality, x.is_critical_hazard, x.material, x.diameter_mm, x.cable_specification, x.recorded_depth_m, x.depth_is_variable, x.depth_measurement_method, x.documented_before_covering, x.direction_description, x.construction_record_ref, x.custom_attributes, x.reference_benchmark_id, x.location_reference_text, x.notes, x.position_source, x.capture_method, x.receiver_model, x.horizontal_accuracy_m, x.vertical_accuracy_m, x.fix_quality, x.correction_source, x.source_crs, x.measured_at, x.is_manually_adjusted, x.captured_at from jsonb_populate_record(null::public.assets, p_asset) x
    returning * into v_asset;
  if geometrytype(v_asset.geom) <> 'POINT' then
    raise exception 'Point registration requires point geometry.' using errcode = '22023';
  end if;
  if v_asset.category = 'survey_reference' then
    if jsonb_typeof(p_benchmark) is distinct from 'object' or p_benchmark->>'institution_id' is distinct from p_institution_id::text or p_benchmark->>'asset_id' is distinct from v_asset.id::text then
      raise exception 'Valid benchmark metadata is required.' using errcode = '22023';
    end if;
    v_benchmark := jsonb_populate_record(null::public.survey_benchmarks, p_benchmark);
    insert into public.survey_benchmarks (asset_id, institution_id, reference_code, monument_type, elevation_m, vertical_datum, horizontal_crs, survey_method, horizontal_accuracy_m, vertical_accuracy_m, survey_date, surveyor_name)
      values (v_benchmark.asset_id, v_benchmark.institution_id, v_benchmark.reference_code, v_benchmark.monument_type, v_benchmark.elevation_m, v_benchmark.vertical_datum, v_benchmark.horizontal_crs, v_benchmark.survey_method, v_benchmark.horizontal_accuracy_m, v_benchmark.vertical_accuracy_m, v_benchmark.survey_date, v_benchmark.surveyor_name);
  elsif p_benchmark is not null and p_benchmark <> 'null'::jsonb then
    raise exception 'Benchmark metadata is only valid for survey reference assets.' using errcode = '22023';
  end if;
  return to_jsonb(v_asset) || jsonb_build_object('geom', st_asgeojson(v_asset.geom)::jsonb);
end;
$$;

create or replace function public.replay_point_asset_mutation(p_mutation_id uuid, p_institution_id uuid, p_actor_id uuid, p_asset_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_inserted uuid; v_previous public.sync_idempotency_ledger; v_fingerprint text;
begin
  if auth.uid() is null or p_actor_id is distinct from auth.uid() then
    raise exception 'The signed-in user must match the original capture user.' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_asset_id is null or p_payload->'assetInsert'->>'id' is distinct from p_asset_id::text then
    raise exception 'Invalid asset replay request.' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object('asset_id', p_asset_id, 'payload', p_payload)::text);
  insert into public.sync_idempotency_ledger (mutation_id, institution_id, user_id, entity_type, entity_id, operation, response_snapshot)
    values (p_mutation_id, p_institution_id, p_actor_id, 'point_assets', p_asset_id, 'create', jsonb_build_object('fingerprint', v_fingerprint))
    on conflict (mutation_id) do nothing returning mutation_id into v_inserted;
  if v_inserted is null then
    select * into v_previous from public.sync_idempotency_ledger where mutation_id = p_mutation_id;
    if not found or v_previous.institution_id <> p_institution_id or v_previous.user_id <> p_actor_id or v_previous.entity_id <> p_asset_id or v_previous.entity_type <> 'point_assets' or v_previous.response_snapshot->>'fingerprint' is distinct from v_fingerprint then
      raise exception 'Mutation ID is already in use for another operation.' using errcode = '23505';
    end if;
    if not public.can_access_asset_record(p_institution_id, p_asset_id) then
      raise exception 'Asset is no longer accessible.' using errcode = '42501';
    end if;
    return jsonb_build_object('applied', true, 'duplicate', true);
  end if;
  perform public.create_point_asset_atomic(p_institution_id, p_payload->'assetInsert', p_payload->'benchmarkInsert');
  return jsonb_build_object('applied', true, 'duplicate', false);
end;
$$;
revoke all on function public.create_point_asset_atomic(uuid,jsonb,jsonb) from public;
revoke all on function public.replay_point_asset_mutation(uuid,uuid,uuid,uuid,jsonb) from public;
grant execute on function public.create_point_asset_atomic(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.replay_point_asset_mutation(uuid,uuid,uuid,uuid,jsonb) to authenticated;
commit;
