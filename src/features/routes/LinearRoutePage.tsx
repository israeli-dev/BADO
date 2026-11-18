import { useEffect, useMemo, useState } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadoMapCanvas, createPlacementPinIcon } from '@/components/map/BadoMapCanvas';
import { useAssetDetail, useAssetTypes } from '@/features/assets/useAssets';
import { useCampuses } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { useCreateLinearRoute, useUpdateRouteGeometry } from '@/features/routes/useLinearRoutes';
import { createForegroundRouteTracker, type DraftRouteVertex, type RouteTrackingStatus } from '@/lib/geo/routeTracker';
import { computeGeometryLengthM, isLinearGeometry } from '@/lib/gis/geometry';
import { parseAndValidateLinearGeoJson, MAX_GEOJSON_IMPORT_BYTES } from '@/lib/gis/geojsonIo';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import type { AssetDetailBundle, GeoCoordinates, VertexKind } from '@/types/domain';

type Linear = { type: 'LineString'; coordinates: Pair[] } | { type: 'MultiLineString'; coordinates: Pair[][] };
type Pair = [number, number];
const field = 'w-full rounded border border-slate-300 p-2';

export function LinearRoutePage() {
  const { assetId } = useParams();
  const detail = useAssetDetail(assetId);
  if (assetId && detail.isLoading) return <p>Loading route…</p>;
  if (assetId && (!detail.data || !isLinearGeometry(detail.data.asset.geometry))) return <p>Route not found or not linear.</p>;
  return <RouteEditor key={assetId ?? 'new'} detail={detail.data ?? undefined} />;
}

