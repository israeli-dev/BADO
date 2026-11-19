import { useRef, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, Polygon, Polyline } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { BadoMapCanvas, DEFAULT_CAMPUS_CENTER } from '@/components/map/BadoMapCanvas';
import { Alert } from '@/components/ui/Alert';
import { useCampuses } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { validateDigCheck, type DigCheckInput, type DigCheckReport } from '@/lib/digCheck/digCheck';
import type { Feature } from 'geojson';
import type { GeoCoordinates } from '@/types/domain';

export function DigCheckPage() {
  const { activeInstitution, activeCampusId, activeMembership } = useAuth();
  return <DigCheckWorkspace key={`${activeInstitution?.id ?? ''}:${activeCampusId ?? ''}:${activeMembership?.userId ?? ''}`} />;
}

function DigCheckWorkspace() {
  const { gateway, activeInstitution, activeCampusId, activeMembership } = useAuth();
  const { data: campuses = [] } = useCampuses();
  const campus = campuses.find(c => c.id === activeCampusId);
  const [kind, setKind] = useState<'point' | 'polygon'>('point');
  const [vertices, setVertices] = useState<GeoCoordinates[]>([]);
  const [buffer, setBuffer] = useState('25');
  const [report, setReport] = useState<DigCheckReport | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const sequence = useRef(0);
  const scope = `${activeInstitution?.id ?? ''}:${activeCampusId ?? ''}:${activeMembership?.userId ?? ''}`;
  const [reportScope, setReportScope] = useState('');
  const clear = () => { sequence.current++; setReport(null); setError(''); setRunning(false); };
  const visibleReport = reportScope === scope ? report : null;
  async function run() {
    clear();
    const token = ++sequence.current;
    try {
      if (!activeInstitution || !activeCampusId) throw new Error('Select a campus in the application header.');
      const coords = vertices.map(v => [v.lng, v.lat]);
      if (kind === 'point' && coords.length !== 1) throw new Error('Select a site point on the map.');
      if (kind === 'polygon' && coords.length < 3) throw new Error('Select at least three area vertices on the map.');
      if (!buffer.trim()) throw new Error('Enter an awareness buffer.');
      const input: DigCheckInput = { campusId: activeCampusId, bufferM: Number(buffer), geometry: kind === 'point' ? { type: 'Point', coordinates: coords[0]! } : { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } };
      validateDigCheck(input);
      setRunning(true);
      const result = await gateway.checkBeforeDig(activeInstitution.id, input);
      if (token === sequence.current) { setReport(result); setReportScope(scope); }
    } catch (e) { if (token === sequence.current) setError(e instanceof Error ? e.message : 'Check failed.'); }
    finally { if (token === sequence.current) setRunning(false); }
  }
  const positions: [number, number][] = vertices.map(v => [v.lat, v.lng]);
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold text-slate-900">Check Before You Dig</h1><p className="text-sm text-slate-600">Spatial awareness for a proposed excavation site.</p></div>
    <Alert tone="danger" title="Not excavation clearance">No mapped assets does not mean the area is safe or free of utilities. Unrecorded or inaccurately mapped utilities may exist. Records may be restricted, outdated, or not yet synced. The buffer is not certified clearance. Consult utility owners, follow permit procedures, and verify on site before excavation.</Alert>
    <p className="text-sm">Campus: <strong>{campus?.name ?? 'Select a campus in the header'}</strong>. Only records visible to your account in this campus are checked; neighbouring campuses and hidden drafts are excluded.</p>
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-sm">Site shape<br/><select className="rounded border p-2" value={kind} onChange={e => { setKind(e.target.value as 'point' | 'polygon'); setVertices([]); clear(); }}><option value="point">Point</option><option value="polygon">Polygon</option></select></label>
      <label className="text-sm">Awareness buffer (metres, 0–500)<br/><input className="w-32 rounded border p-2" type="number" min="0" max="500" value={buffer} onChange={e => { setBuffer(e.target.value); clear(); }}/></label>
      <button className="rounded border px-3 py-2" onClick={() => { setVertices(v => v.slice(0, -1)); clear(); }}>Undo point</button>
      <button className="rounded border px-3 py-2" onClick={() => { setVertices([]); clear(); }}>Clear site</button>
      <button className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={running || !activeCampusId} onClick={run}>{running ? 'Checking…' : 'Run awareness check'}</button>
    </div>
    <p className="text-sm text-slate-600">Click the map to {kind === 'point' ? 'place the site point' : 'add polygon vertices in order'}; avoid crossing edges. {vertices.length} {vertices.length === 1 ? 'point' : 'points'} selected.</p>
    <BadoMapCanvas center={campus?.center ?? DEFAULT_CAMPUS_CENTER} focusPoint={campus?.center} focusKey={activeCampusId ?? 'none'} crosshairCursor heightClassName="h-96" onMapClick={v => { setVertices(old => kind === 'point' ? [v] : old.length < 100 ? [...old, v] : old); clear(); }}>
      {positions.map((p, i) => <CircleMarker key={i} center={p} radius={5} />)}
      {kind === 'point' && positions[0] && Number(buffer) > 0 && Number(buffer) <= 500 && <Circle center={positions[0]} radius={Number(buffer)} />}
      {kind === 'polygon' && positions.length >= 3 ? <Polygon positions={positions}/> : positions.length >= 2 ? <Polyline positions={positions}/> : null}
      {visibleReport?.results.map(r => <GeoJSON key={r.id} data={{ type: 'Feature', geometry: r.geometry, properties: {} } as Feature} />)}
    </BadoMapCanvas>
    {error && <Alert tone="danger" title="Check could not be completed">{error}</Alert>}
    {visibleReport && <section className="space-y-3"><h2 className="text-xl font-semibold">Awareness results</h2>
      <p className="text-sm">{visibleReport.mode === 'demo' ? 'Demo only — approximate local calculation, not authoritative. ' : 'Online database result. '}Checked {new Date(visibleReport.checkedAt).toLocaleString()}. Distances are to recorded geometry, not a survey of actual utilities.</p>
      {visibleReport.truncated && <Alert tone="danger">More than 200 records matched; this list is incomplete. Reduce the site or buffer and check again.</Alert>}
      {visibleReport.results.length === 0 && <Alert tone="warning">No visible mapped assets matched this area and buffer. This is not evidence of safety or absence of utilities.</Alert>}
      {visibleReport.results.map(r => <article key={r.id} className="rounded border bg-white p-4 text-sm space-y-1">
        <h3 className="font-semibold"><Link className="text-blue-700 underline" to={`/assets/${r.id}`}>{r.assetCode} — {r.name}</Link>{r.isCriticalHazard ? ' ⚠ Critical hazard' : ''}</h3>
        <p>{r.utilityGroup.replaceAll('_', ' ')} · {r.category.replaceAll('_', ' ')} · {r.distanceM.toFixed(1)} m from site</p>
        <p>Verification: {r.verificationStatus.replaceAll('_', ' ')} · Quality: {r.dataQuality.replaceAll('_', ' ')} · Status: {r.operationalStatus.replaceAll('_', ' ')}</p>
        <p>Recorded depth: {r.recordedDepthM == null ? 'unknown' : `${r.recordedDepthM} m`} · Method: {r.depthMeasurementMethod?.replaceAll('_', ' ') ?? 'unknown'} · {r.depthIsVariable ? 'Depth may vary' : 'Single recorded depth'}</p>
        <p>Depth observations: {r.depthObservationCount}{r.minDepthM != null && r.maxDepthM != null ? ` (${r.minDepthM}–${r.maxDepthM} m)` : ''} · Photos: {r.photoCount} (open asset for details)</p>
        <p>Horizontal accuracy: {r.horizontalAccuracyM == null ? 'unknown' : `${r.horizontalAccuracyM} m`} · Updated: {new Date(r.updatedAt).toLocaleString()} · Last verified: {r.lastVerifiedAt ? new Date(r.lastVerifiedAt).toLocaleString() : 'never recorded'}</p>
      </article>)}
    </section>}
  </div>;
}
