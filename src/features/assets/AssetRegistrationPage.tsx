import {
  ArrowLeft,
  Building2,
  Camera,
  CloudOff,
  Crosshair,
  FileText,
  Layers,
  LocateFixed,
  Move,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LegendIcon } from '@/components/ui/LegendIcon';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  useCampuses,
  useDepartments,
} from '@/features/admin/useInstitutionalData';
import {
  useAssetTypes,
  useBenchmarkReferences,
  useCreateAsset,
  useUploadAssetDocument,
  useUploadAssetPhoto,
} from '@/features/assets/useAssets';
import { useAuth } from '@/features/auth/AuthContext';
import { generateSuggestedAssetCode } from '@/lib/assets/defaultAssetTypes';
import {
  DEPTH_METHOD_LABELS,
  DOCUMENT_KIND_LABELS,
  GNSS_FIX_LABELS,
  HORIZONTAL_CRS_OPTIONS,
  MONUMENT_TYPE_OPTIONS,
  OPERATIONAL_STATUS_LABELS,
  PHOTO_KIND_LABELS,
  PHYSICAL_CONDITION_LABELS,
  POSITION_SOURCE_LABELS,
  SURVEY_METHOD_OPTIONS,
  VERTICAL_DATUM_OPTIONS,
} from '@/lib/assets/labels';
import { captureSingleGpsPosition } from '@/lib/geo/geolocation';
import {
  formatFileSize,
  validateDocumentFile,
  validatePhotoFile,
} from '@/lib/media/fileValidation';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import {
  DEPTH_MEASUREMENT_METHODS,
  DOCUMENT_KINDS,
  GNSS_FIX_QUALITIES,
  OPERATIONAL_STATUSES,
  PHOTO_KINDS,
  PHYSICAL_CONDITIONS,
  POSITION_SOURCES,
  type AssetCategory,
  type CaptureMethod,
  type CustomAttributeValue,
  type DepthMeasurementMethod,
  type DocumentKind,
  type DynamicFieldDefinition,
  type GnssFixQuality,
  type OperationalStatus,
  type PhotoKind,
  type PhysicalCondition,
  type PositionSource,
} from '@/types/domain';

interface QueuedPhotoAttachment {
  localKey: string;
  file: File;
  photoKind: PhotoKind;
  caption: string;
}

interface QueuedDocumentAttachment {
  localKey: string;
  file: File;
  documentKind: DocumentKind;
  title: string;
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : Number.NaN;
}

const EMPTY_ASSET_TYPES: readonly import('@/types/domain').AssetTypeDefinition[] =
  [];