function RouteEditor({ detail }: { detail?: AssetDetailBundle }) {
  const { activeCampusId, can } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { data: types } = useAssetTypes();
  const { data: campuses } = useCampuses();
  const create = useCreateLinearRoute();
  const update = useUpdateRouteGeometry();
  const initial = detail?.asset.geometry;
  const [parts, setParts] = useState<Pair[][]>(() => initial && isLinearGeometry(initial) ? (initial.type === 'LineString' ? [initial.coordinates] : initial.coordinates).map(p => p.map(c => [c[0]!, c[1]!])) : [[]]);
  const [mode, setMode] = useState<'manual_draw' | 'gps_walk_route' | 'geojson_import'>('manual_draw');
  const [campusId, setCampusId] = useState(detail?.asset.campusId ?? activeCampusId ?? '');
  const [typeId, setTypeId] = useState(detail?.asset.assetTypeId ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [status, setStatus] = useState<RouteTrackingStatus>('idle');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [tracked, setTracked] = useState<DraftRouteVertex[]>([]);
  const tracker = useMemo(() => createForegroundRouteTracker({
    onStatusChange: setStatus,
    onLiveFix: (fix, _accepted, reason) => { setAccuracy(fix.horizontalAccuracyM); if (reason) setInfo(reason); },
    onAppendVertex: vertex => { setTracked(v => [...v, vertex]); setParts(p => [ [...(p[0] ?? []), [vertex.location.lng, vertex.location.lat]] ]); },
    onError: setError,
  }), []);
  useEffect(() => () => tracker.stop(), [tracker]);
  const linearTypes = (types ?? []).filter(t => t.allowedGeomTypes.includes('LineString') || t.allowedGeomTypes.includes('MultiLineString'));
  const geometry: Linear = parts.length === 1 ? { type: 'LineString', coordinates: parts[0] ?? [] } : { type: 'MultiLineString', coordinates: parts };
  const count = parts.reduce((n, p) => n + p.length, 0);
  function append(c: GeoCoordinates) { if (mode !== 'manual_draw') return; setParts(p => p.map((part, i) => i === 0 ? [...part, [c.lng, c.lat]] : part)); }
  function modify(partIndex: number, index: number, value: Pair | null) { setTracked([]); setParts(p => p.map((part, i) => i !== partIndex ? part : value ? part.map((v, j) => j === index ? value : v) : part.filter((_, j) => j !== index))); }
  async function save(submissionMode: 'draft' | 'submitted') {
    setError('');
    if (parts.some(p => p.length < 2)) { setError('Each route segment needs at least two vertices.'); return; }
    try {
      const vertices = parts.flatMap((part, partIndex) => part.map(([longitude, latitude], sequenceIndex) => {
        const captured = parts.length === 1 ? tracked[sequenceIndex] : undefined;
        return { partIndex, sequenceIndex, longitude, latitude, vertexKind: captured?.vertexKind ?? 'track_point' as VertexKind, horizontalAccuracyM: captured?.horizontalAccuracyM, fixQuality: captured?.fixQuality ?? 'unknown' as const };
      }));
      const result = detail ? await update.mutateAsync({ assetId: detail.asset.id, geometry, vertices, captureMethod: mode, saveOffline: !online }) : await create.mutateAsync({ campusId, assetTypeId: typeId, assetCode: code, name, geometry, vertices, submissionMode, captureMethod: mode, positionSource: mode === 'gps_walk_route' ? 'smartphone_gps' : mode === 'geojson_import' ? 'gis_import' : 'manual_map', saveOffline: !online });
      tracker.stop(); navigate(`/assets/${result.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save route.'); }
  }
  return <div className="mx-auto max-w-5xl space-y-4">
    <Link className="text-blue-700 underline" to="/map">← Infrastructure map</Link>
    <h1 className="text-2xl font-bold">{detail ? 'Edit route geometry' : 'Record linear infrastructure'}</h1>
    <p className="text-sm text-amber-800">Mapped infrastructure may be incomplete. Never rely on this map alone for excavation decisions.</p>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {!detail && <div className="grid gap-3 sm:grid-cols-2">
      <label>Campus<select className={field} value={campusId} onChange={e => setCampusId(e.target.value)}><option value="">Select campus</option>{campuses?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Utility type<select className={field} value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">Select type</option>{linearTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Route ID<input className={field} value={code} onChange={e => setCode(e.target.value)} /></label>
      <label>Route name<input className={field} value={name} onChange={e => setName(e.target.value)} /></label>
    </div>}
    <div className="flex flex-wrap gap-2">{(['manual_draw','gps_walk_route', ...(can('gis:import') ? ['geojson_import'] as const : [])] as const).map(m => <button key={m} type="button" className={`rounded border px-3 py-2 ${mode === m ? 'bg-blue-800 text-white' : ''}`} onClick={() => { tracker.stop(); setMode(m); }}>{m === 'manual_draw' ? 'Manual draw' : m === 'gps_walk_route' ? 'GPS walk' : 'Import GeoJSON'}</button>)}</div>
    {mode === 'gps_walk_route' && <div className="space-y-2"><div className="flex flex-wrap gap-2">{(['start','pause','resume','stop'] as const).map(action => <button className="rounded border px-3 py-2 capitalize" key={action} onClick={() => tracker[action]()}>{action}</button>)}</div><p>GPS: {status}{accuracy !== null && ` · ±${accuracy} m${accuracy > 15 ? ' (poor accuracy: use caution)' : ''}`}</p><div className="flex gap-2">{(['bend','junction','valve','note_point'] as const).map(k => <button key={k} className="rounded border px-2 py-1" onClick={() => tracker.markSpecialVertex(k)}>{k.replace('_', ' ')}</button>)}</div></div>}
    {mode === 'geojson_import' && <label>Choose WGS84 GeoJSON <input type="file" accept=".geojson,.json,application/geo+json" onChange={async e => { try { const file = e.target.files?.[0]; if (!file) return; if (file.size > MAX_GEOJSON_IMPORT_BYTES) throw new Error('File exceeds 5 MB.'); const parsed = parseAndValidateLinearGeoJson(await file.text()); setParts((parsed.geometry.type === 'LineString' ? [parsed.geometry.coordinates] : parsed.geometry.coordinates).map(p => p.map(c => [c[0]!, c[1]!] as Pair))); setTracked([]); setInfo(`${parsed.partCount} parts, ${parsed.vertexCount} vertices, ${parsed.routeLengthM} m. ${parsed.warnings.join(' ')}`); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Invalid GeoJSON'); } }} /></label>}
    {info && <p className="text-sm text-slate-600">{info}</p>}
    <p>{count} vertices · {computeGeometryLengthM(geometry)?.toFixed(1)} m. Tap map to add points in manual mode; drag a vertex to adjust it.</p>
    <BadoMapCanvas onMapClick={append} crosshairCursor={mode === 'manual_draw'} heightClassName="h-96">
      {parts.map((part, pi) => <Polyline key={pi} positions={part.map(([lng,lat]) => [lat,lng])} />)}
      {parts.flatMap((part, pi) => part.map(([lng,lat], i) => <Marker key={`${pi}-${i}`} position={[lat,lng]} icon={createPlacementPinIcon()} draggable eventHandlers={{ dragend: (e) => { const pos = e.target.getLatLng(); modify(pi, i, [pos.lng, pos.lat]); } }} />))}
    </BadoMapCanvas>
    <div className="space-y-2"><h2 className="font-semibold">Vertices (WGS84 longitude, latitude)</h2>{parts.flatMap((part, pi) => part.map(([lng,lat], i) => <div className="flex flex-wrap items-center gap-2" key={`${pi}-${i}`}><span>Part {pi + 1}, point {i + 1}</span><input aria-label={`Longitude ${pi + 1}-${i + 1}`} type="number" step="any" className="w-32 rounded border p-1" value={lng} onChange={e => modify(pi,i,[Number(e.target.value),lat])}/><input aria-label={`Latitude ${pi + 1}-${i + 1}`} type="number" step="any" className="w-32 rounded border p-1" value={lat} onChange={e => modify(pi,i,[lng,Number(e.target.value)])}/><button className="text-red-700 underline" onClick={() => modify(pi,i,null)}>Delete</button>{i < part.length - 1 && <button className="text-blue-700 underline" onClick={() => setParts(p => p.map((seg,j) => j === pi ? [...seg.slice(0,i+1), [(lng + seg[i+1]![0])/2,(lat + seg[i+1]![1])/2], ...seg.slice(i+1)] : seg))}>Insert midpoint</button>}</div>))}</div>
    <div className="flex gap-2"><button className="rounded bg-blue-800 px-4 py-2 text-white" disabled={create.isPending || update.isPending} onClick={() => void save('draft')}>{detail ? 'Save geometry' : 'Save draft'}</button>{!detail && <button className="rounded border px-4 py-2" disabled={create.isPending} onClick={() => void save('submitted')}>Submit for verification</button>}</div>
    {!online && <p>Offline: changes can be queued locally, but route synchronisation is not yet verified.</p>}
  </div>;
}
