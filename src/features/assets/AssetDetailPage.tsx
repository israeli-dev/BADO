import {
  Archive,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { AssetMiniMap } from '@/components/map/AssetMiniMap';
import { DepthObservationForm } from '@/features/routes/DepthObservationForm';
import { isLinearGeometry } from '@/lib/gis/geometry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LegendIcon } from '@/components/ui/LegendIcon';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  AccuracyBadge,
  CriticalHazardBadge,
  DataQualityBadge,
  OperationalBadge,
  PendingSyncBadge,
  VerificationBadge,
} from '@/features/assets/AssetStatusBadges';
import {
  useArchiveAsset,
  useAssetDetail,
  useReviewAssetVerification,
  useSubmitDraftAsset,
  useUploadAssetDocument,
  useUploadAssetPhoto,
} from '@/features/assets/useAssets';
import { useAuth } from '@/features/auth/AuthContext';
import {
  ASSET_CATEGORY_LABELS,
  CAPTURE_METHOD_LABELS,
  DEPTH_METHOD_LABELS,
  DOCUMENT_KIND_LABELS,
  GNSS_FIX_LABELS,
  PHOTO_KIND_LABELS,
  PHYSICAL_CONDITION_LABELS,
  POSITION_SOURCE_LABELS,
  UTILITY_GROUP_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/lib/assets/labels';
import { extractPrimaryCoordinates } from '@/lib/geo/geolocation';
import { formatFileSize } from '@/lib/media/fileValidation';
import { ROLE_METADATA } from '@/lib/permissions/rbac';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import {
  DOCUMENT_KINDS,
  PHOTO_KINDS,
  type DocumentKind,
  type PhotoKind,
  type VerificationStatus,
} from '@/types/domain';

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const { session, activeRole, can, gateway } = useAuth();

  const { data: detail, isLoading, error } = useAssetDetail(assetId);
  const submitDraft = useSubmitDraftAsset();
  const reviewMutation = useReviewAssetVerification();
  const archiveMutation = useArchiveAsset();
  const uploadPhoto = useUploadAssetPhoto();
  const uploadDocument = useUploadAssetDocument();

  // Review workflow state
  const [reviewStatus, setReviewStatus] =
    useState<VerificationStatus>('verified');
  const [reviewRemarks, setReviewRemarks] = useState('');

  // Media upload state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoKind, setPhotoKind] = useState<PhotoKind>('overview');
  const [photoCaption, setPhotoCaption] = useState('');

  const [docFile, setDocFile] = useState<File | null>(null);
  const [docKind, setDocKind] = useState<DocumentKind>('technical_report');
  const [docTitle, setDocTitle] = useState('');

  // Archive panel state
  const [showArchiveForm, setShowArchiveForm] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');

  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    message: string;
  } | null>(null);

  if (isLoading) {
    return (
      <Card>
        <p role="status" className="py-10 text-center text-sm text-slate-600">
          Loading asset record…
        </p>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Alert tone="danger" title="Asset record unavailable">
          {error instanceof Error
            ? error.message
            : 'The requested infrastructure asset was not found.'}
        </Alert>
        <Link to="/assets">
          <Button variant="secondary" size="sm">
            Return to Asset Register
          </Button>
        </Link>
      </div>
    );
  }

  const {
    asset,
    assetType,
    campus,
    department,
    benchmark,
    referenceBenchmark,
    photos,
    documents,
    verificationHistory,
  } = detail;

  const primaryCoords = extractPrimaryCoordinates(asset.geometry);

  const canFullVerify = can('assets:verify'); // admin + supervisor
  const canSpatialReview = activeRole === 'surveyor_gis';
  const reviewOptions: { value: VerificationStatus; label: string }[] =
    canFullVerify
      ? [
          { value: 'verified', label: 'Verified — Approve Institutional Record' },
          { value: 'under_review', label: 'Under Review — In Progress' },
          {
            value: 'needs_resurvey',
            label: 'Needs Re-survey — Flag Spatial / Field Check',
          },
          {
            value: 'rejected',
            label: 'Rejected — Return to Submitter for Correction',
          },
        ]
      : canSpatialReview
        ? [
            { value: 'under_review', label: 'Under Spatial Review' },
            {
              value: 'needs_resurvey',
              label: 'Needs Re-survey — Flag Spatial Accuracy Issue',
            },
          ]
        : [];

  const effectiveReviewStatus = reviewOptions.some(
    (o) => o.value === reviewStatus,
  )
    ? reviewStatus
    : (reviewOptions[0]?.value ?? 'under_review');

  const canSubmitDraft =
    can('assets:edit_own_draft') &&
    (asset.verificationStatus === 'draft' ||
      asset.verificationStatus === 'rejected' ||
      asset.verificationStatus === 'needs_resurvey') &&
    (asset.createdBy === session?.user.id || canFullVerify);

  const handleSubmitDraft = async () => {
    setFeedback(null);
    try {
      await submitDraft.mutateAsync(asset.id);
      setFeedback({
        tone: 'success',
        message: 'Asset submitted for Supervisor verification.',
      });
    } catch (err) {
      setFeedback({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Unable to submit asset.',
      });
    }
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await reviewMutation.mutateAsync({
        assetId: asset.id,
        toStatus: effectiveReviewStatus,
        remarks: reviewRemarks,
      });
      setReviewRemarks('');
      setFeedback({
        tone: 'success',
        message: `Verification status updated to "${VERIFICATION_STATUS_LABELS[effectiveReviewStatus]}" and logged in verification & audit trails.`,
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'issues' in err &&
        Array.isArray((err as { issues: { message?: string }[] }).issues)
      ) {
        setFeedback({
          tone: 'danger',
          message:
            (err as { issues: { message?: string }[] }).issues[0]?.message ??
            'Invalid review input.',
        });
      } else {
        setFeedback({
          tone: 'danger',
          message:
            err instanceof Error ? err.message : 'Verification update failed.',
        });
      }
    }
  };

  const handlePhotoUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!photoFile) return;
    setFeedback(null);
    try {
      const result = await uploadPhoto.mutateAsync({
        assetId: asset.id,
        file: photoFile,
        photoKind,
        caption: photoCaption,
        saveOffline: !isOnline,
      });
      setPhotoFile(null);
      setPhotoCaption('');
      setFeedback({
        tone: 'success',
        message: result.localBlobId && gateway.mode === 'supabase' ? 'Photograph saved on this device and queued for synchronisation.' : 'Photograph compressed and attached to asset record.',
      });
    } catch (err) {
      setFeedback({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Photo upload failed.',
      });
    }
  };

  const handleDocUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!docFile) return;
    setFeedback(null);
    try {
      const result = await uploadDocument.mutateAsync({
        assetId: asset.id,
        file: docFile,
        documentKind: docKind,
        title: docTitle || docFile.name,
        saveOffline: !isOnline,
      });
      setDocFile(null);
      setDocTitle('');
      setFeedback({
        tone: 'success',
        message: result.localBlobId && gateway.mode === 'supabase' ? 'Document saved on this device and queued for synchronisation.' : 'Technical document attached to asset record.',
      });
    } catch (err) {
      setFeedback({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Document upload failed.',
      });
    }
  };

  const handleArchive = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await archiveMutation.mutateAsync({
        assetId: asset.id,
        reason: archiveReason,
      });
      navigate('/assets', { replace: true });
    } catch (err) {
      setFeedback({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Archival failed.',
      });
    }
  };

  const dynamicEntries = assetType.fieldSchema
    .map((field) => ({
      field,
      value: asset.customAttributes[field.key],
    }))
    .filter(
      (entry) =>
        entry.value !== undefined &&
        entry.value !== null &&
        entry.value !== '',
    );

  return (
    <div className="space-y-5">
      <Link
        to="/assets"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-bado-navy-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Asset Register
      </Link>

      <Card>
        <h2 className="mb-3 font-semibold">Mapped location</h2>
        <AssetMiniMap asset={asset} assetType={assetType} depthObservations={detail.depthObservations} junctions={detail.junctions} canEditRouteGeometry={can('routes:edit_geometry')} />
        {asset.routeLengthM != null && <p className="mt-2 text-sm">Route length: {asset.routeLengthM.toFixed(1)} m · {detail.routeVertices.length} recorded vertices</p>}
        {detail.depthObservations.length > 0 && <div className="mt-3"><h3 className="font-semibold">Depth observations</h3><ul>{detail.depthObservations.map(d => <li key={d.id}>{d.depthM} m · {DEPTH_METHOD_LABELS[d.measurementMethod]} · {d.chainageM == null ? 'chainage unknown' : `chainage ${d.chainageM.toFixed(1)} m`} {d.documentedBeforeCovering ? '· before covering' : ''}</li>)}</ul></div>}
        {detail.junctions.length > 0 && <div className="mt-3"><h3 className="font-semibold">Utility junctions</h3><ul>{detail.junctions.map(j => <li key={j.id}>{j.label || j.junctionKind}{j.depthM != null ? ` · ${j.depthM} m` : ''}</li>)}</ul></div>}
        {can('assets:create') && isLinearGeometry(asset.geometry) && <DepthObservationForm assetId={asset.id} geometry={asset.geometry} />}
      </Card>

      {/* Asset Header Banner */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-xs"
              style={{
                backgroundColor: asset.isCriticalHazard
                  ? '#dc2626'
                  : assetType.colorHex,
              }}
            >
              <LegendIcon iconKey={assetType.iconKey} className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-bado-navy-800">
                  {asset.assetCode}
                </span>
                <VerificationBadge status={asset.verificationStatus} />
                <DataQualityBadge quality={asset.dataQuality} />
                <OperationalBadge status={asset.operationalStatus} />
                {asset.isCriticalHazard && <CriticalHazardBadge />}
                {asset.localSyncStatus === 'pending' && <PendingSyncBadge />}
              </div>

              <h1 className="mt-1.5 text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
                {asset.name}
              </h1>

              <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                {assetType.name} · {ASSET_CATEGORY_LABELS[asset.category]}
                {campus ? ` · ${campus.name}` : ''}
                {department ? ` · ${department.name}` : ''}
              </p>

              {asset.lastVerifiedAt && (
                <p className="mt-1 text-xs font-medium text-emerald-800">
                  Last verified:{' '}
                  {new Date(asset.lastVerifiedAt).toLocaleString()}
                  {detail.lastVerifiedByName
                    ? ` by ${detail.lastVerifiedByName}`
                    : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSubmitDraft && (
              <Button
                size="sm"
                isLoading={submitDraft.isPending}
                leftIcon={<Send className="h-4 w-4" />}
                onClick={() => void handleSubmitDraft()}
              >
                Submit for Verification
              </Button>
            )}
            {can('assets:archive') && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Archive className="h-4 w-4" />}
                onClick={() => setShowArchiveForm((v) => !v)}
              >
                Archive
              </Button>
            )}
          </div>
        </div>

        {showArchiveForm && (
          <form
            onSubmit={handleArchive}
            className="mt-4 space-y-3 rounded-lg border border-red-200 bg-red-50/70 p-3.5"
          >
            <p className="text-xs font-semibold text-red-950">
              Soft-archive this record (preserves institutional history and writes an
              audit entry; never hard-deletes infrastructure records).
            </p>
            <Input
              label="Archival Reason"
              required
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="e.g. Duplicate field entry superseded by verified survey"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="danger"
                size="sm"
                isLoading={archiveMutation.isPending}
              >
                Confirm Archive
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowArchiveForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>

      {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Left Column: Specifications, Category Details, Media */}
        <div className="space-y-5 lg:col-span-7">
          <Card title="Record Overview & Technical Details">
            {asset.description && (
              <p className="mb-4 text-sm leading-relaxed text-slate-700">
                {asset.description}
              </p>
            )}

            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailItem
                label="Utility Classification"
                value={UTILITY_GROUP_LABELS[asset.utilityGroup]}
              />
              <DetailItem
                label="Physical Condition"
                value={PHYSICAL_CONDITION_LABELS[asset.physicalCondition]}
              />
              <DetailItem
                label="Installation Date"
                value={asset.installationDate ?? 'Not documented'}
              />
              <DetailItem
                label="Field Capture Date"
                value={new Date(asset.capturedAt).toLocaleString()}
              />
              <DetailItem
                label="Registered By"
                value={detail.registeredByName ?? 'Institutional staff'}
              />
              <DetailItem
                label="Record Version"
                value={`v${asset.version}`}
              />
              {dynamicEntries.map(({ field, value }) => (
                <DetailItem
                  key={field.key}
                  label={field.label}
                  value={
                    field.unit
                      ? `${String(value)} ${field.unit}`
                      : String(value)
                  }
                />
              ))}
            </dl>

            {(asset.locationReferenceText || asset.notes) && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                {asset.locationReferenceText && (
                  <p className="text-slate-700">
                    <strong className="font-medium text-slate-900">
                      Location Reference:
                    </strong>{' '}
                    {asset.locationReferenceText}
                  </p>
                )}
                {asset.notes && (
                  <p className="text-slate-700">
                    <strong className="font-medium text-slate-900">
                      Field Notes:
                    </strong>{' '}
                    {asset.notes}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Underground Utility Section */}
          {asset.category === 'underground' && (
            <Card
              title="Underground Utility & Burial Depth Record"
              description="Burial depth may vary along an alignment — confirm on site before excavation."
              bodyClassName="space-y-4"
            >
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <DetailItem
                  label="Material"
                  value={asset.material ?? 'Not documented'}
                />
                <DetailItem
                  label="Diameter / Cable Spec"
                  value={
                    [
                      asset.diameterMm ? `${asset.diameterMm} mm` : null,
                      asset.cableSpecification,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Not documented'
                  }
                />
                <DetailItem
                  label="Recorded Burial Depth"
                  value={
                    asset.recordedDepthM !== null
                      ? `${asset.recordedDepthM.toFixed(2)} m (${
                          asset.depthIsVariable
                            ? 'variable along alignment'
                            : 'documented uniform'
                        })`
                      : 'Not recorded'
                  }
                />
                <DetailItem
                  label="Depth Source"
                  value={
                    asset.depthMeasurementMethod
                      ? DEPTH_METHOD_LABELS[asset.depthMeasurementMethod]
                      : 'Not recorded'
                  }
                />
                <DetailItem
                  label="Documented Before Covering"
                  value={asset.documentedBeforeCovering ? 'Yes' : 'No'}
                />
                <DetailItem
                  label="Construction Record Ref"
                  value={asset.constructionRecordRef ?? 'None'}
                />
                {asset.directionDescription && (
                  <DetailItem
                    label="Direction / Alignment"
                    value={asset.directionDescription}
                  />
                )}
              </dl>
            </Card>
          )}

          {/* Survey Benchmark Geodetic Section */}
          {benchmark && (
            <Card
              title="Survey Benchmark & Geodetic Metadata"
              description="Mapping and vertical control reference specification."
            >
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <DetailItem
                  label="Benchmark Reference ID"
                  value={benchmark.referenceCode}
                  mono
                />
                <DetailItem
                  label="Monument Type"
                  value={benchmark.monumentType}
                />
                <DetailItem
                  label="Elevation"
                  value={
                    benchmark.elevationM !== null
                      ? `${benchmark.elevationM.toFixed(4)} m`
                      : 'Not recorded'
                  }
                  mono
                />
                <DetailItem
                  label="Vertical Datum"
                  value={benchmark.verticalDatum}
                />
                <DetailItem
                  label="Horizontal CRS"
                  value={benchmark.horizontalCrs}
                  mono
                />
                <DetailItem
                  label="Survey Method"
                  value={benchmark.surveyMethod}
                />
                <DetailItem
                  label="Horizontal / Vertical Accuracy"
                  value={`H: ${
                    benchmark.horizontalAccuracyM !== null
                      ? `±${benchmark.horizontalAccuracyM} m`
                      : '—'
                  } · V: ${
                    benchmark.verticalAccuracyM !== null
                      ? `±${benchmark.verticalAccuracyM} m`
                      : '—'
                  }`}
                  mono
                />
                <DetailItem
                  label="Survey Date & Surveyor"
                  value={
                    [benchmark.surveyDate, benchmark.surveyorName]
                      .filter(Boolean)
                      .join(' · ') || 'Not recorded'
                  }
                />
              </dl>
            </Card>
          )}

          {/* Photographs Card */}
          <Card
            title={`Photographs (${photos.length})`}
            description="Field overview, trench-before-covering, installation, and label photos."
            bodyClassName="space-y-4"
          >
            {photos.length === 0 ? (
              <p className="text-sm text-slate-500">
                No photographs attached to this record yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {photos.map((photo) => (
                  <figure
                    key={photo.id}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  >
                    {photo.previewUrl ? (
                      <img
                        src={photo.previewUrl}
                        alt={photo.caption || photo.fileName}
                        className="h-40 w-full object-cover bg-slate-200"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center bg-slate-100 text-xs text-slate-500">
                        {photo.fileName}
                      </div>
                    )}
                    <figcaption className="space-y-1 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="neutral">
                          {PHOTO_KIND_LABELS[photo.photoKind]}
                        </Badge>
                        <span className="text-[11px] text-slate-500">
                          {formatFileSize(photo.fileSizeBytes)}
                        </span>
                      </div>
                      {photo.caption && (
                        <p className="text-slate-800">{photo.caption}</p>
                      )}
                      <p className="text-[11px] text-slate-500">
                        Captured {new Date(photo.capturedAt).toLocaleDateString()}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            {can('assets:create') && (
              <form
                onSubmit={handlePhotoUpload}
                className="space-y-3 border-t border-slate-100 pt-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attach Field Photograph
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50">
                    <Camera className="h-4 w-4 shrink-0 text-bado-navy-800" />
                    <span className="truncate">
                      {photoFile ? photoFile.name : 'Choose JPEG / PNG / WebP…'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      aria-label="Upload asset photograph"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <Select
                    hideLabel
                    label="Photograph type"
                    value={photoKind}
                    onChange={(e) => setPhotoKind(e.target.value as PhotoKind)}
                    options={PHOTO_KINDS.map((k) => ({
                      value: k,
                      label: PHOTO_KIND_LABELS[k],
                    }))}
                  />
                </div>
                {photoFile && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      <Input
                        label="Photo Caption"
                        value={photoCaption}
                        onChange={(e) => setPhotoCaption(e.target.value)}
                        placeholder="Describe exposed utility, trench view, or nameplate"
                      />
                    </div>
                    <div className="sm:self-end">
                      <Button
                        type="submit"
                        size="md"
                        isLoading={uploadPhoto.isPending}
                      >
                        Upload Photo
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </Card>

          {/* Documents Card */}
          <Card
            title={`Technical Documents (${documents.length})`}
            description="Engineering reports, borehole logs, water quality certificates, CSV, and GeoJSON files."
            bodyClassName="space-y-4"
          >
            {documents.length === 0 ? (
              <p className="text-sm text-slate-500">
                No technical documents attached yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {doc.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {DOCUMENT_KIND_LABELS[doc.documentKind]} · {doc.fileName}{' '}
                        · {formatFileSize(doc.fileSizeBytes)}
                      </p>
                    </div>
                    {doc.downloadUrl && (
                      <a
                        href={doc.downloadUrl}
                        download={doc.fileName}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {can('assets:create') && (
              <form
                onSubmit={handleDocUpload}
                className="space-y-3 border-t border-slate-100 pt-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attach Technical Document
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50">
                    <FileText className="h-4 w-4 shrink-0 text-bado-navy-800" />
                    <span className="truncate">
                      {docFile ? docFile.name : 'Choose PDF / CSV / GeoJSON…'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.csv,.geojson,.json,.txt,application/pdf,text/csv,application/geo+json,application/json,text/plain"
                      className="sr-only"
                      aria-label="Upload asset document"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setDocFile(file);
                        if (file && !docTitle) {
                          setDocTitle(file.name.replace(/\.[^.]+$/, ''));
                        }
                      }}
                    />
                  </label>
                  <Select
                    hideLabel
                    label="Document category"
                    value={docKind}
                    onChange={(e) => setDocKind(e.target.value as DocumentKind)}
                    options={DOCUMENT_KINDS.map((k) => ({
                      value: k,
                      label: DOCUMENT_KIND_LABELS[k],
                    }))}
                  />
                </div>
                {docFile && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      <Input
                        label="Document Title"
                        required
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                      />
                    </div>
                    <div className="sm:self-end">
                      <Button
                        type="submit"
                        size="md"
                        isLoading={uploadDocument.isPending}
                      >
                        Upload Document
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </Card>
        </div>

        {/* Right Column: Spatial / GNSS Metadata & Verification Workflow */}
        <div className="space-y-5 lg:col-span-5">
          <Card
            title="Spatial & GNSS Positioning Metadata"
            actions={
              <AccuracyBadge
                accuracyM={asset.horizontalAccuracyM}
                fixQuality={asset.fixQuality}
              />
            }
          >
            <dl className="space-y-2.5 text-sm">
              <DetailItem
                label="Geometry Type"
                value={asset.geometry.type}
                mono
              />
              {primaryCoords && (
                <DetailItem
                  label={
                    asset.geometry.type === 'Point'
                      ? 'Coordinates (WGS84)'
                      : 'Start Vertex (WGS84)'
                  }
                  value={`${primaryCoords.lat.toFixed(6)}°, ${primaryCoords.lng.toFixed(6)}°`}
                  mono
                />
              )}
              <DetailItem
                label="Coordinate Reference System"
                value={asset.sourceCrs}
                mono
              />
              <DetailItem
                label="Position Source"
                value={POSITION_SOURCE_LABELS[asset.positionSource]}
              />
              <DetailItem
                label="Capture Method"
                value={`${CAPTURE_METHOD_LABELS[asset.captureMethod]}${
                  asset.isManuallyAdjusted ? ' (Manually adjusted)' : ''
                }`}
              />
              <DetailItem
                label="GNSS Fix Quality"
                value={GNSS_FIX_LABELS[asset.fixQuality]}
              />
              <DetailItem
                label="Accuracy (Horizontal / Vertical)"
                value={`H: ${
                  asset.horizontalAccuracyM !== null
                    ? `±${asset.horizontalAccuracyM} m`
                    : 'Unrecorded'
                } · V: ${
                  asset.verticalAccuracyM !== null
                    ? `±${asset.verticalAccuracyM} m`
                    : 'Unrecorded'
                }`}
                mono
              />
              {asset.receiverModel && (
                <DetailItem
                  label="Receiver Model"
                  value={asset.receiverModel}
                />
              )}
              {asset.correctionSource && (
                <DetailItem
                  label="Correction Source"
                  value={asset.correctionSource}
                />
              )}
              <DetailItem
                label="Measurement Timestamp"
                value={new Date(asset.measuredAt).toLocaleString()}
              />
            </dl>

            {referenceBenchmark && (
              <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3 text-xs">
                <p className="font-semibold text-cyan-950">
                  Referenced Survey Benchmark
                </p>
                <Link
                  to={`/assets/${referenceBenchmark.assetId}`}
                  className="mt-1 inline-block font-mono font-semibold text-cyan-900 underline hover:text-cyan-700"
                >
                  {referenceBenchmark.referenceCode} — {referenceBenchmark.name}
                </Link>
                {referenceBenchmark.elevationM !== null && (
                  <p className="mt-0.5 text-cyan-900/80">
                    Elevation: {referenceBenchmark.elevationM.toFixed(3)} m (
                    {referenceBenchmark.verticalDatum})
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Supervisor / Surveyor Verification Workflow */}
          {reviewOptions.length > 0 && (
            <Card
              title="Verification & Approval Decision"
              description="Enforced by database governance triggers and logged immutably."
            >
              <form onSubmit={handleReviewSubmit} className="space-y-3.5">
                <Select
                  label="Verification Decision"
                  value={effectiveReviewStatus}
                  onChange={(e) =>
                    setReviewStatus(e.target.value as VerificationStatus)
                  }
                  options={reviewOptions}
                />
                <Textarea
                  label="Reviewer Remarks"
                  required={
                    effectiveReviewStatus === 'rejected' ||
                    effectiveReviewStatus === 'needs_resurvey'
                  }
                  value={reviewRemarks}
                  onChange={(e) => setReviewRemarks(e.target.value)}
                  placeholder="Document field verification check, accuracy review, or reason for rejection/re-survey…"
                />
                <Button
                  type="submit"
                  fullWidth
                  isLoading={reviewMutation.isPending}
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                >
                  Record Verification Decision
                </Button>
              </form>
            </Card>
          )}

          {/* Chronological Verification History */}
          <Card
            title={`Verification History (${verificationHistory.length})`}
            description="Immutable chronological approval and spatial QA trail."
          >
            <ol className="space-y-3">
              {verificationHistory.map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <CheckCircle2
                        className="h-3.5 w-3.5 text-bado-navy-700"
                        aria-hidden="true"
                      />
                      <span>
                        {event.fromStatus
                          ? `${VERIFICATION_STATUS_LABELS[event.fromStatus]} → ${VERIFICATION_STATUS_LABELS[event.toStatus]}`
                          : VERIFICATION_STATUS_LABELS[event.toStatus]}
                      </span>
                    </div>
                    <time className="font-mono text-[11px] text-slate-500">
                      {new Date(event.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                  {event.remarks && (
                    <p className="mt-1.5 text-slate-700">{event.remarks}</p>
                  )}
                  {(event.reviewerName || event.reviewerRole) && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {event.reviewerName ?? 'Reviewer'}
                      {event.reviewerRole
                        ? ` (${ROLE_METADATA[event.reviewerRole].shortLabel})`
                        : ''}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 text-xs font-semibold text-slate-900 sm:text-sm ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