export function AssetRegistrationPage() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const { session, activeCampusId, can } = useAuth();
  const canManageBenchmarks = can('benchmarks:manage');

  const { data: campusesData } = useCampuses();
  const { data: departmentsData } = useDepartments();
  const { data: allAssetTypes = EMPTY_ASSET_TYPES } = useAssetTypes();
  const campuses = useMemo(() => campusesData ?? [], [campusesData]);
  const departments = useMemo(() => departmentsData ?? [], [departmentsData]);

  const createAsset = useCreateAsset();
  const uploadPhoto = useUploadAssetPhoto();
  const uploadDocument = useUploadAssetDocument();

  // Step 1–3: Campus, Category, Asset Type
  const [campusId, setCampusId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [category, setCategory] = useState<AssetCategory>('surface');
  const [assetTypeId, setAssetTypeId] = useState<string>('');

  // Step 4: Core Identification
  const [assetCode, setAssetCode] = useState<string>('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [installationDate, setInstallationDate] = useState<string>('');
  const [operationalStatus, setOperationalStatus] =
    useState<OperationalStatus>('operational');
  const [physicalCondition, setPhysicalCondition] =
    useState<PhysicalCondition>('good');
  const [isCriticalHazard, setIsCriticalHazard] = useState(false);

  // Step 5–6: GPS & GNSS Positioning
  const [latText, setLatText] = useState<string>('');
  const [lngText, setLngText] = useState<string>('');
  const [positionSource, setPositionSource] =
    useState<PositionSource>('manual_map');
  const [captureMethod, setCaptureMethod] =
    useState<CaptureMethod>('coordinate_entry');
  const [horizontalAccuracyText, setHorizontalAccuracyText] =
    useState<string>('');
  const [verticalAccuracyText, setVerticalAccuracyText] = useState<string>('');
  const [fixQuality, setFixQuality] = useState<GnssFixQuality>('unknown');
  const [receiverModel, setReceiverModel] = useState<string>('');
  const [correctionSource, setCorrectionSource] = useState<string>('');
  const [sourceCrs, setSourceCrs] = useState<string>('EPSG:4326');
  const [measuredAt, setMeasuredAt] = useState<string>(() =>
    new Date().toISOString(),
  );
  const [hadLiveGpsCapture, setHadLiveGpsCapture] = useState(false);
  const [isManuallyAdjusted, setIsManuallyAdjusted] = useState(false);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string | null>(null);
  const [showAdvancedGnss, setShowAdvancedGnss] = useState(false);

  // Dynamic Type-Specific Attributes
  const [customAttributes, setCustomAttributes] = useState<
    Record<string, string>
  >({});

  // Underground-specific fields (Section 7B)
  const [material, setMaterial] = useState<string>('');
  const [diameterText, setDiameterText] = useState<string>('');
  const [cableSpecification, setCableSpecification] = useState<string>('');
  const [recordedDepthText, setRecordedDepthText] = useState<string>('');
  const [depthIsVariable, setDepthIsVariable] = useState(true);
  const [depthMethod, setDepthMethod] = useState<DepthMeasurementMethod | ''>(
    '',
  );
  const [documentedBeforeCovering, setDocumentedBeforeCovering] =
    useState(false);
  const [directionDescription, setDirectionDescription] = useState<string>('');
  const [constructionRecordRef, setConstructionRecordRef] =
    useState<string>('');

  // Survey Benchmark-specific fields (Section 7C)
  const [bmReferenceCode, setBmReferenceCode] = useState<string>('');
  const [bmMonumentType, setBmMonumentType] = useState<string>(
    MONUMENT_TYPE_OPTIONS[0],
  );
  const [bmElevationText, setBmElevationText] = useState<string>('');
  const [bmVerticalDatum, setBmVerticalDatum] = useState<string>(
    VERTICAL_DATUM_OPTIONS[0],
  );
  const [bmHorizontalCrs, setBmHorizontalCrs] = useState<string>('EPSG:4326');
  const [bmSurveyMethod, setBmSurveyMethod] = useState<string>(
    SURVEY_METHOD_OPTIONS[0],
  );
  const [bmSurveyDate, setBmSurveyDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [bmSurveyorName, setBmSurveyorName] = useState<string>(
    () => session?.user.fullName ?? '',
  );

  // Step 9–10: Benchmark & Location References + Notes
  const [referenceBenchmarkId, setReferenceBenchmarkId] = useState<string>('');
  const [locationReferenceText, setLocationReferenceText] =
    useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Step 7: Attachments
  const [photos, setPhotos] = useState<QueuedPhotoAttachment[]>([]);
  const [documents, setDocuments] = useState<QueuedDocumentAttachment[]>([]);

  // Feedback & Submission State
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { data: benchmarks = [] } = useBenchmarkReferences(campusId || null);

  // Initialise default campus from active selector or first permitted campus
  useEffect(() => {
    if (campusId) return;
    if (activeCampusId && campuses.some((c) => c.id === activeCampusId)) {
      setCampusId(activeCampusId);
    } else if (campuses[0]) {
      setCampusId(campuses[0].id);
    }
  }, [campusId, activeCampusId, campuses]);

  const categoryAssetTypes = useMemo(
    () => allAssetTypes.filter((t) => t.category === category),
    [allAssetTypes, category],
  );

  // Select first asset type when list loads or category changes
  useEffect(() => {
    const first = categoryAssetTypes[0];
    if (!first) return;
    if (
      assetTypeId &&
      categoryAssetTypes.some((t) => t.id === assetTypeId)
    ) {
      return;
    }
    setAssetTypeId(first.id);
    setCustomAttributes({});
  }, [categoryAssetTypes, assetTypeId]);

  const selectedAssetType = useMemo(
    () => allAssetTypes.find((t) => t.id === assetTypeId) ?? null,
    [allAssetTypes, assetTypeId],
  );

  const selectedCampus = useMemo(
    () => campuses.find((c) => c.id === campusId) ?? null,
    [campuses, campusId],
  );

  // Suggest readable unique Asset ID whenever type/campus updates (unless user typed custom ID)
  useEffect(() => {
    if (codeManuallyEdited || !selectedAssetType || !selectedCampus) return;
    const suggested = generateSuggestedAssetCode(
      selectedAssetType.defaultCodePrefix,
      selectedCampus.code,
    );
    setAssetCode(suggested);
    if (selectedAssetType.category === 'survey_reference') {
      setBmReferenceCode(suggested);
    }
  }, [selectedAssetType, selectedCampus, codeManuallyEdited]);

  const handleCaptureGps = async () => {
    setFormError(null);
    setGpsStatusMsg(null);
    setIsCapturingGps(true);
    try {
      const fix = await captureSingleGpsPosition();
      setLatText(String(fix.latitude));
      setLngText(String(fix.longitude));
      setHorizontalAccuracyText(String(fix.horizontalAccuracyM));
      setVerticalAccuracyText(
        fix.verticalAccuracyM !== null ? String(fix.verticalAccuracyM) : '',
      );
      setPositionSource(fix.positionSource);
      setCaptureMethod('gps_point');
      setFixQuality(fix.fixQuality);
      setSourceCrs(fix.sourceCrs);
      setMeasuredAt(fix.measuredAt);
      setHadLiveGpsCapture(true);
      setIsManuallyAdjusted(false);
      setGpsStatusMsg(
        `Captured GPS position (±${fix.horizontalAccuracyM} m horizontal accuracy). Adjust coordinates below if needed.`,
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Unable to capture GPS coordinates.',
      );
    } finally {
      setIsCapturingGps(false);
    }
  };

  const handleManualCoordinateChange = (
    axis: 'lat' | 'lng',
    value: string,
  ) => {
    if (axis === 'lat') setLatText(value);
    else setLngText(value);

    if (hadLiveGpsCapture) {
      setIsManuallyAdjusted(true);
    } else {
      setPositionSource('manual_map');
      setCaptureMethod('coordinate_entry');
    }
  };

  const handleNudgeCoordinates = (deltaLatM: number, deltaLngM: number) => {
    const baseLat = parseOptionalNumber(latText) ?? selectedCampus?.center?.lat;
    const baseLng = parseOptionalNumber(lngText) ?? selectedCampus?.center?.lng;
    if (
      baseLat === undefined ||
      baseLng === undefined ||
      Number.isNaN(baseLat) ||
      Number.isNaN(baseLng)
    ) {
      setFormError(
        'Capture GPS or enter initial coordinates before nudging position.',
      );
      return;
    }
    const dLat = deltaLatM / 111_320;
    const cosLat = Math.max(0.01, Math.cos((baseLat * Math.PI) / 180));
    const dLng = deltaLngM / (111_320 * cosLat);
    setLatText((baseLat + dLat).toFixed(7));
    setLngText((baseLng + dLng).toFixed(7));
    setIsManuallyAdjusted(true);
    if (!hadLiveGpsCapture) {
      setPositionSource('manual_map');
      setCaptureMethod('manual_pin');
    }
  };

  const handleUseCampusCentre = () => {
    if (!selectedCampus?.center) return;
    setLatText(selectedCampus.center.lat.toFixed(6));
    setLngText(selectedCampus.center.lng.toFixed(6));
    setPositionSource('manual_map');
    setCaptureMethod('manual_pin');
    setIsManuallyAdjusted(true);
    setGpsStatusMsg(
      `Placed pin at ${selectedCampus.name} centre — fine-adjust coordinates to the asset location.`,
    );
  };

  const handleAddPhotos = (fileList: FileList | null) => {
    if (!fileList) return;
    setFormError(null);
    const additions: QueuedPhotoAttachment[] = [];
    try {
      for (const file of Array.from(fileList)) {
        validatePhotoFile(file);
        additions.push({
          localKey: crypto.randomUUID(),
          file,
          photoKind:
            category === 'underground'
              ? 'exposed_trench'
              : category === 'survey_reference'
                ? 'benchmark_monument'
                : 'overview',
          caption: '',
        });
      }
      setPhotos((prev) => [...prev, ...additions]);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Invalid photo selection.',
      );
    }
  };

  const handleAddDocuments = (fileList: FileList | null) => {
    if (!fileList) return;
    setFormError(null);
    const additions: QueuedDocumentAttachment[] = [];
    try {
      for (const file of Array.from(fileList)) {
        validateDocumentFile(file);
        const defaultTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
        additions.push({
          localKey: crypto.randomUUID(),
          file,
          documentKind:
            selectedAssetType?.code === 'BOREHOLE'
              ? 'borehole_log'
              : 'technical_report',
          title: defaultTitle || file.name,
        });
      }
      setDocuments((prev) => [...prev, ...additions]);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Invalid document selection.',
      );
    }
  };

  const submitAsset = async (submissionMode: 'draft' | 'submitted') => {
    setFormError(null);

    const parsedLat = parseOptionalNumber(latText);
    const parsedLng = parseOptionalNumber(lngText);
    if (
      parsedLat === null ||
      parsedLng === null ||
      Number.isNaN(parsedLat) ||
      Number.isNaN(parsedLng)
    ) {
      setFormError(
        'Valid WGS84 latitude and longitude coordinates are required. Capture GPS or enter coordinates manually.',
      );
      return;
    }

    const typedCustomAttributes: Record<string, CustomAttributeValue> = {};
    if (selectedAssetType) {
      for (const field of selectedAssetType.fieldSchema) {
        const raw = customAttributes[field.key];
        if (raw === undefined || raw.trim() === '') continue;
        typedCustomAttributes[field.key] =
          field.type === 'number' ? Number(raw) : raw.trim();
      }
    }

    const hAcc = parseOptionalNumber(horizontalAccuracyText);
    const vAcc = parseOptionalNumber(verticalAccuracyText);
    const depthM = parseOptionalNumber(recordedDepthText);
    const diameterMm = parseOptionalNumber(diameterText);
    const bmElev = parseOptionalNumber(bmElevationText);

    setIsSaving(true);
    try {
      const capturedAt = new Date().toISOString();
      const created = await createAsset.mutateAsync({
        campusId,
        departmentId: departmentId || null,
        assetTypeId,
        assetCode: assetCode.trim().toUpperCase(),
        name,
        category,
        description: description || null,
        latitude: parsedLat,
        longitude: parsedLng,
        installationDate: installationDate || null,
        operationalStatus,
        physicalCondition,
        submissionMode,
        isCriticalHazard,

        material: category === 'underground' ? material || null : null,
        diameterMm: category === 'underground' ? diameterMm : null,
        cableSpecification:
          category === 'underground' ? cableSpecification || null : null,
        recordedDepthM: category === 'underground' ? depthM : null,
        depthIsVariable,
        depthMeasurementMethod:
          category === 'underground' && depthMethod ? depthMethod : null,
        documentedBeforeCovering:
          category === 'underground' ? documentedBeforeCovering : false,
        directionDescription:
          category === 'underground' ? directionDescription || null : null,
        constructionRecordRef:
          category === 'underground' ? constructionRecordRef || null : null,

        customAttributes: typedCustomAttributes,
        referenceBenchmarkId: referenceBenchmarkId || null,
        locationReferenceText: locationReferenceText || null,
        notes: notes || null,

        positionSource,
        captureMethod,
        receiverModel: receiverModel || null,
        horizontalAccuracyM: hAcc,
        verticalAccuracyM: vAcc,
        fixQuality,
        correctionSource: correctionSource || null,
        sourceCrs:
          category === 'survey_reference' ? bmHorizontalCrs : sourceCrs,
        measuredAt,
        isManuallyAdjusted,
        capturedAt,
        saveOffline: !isOnline,

        benchmark:
          category === 'survey_reference'
            ? {
                referenceCode: (bmReferenceCode || assetCode)
                  .trim()
                  .toUpperCase(),
                monumentType: bmMonumentType,
                elevationM: bmElev,
                verticalDatum: bmVerticalDatum,
                horizontalCrs: bmHorizontalCrs,
                surveyMethod: bmSurveyMethod,
                horizontalAccuracyM: hAcc,
                verticalAccuracyM: vAcc,
                surveyDate: bmSurveyDate || null,
                surveyorName: bmSurveyorName || null,
              }
            : null,
      });

      // Upload attached photographs (compressed client-side)
      for (const photo of photos) {
        await uploadPhoto.mutateAsync({
          assetId: created.id,
          file: photo.file,
          photoKind: photo.photoKind,
          caption: photo.caption,
          capturedAt,
          saveOffline: !isOnline,
        });
      }

      // Upload attached technical documents
      for (const doc of documents) {
        await uploadDocument.mutateAsync({
          assetId: created.id,
          file: doc.file,
          documentKind: doc.documentKind,
          title: doc.title,
        });
      }

      navigate(`/assets/${created.id}`);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'issues' in error &&
        Array.isArray((error as { issues: { message?: string }[] }).issues)
      ) {
        const firstIssue = (error as { issues: { message?: string }[] })
          .issues[0];
        setFormError(firstIssue?.message ?? 'Please check the highlighted inputs.');
      } else {
        setFormError(
          error instanceof Error ? error.message : 'Unable to register asset.',
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitAsset('submitted');
  };

  const categoryCards: {
    value: AssetCategory;
    title: string;
    subtitle: string;
    icon: typeof Building2;
    permitted: boolean;
  }[] = [
    {
      value: 'surface',
      title: 'Surface Asset',
      subtitle: 'Boreholes, tanks, transformers, valves, buildings, manholes.',
      icon: Building2,
      permitted: true,
    },
    {
      value: 'underground',
      title: 'Underground Asset',
      subtitle: 'Buried water pipes, electrical cables, fibre, drainage, chambers.',
      icon: Layers,
      permitted: true,
    },
    {
      value: 'survey_reference',
      title: 'Survey Benchmark',
      subtitle: 'Control monuments, permanent benchmarks, GNSS stations.',
      icon: Crosshair,
      permitted: canManageBenchmarks,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/assets"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-bado-navy-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Asset Register
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Log New Infrastructure Asset
          </h1>
          <p className="text-sm text-slate-600">
            Document before covering. Newly submitted records stay unverified until
            reviewed by an authorised Supervisor.
          </p>
        </div>
        {!isOnline && (
          <Badge tone="warning">
            <CloudOff className="h-3.5 w-3.5" />
            Offline Capture Active
          </Badge>
        )}
      </div>

      {!isOnline && (
        <Alert tone="warning" title="Offline Mode — Local IndexedDB Queue Active">
          Your asset record, GPS metadata, original field capture timestamp, and
          compressed photographs will be saved safely on this device and queued for
          idempotent synchronisation.
        </Alert>
      )}

      {formError && (
        <Alert tone="danger" title="Registration validation error">
          {formError}
        </Alert>
      )}

      <form onSubmit={handleFormSubmit} noValidate className="space-y-5">
        {/* 1. Campus, Category & Asset Type */}
        <Card
          title="1. Campus & Asset Classification"
          description="Select the campus, principal asset category, and specific infrastructure type."
          bodyClassName="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Campus"
              required
              value={campusId}
              onChange={(e) => setCampusId(e.target.value)}
              options={campuses.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
            <Select
              label="Responsible Department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              options={[
                { value: '', label: 'Select department (optional)' },
                ...departments.map((d) => ({
                  value: d.id,
                  label: `${d.name} (${d.code})`,
                })),
              ]}
            />
          </div>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-slate-800">
              Asset Category <span className="text-red-600">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {categoryCards.map((card) => {
                const Icon = card.icon;
                const selected = category === card.value;
                return (
                  <button
                    key={card.value}
                    type="button"
                    disabled={!card.permitted}
                    aria-pressed={selected}
                    onClick={() => {
                      setCategory(card.value);
                      setCodeManuallyEdited(false);
                    }}
                    className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-bado-navy-800 bg-bado-navy-50/70 ring-1 ring-bado-navy-800'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <Icon
                        className="h-5 w-5 text-bado-navy-800"
                        aria-hidden="true"
                      />
                      {!card.permitted && (
                        <Badge tone="neutral">Surveyor / Admin</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {card.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {card.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-7">
              <Select
                label="Asset Type"
                required
                value={assetTypeId}
                onChange={(e) => {
                  setAssetTypeId(e.target.value);
                  setCustomAttributes({});
                  setCodeManuallyEdited(false);
                }}
                options={categoryAssetTypes.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            </div>

            {selectedAssetType && (
              <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:col-span-5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: selectedAssetType.colorHex }}
                >
                  <LegendIcon
                    iconKey={selectedAssetType.iconKey}
                    className="h-4 w-4"
                  />
                </span>
                <p className="text-xs leading-snug text-slate-600">
                  {selectedAssetType.description}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* 2. Core Asset Identification */}
        <Card
          title="2. Asset Identification & Condition"
          description="Unique institutional Asset ID, descriptive name, operational state, and physical condition."
          bodyClassName="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <Input
                label="Unique Asset ID"
                required
                value={assetCode}
                onChange={(e) => {
                  setCodeManuallyEdited(true);
                  setAssetCode(e.target.value.toUpperCase());
                }}
                placeholder="e.g. BH-MAIN-002"
                hint="Unique within this institution."
              />
            </div>
            <div className="sm:col-span-8">
              <Input
                label="Asset Name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. School of Engineering Borehole No. 2"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Operational Status"
              value={operationalStatus}
              onChange={(e) =>
                setOperationalStatus(e.target.value as OperationalStatus)
              }
              options={OPERATIONAL_STATUSES.map((s) => ({
                value: s,
                label: OPERATIONAL_STATUS_LABELS[s],
              }))}
            />
            <Select
              label="Physical Condition"
              value={physicalCondition}
              onChange={(e) =>
                setPhysicalCondition(e.target.value as PhysicalCondition)
              }
              options={PHYSICAL_CONDITIONS.map((c) => ({
                value: c,
                label: PHYSICAL_CONDITION_LABELS[c],
              }))}
            />
            <Input
              label="Installation Date (if known)"
              type="date"
              value={installationDate}
              onChange={(e) => setInstallationDate(e.target.value)}
            />
          </div>

          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the facility, visible markers, connected structures, or trench context…"
          />

          {category !== 'survey_reference' && (
            <label className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm">
              <input
                type="checkbox"
                checked={isCriticalHazard}
                onChange={(e) => setIsCriticalHazard(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <strong className="block font-medium text-red-950">
                  Flag as Critical Hazard Infrastructure
                </strong>
                <span className="text-xs text-red-900/80">
                  Highlights high-voltage feeders, pressurised gas lines, or critical
                  safety hazards in red on the campus register and map.
                </span>
              </span>
            </label>
          )}
        </Card>

        {/* 3. Dynamic Asset-Type Fields (Borehole vs Transformer vs Pipeline etc.) */}
        {selectedAssetType && selectedAssetType.fieldSchema.length > 0 && (
          <Card
            title={`3. ${selectedAssetType.name} Technical Specifications`}
            description={`Fields tailored specifically to ${selectedAssetType.name} records.`}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {selectedAssetType.fieldSchema.map((field) => (
                <DynamicAttributeField
                  key={field.key}
                  field={field}
                  value={customAttributes[field.key] ?? ''}
                  onChange={(val) =>
                    setCustomAttributes((prev) => ({
                      ...prev,
                      [field.key]: val,
                    }))
                  }
                />
              ))}
            </div>
          </Card>
        )}

        {/* 3B. Underground Asset Section */}
        {category === 'underground' && (
          <Card
            title="Underground Utility & Burial Depth Details"
            description="Record pipe/cable material, dimensions, and measured burial depth. Never infer burial depth from GPS altitude."
            bodyClassName="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Pipe / Duct / Cable Material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g. HDPE PE100, uPVC, XLPE Copper"
              />
              <Input
                label="Diameter (mm)"
                type="number"
                step="any"
                min="1"
                value={diameterText}
                onChange={(e) => setDiameterText(e.target.value)}
                placeholder="e.g. 110"
              />
              <Input
                label="Cable / Conduit Specification"
                value={cableSpecification}
                onChange={(e) => setCableSpecification(e.target.value)}
                placeholder="e.g. 3c × 95 mm² 11kV SWA"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Measured Burial Depth (m)"
                type="number"
                step="0.01"
                min="0"
                value={recordedDepthText}
                onChange={(e) => setRecordedDepthText(e.target.value)}
                placeholder="e.g. 1.20"
                hint="Measured from ground surface to top of pipe/cable."
              />
              <Select
                label="Depth Measurement / Source Method"
                required={Boolean(recordedDepthText.trim())}
                value={depthMethod}
                onChange={(e) =>
                  setDepthMethod(
                    e.target.value as DepthMeasurementMethod | '',
                  )
                }
                options={[
                  { value: '', label: 'Select measurement source…' },
                  ...DEPTH_MEASUREMENT_METHODS.map((m) => ({
                    value: m,
                    label: DEPTH_METHOD_LABELS[m],
                  })),
                ]}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Route Direction Description"
                value={directionDescription}
                onChange={(e) => setDirectionDescription(e.target.value)}
                placeholder="e.g. Runs east from BH-01 toward Hostel Tank"
              />
              <Input
                label="Construction / As-Built Record Reference"
                value={constructionRecordRef}
                onChange={(e) => setConstructionRecordRef(e.target.value)}
                placeholder="e.g. WORKS/2026/TRENCH-14"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={documentedBeforeCovering}
                  onChange={(e) =>
                    setDocumentedBeforeCovering(e.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <strong className="block font-medium text-slate-900">
                    Documented in Open Trench Before Covering
                  </strong>
                  <span className="text-xs text-slate-600">
                    Observed directly before backfilling. Attach an open-trench photo
                    below.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={depthIsVariable}
                  onChange={(e) => setDepthIsVariable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <strong className="block font-medium text-slate-900">
                    Depth May Vary Along Utility Alignment
                  </strong>
                  <span className="text-xs text-slate-600">
                    Keep checked unless uniform depth is formally surveyed end-to-end.
                  </span>
                </span>
              </label>
            </div>
          </Card>
        )}

        {/* 3C. Survey Benchmark Registration Section (Section 7C) */}
        {category === 'survey_reference' && (
          <Card
            title="Survey Benchmark & Geodetic Control Details"
            description="Permanent mapping and elevation reference record. Independently searchable across the institutional register."
            bodyClassName="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Unique Benchmark Reference ID"
                required
                value={bmReferenceCode}
                onChange={(e) =>
                  setBmReferenceCode(e.target.value.toUpperCase())
                }
                placeholder="e.g. BM-MAIN-004"
              />
              <Select
                label="Monument Type"
                required
                value={bmMonumentType}
                onChange={(e) => setBmMonumentType(e.target.value)}
                options={MONUMENT_TYPE_OPTIONS.map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Elevation (m)"
                type="number"
                step="0.0001"
                value={bmElevationText}
                onChange={(e) => setBmElevationText(e.target.value)}
                placeholder="e.g. 362.4150"
              />
              <Select
                label="Vertical Datum"
                required
                value={bmVerticalDatum}
                onChange={(e) => setBmVerticalDatum(e.target.value)}
                options={VERTICAL_DATUM_OPTIONS.map((d) => ({
                  value: d,
                  label: d,
                }))}
              />
              <Select
                label="Horizontal CRS"
                required
                value={bmHorizontalCrs}
                onChange={(e) => setBmHorizontalCrs(e.target.value)}
                options={HORIZONTAL_CRS_OPTIONS.map((c) => ({
                  value: c.value,
                  label: c.label,
                }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Survey Method"
                required
                value={bmSurveyMethod}
                onChange={(e) => setBmSurveyMethod(e.target.value)}
                options={SURVEY_METHOD_OPTIONS.map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
              <Input
                label="Survey Date"
                type="date"
                value={bmSurveyDate}
                onChange={(e) => setBmSurveyDate(e.target.value)}
              />
              <Input
                label="Surveyor Name"
                value={bmSurveyorName}
                onChange={(e) => setBmSurveyorName(e.target.value)}
                placeholder="Licensed / campus surveyor name"
              />
            </div>
          </Card>
        )}

        {/* 4. GPS Position Capture & GNSS Readiness */}
        <Card
          title="4. Geographical Position & GNSS Metadata"
          description="Capture current GPS coordinates or place/adjust WGS84 (EPSG:4326) coordinates. Smartphone GPS is not assumed to be survey-grade."
          bodyClassName="space-y-4"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="primary"
              isLoading={isCapturingGps}
              leftIcon={<LocateFixed className="h-4 w-4" />}
              onClick={() => void handleCaptureGps()}
            >
              Capture Current GPS
            </Button>

            {selectedCampus?.center && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUseCampusCentre}
              >
                Start from Campus Centre
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedGnss((v) => !v)}
            >
              {showAdvancedGnss
                ? 'Hide GNSS Receiver Metadata'
                : 'External GNSS / Survey Metadata'}
            </Button>
          </div>

          {gpsStatusMsg && <Alert tone="info">{gpsStatusMsg}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Latitude (° WGS84)"
              required
              inputMode="decimal"
              value={latText}
              onChange={(e) =>
                handleManualCoordinateChange('lat', e.target.value)
              }
              placeholder="e.g. 7.304250"
            />
            <Input
              label="Longitude (° WGS84)"
              required
              inputMode="decimal"
              value={lngText}
              onChange={(e) =>
                handleManualCoordinateChange('lng', e.target.value)
              }
              placeholder="e.g. 5.138520"
            />
            <Input
              label="Horizontal Accuracy (±m)"
              inputMode="decimal"
              value={horizontalAccuracyText}
              onChange={(e) => setHorizontalAccuracyText(e.target.value)}
              placeholder="e.g. 4.5"
            />
            <Input
              label="Vertical Accuracy (±m)"
              inputMode="decimal"
              value={verticalAccuracyText}
              onChange={(e) => setVerticalAccuracyText(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Fine Position Adjustment Bar (marks isManuallyAdjusted = true) */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <Move className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Fine-adjust pin (~2 m step):
              {isManuallyAdjusted && (
                <Badge tone="warning">Manually adjusted</Badge>
              )}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleNudgeCoordinates(2, 0)}
              >
                +2m N
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleNudgeCoordinates(-2, 0)}
              >
                +2m S
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleNudgeCoordinates(0, 2)}
              >
                +2m E
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleNudgeCoordinates(0, -2)}
              >
                +2m W
              </Button>
            </div>
          </div>

          {(showAdvancedGnss || category === 'survey_reference') && (
            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Position Source"
                value={positionSource}
                onChange={(e) =>
                  setPositionSource(e.target.value as PositionSource)
                }
                options={POSITION_SOURCES.map((p) => ({
                  value: p,
                  label: POSITION_SOURCE_LABELS[p],
                }))}
              />
              <Select
                label="GNSS Fix Quality"
                value={fixQuality}
                onChange={(e) => setFixQuality(e.target.value as GnssFixQuality)}
                options={GNSS_FIX_QUALITIES.map((q) => ({
                  value: q,
                  label: GNSS_FIX_LABELS[q],
                }))}
              />
              <Input
                label="Receiver Model"
                value={receiverModel}
                onChange={(e) => setReceiverModel(e.target.value)}
                placeholder="e.g. Trimble R12i / Emlid RS2+"
              />
              <Input
                label="Correction Source"
                value={correctionSource}
                onChange={(e) => setCorrectionSource(e.target.value)}
                placeholder="e.g. NTRIP CORS, Local RTK Base"
              />
            </div>
          )}
        </Card>

        {/* 5. Benchmark Reference & Field Notes */}
        <Card
          title="5. Location Reference & Field Notes"
          description="Tie the asset to a nearby survey benchmark or permanent campus landmark."
          bodyClassName="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {category !== 'survey_reference' && (
              <Select
                label="Associated Survey Benchmark"
                value={referenceBenchmarkId}
                onChange={(e) => setReferenceBenchmarkId(e.target.value)}
                options={[
                  { value: '', label: 'None linked (optional)' },
                  ...benchmarks.map((bm) => ({
                    value: bm.assetId,
                    label: `${bm.referenceCode} — ${bm.name}`,
                  })),
                ]}
              />
            )}
            <Input
              label="Physical Location Reference"
              value={locationReferenceText}
              onChange={(e) => setLocationReferenceText(e.target.value)}
              placeholder="e.g. 4.5 m north of Engineering Block B walkway kerb"
            />
          </div>
          <Textarea
            label="Field Technician / Surveyor Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Record trench observations, nearby utilities seen, access remarks, or re-survey notes…"
          />
        </Card>

        {/* 6. Photographs & Technical Documents */}
        <Card
          title="6. Photographs & Supporting Documents"
          description="Photographs are validated and automatically compressed for mobile networks and offline storage."
          bodyClassName="space-y-5"
        >
          {/* Photos */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">
                Field Photographs ({photos.length})
              </p>
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                <Camera className="h-4 w-4 text-bado-navy-800" aria-hidden="true" />
                <span>Add Photographs</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    handleAddPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {photos.length > 0 && (
              <div className="space-y-2.5">
                {photos.map((photo, idx) => (
                  <div
                    key={photo.localKey}
                    className="grid gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12 sm:items-center"
                  >
                    <div className="min-w-0 sm:col-span-4">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {photo.file.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {formatFileSize(photo.file.size)}
                      </p>
                    </div>
                    <div className="sm:col-span-3">
                      <Select
                        hideLabel
                        label={`Photo category for ${photo.file.name}`}
                        value={photo.photoKind}
                        onChange={(e) => {
                          const next = [...photos];
                          next[idx] = {
                            ...photo,
                            photoKind: e.target.value as PhotoKind,
                          };
                          setPhotos(next);
                        }}
                        options={PHOTO_KINDS.map((k) => ({
                          value: k,
                          label: PHOTO_KIND_LABELS[k],
                        }))}
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        aria-label={`Caption for ${photo.file.name}`}
                        value={photo.caption}
                        onChange={(e) => {
                          const next = [...photos];
                          next[idx] = { ...photo, caption: e.target.value };
                          setPhotos(next);
                        }}
                        placeholder="Photo description / orientation"
                        className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                      />
                    </div>
                    <div className="flex justify-end sm:col-span-1">
                      <button
                        type="button"
                        aria-label={`Remove ${photo.file.name}`}
                        onClick={() =>
                          setPhotos((prev) =>
                            prev.filter((p) => p.localKey !== photo.localKey),
                          )
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Technical Documents ({documents.length})
                </p>
                <p className="text-xs text-slate-500">
                  Accepted: PDF, CSV, GeoJSON, JSON, TXT (max 15 MB each).
                </p>
              </div>
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                <FileText
                  className="h-4 w-4 text-bado-navy-800"
                  aria-hidden="true"
                />
                <span>Attach Document</span>
                <input
                  type="file"
                  accept=".pdf,.csv,.geojson,.json,.txt,application/pdf,text/csv,application/geo+json,application/json,text/plain"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    handleAddDocuments(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {documents.length > 0 && (
              <div className="space-y-2.5">
                {documents.map((doc, idx) => (
                  <div
                    key={doc.localKey}
                    className="grid gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12 sm:items-center"
                  >
                    <div className="min-w-0 sm:col-span-4">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {doc.file.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {formatFileSize(doc.file.size)}
                      </p>
                    </div>
                    <div className="sm:col-span-3">
                      <Select
                        hideLabel
                        label={`Document type for ${doc.file.name}`}
                        value={doc.documentKind}
                        onChange={(e) => {
                          const next = [...documents];
                          next[idx] = {
                            ...doc,
                            documentKind: e.target.value as DocumentKind,
                          };
                          setDocuments(next);
                        }}
                        options={DOCUMENT_KINDS.map((k) => ({
                          value: k,
                          label: DOCUMENT_KIND_LABELS[k],
                        }))}
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        aria-label={`Title for ${doc.file.name}`}
                        value={doc.title}
                        onChange={(e) => {
                          const next = [...documents];
                          next[idx] = { ...doc, title: e.target.value };
                          setDocuments(next);
                        }}
                        placeholder="Document title"
                        className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                      />
                    </div>
                    <div className="flex justify-end sm:col-span-1">
                      <button
                        type="button"
                        aria-label={`Remove ${doc.file.name}`}
                        onClick={() =>
                          setDocuments((prev) =>
                            prev.filter((d) => d.localKey !== doc.localKey),
                          )
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Submit Bar */}
        <div className="flex flex-col-reverse gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            isLoading={isSaving}
            leftIcon={<Save className="h-4 w-4" />}
            onClick={() => void submitAsset('draft')}
          >
            {isOnline ? 'Save as Draft' : 'Save Draft Offline'}
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isSaving}
            leftIcon={<Send className="h-4 w-4" />}
          >
            {isOnline
              ? 'Submit for Verification'
              : 'Save Offline & Queue Submission'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DynamicAttributeField({
  field,
  value,
  onChange,
}: {
  field: DynamicFieldDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === 'select' && field.options) {
    return (
      <Select
        label={field.label}
        required={field.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: `Select ${field.label.toLowerCase()}…` },
          ...field.options.map((opt) => ({ value: opt, label: opt })),
        ]}
      />
    );
  }

  return (
    <Input
      label={field.label}
      required={field.required}
      type={
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : 'text'
      }
      step={field.type === 'number' ? 'any' : undefined}
      min={field.min}
      max={field.max}
      value={value}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
