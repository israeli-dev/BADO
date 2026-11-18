import { z } from 'zod';
import {
  ASSET_CATEGORIES,
  CAPTURE_METHODS,
  DEPTH_MEASUREMENT_METHODS,
  DOCUMENT_KINDS,
  GNSS_FIX_QUALITIES,
  OPERATIONAL_STATUSES,
  PHOTO_KINDS,
  PHYSICAL_CONDITIONS,
  POSITION_SOURCES,
  VERIFICATION_STATUSES,
  type AssetTypeDefinition,
  type CustomAttributeValue,
} from '@/types/domain';

export const surveyBenchmarkInputSchema = z.object({
  referenceCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
      'Benchmark ID must be 2–40 uppercase letters, digits, hyphens, or underscores (e.g. BM-FUTA-001).',
    ),
  monumentType: z
    .string()
    .trim()
    .min(2, 'Monument type is required.')
    .max(100),
  elevationM: z
    .number()
    .min(-500, 'Elevation must be between -500 m and 9,000 m.')
    .max(9000, 'Elevation must be between -500 m and 9,000 m.')
    .nullable()
    .optional(),
  verticalDatum: z
    .string()
    .trim()
    .min(2, 'Vertical datum is required.')
    .max(80),
  horizontalCrs: z
    .string()
    .trim()
    .min(4, 'Coordinate reference system is required.')
    .max(40)
    .default('EPSG:4326'),
  surveyMethod: z
    .string()
    .trim()
    .min(2, 'Survey method is required.')
    .max(100),
  horizontalAccuracyM: z
    .number()
    .min(0, 'Horizontal accuracy cannot be negative.')
    .max(500)
    .nullable()
    .optional(),
  verticalAccuracyM: z
    .number()
    .min(0, 'Vertical accuracy cannot be negative.')
    .max(500)
    .nullable()
    .optional(),
  surveyDate: z.string().trim().nullable().optional(),
  surveyorName: z.string().trim().max(140).nullable().optional(),
});

export type SurveyBenchmarkInput = z.infer<typeof surveyBenchmarkInputSchema>;

export const createAssetInputSchema = z
  .object({
    /** Optional client UUID for idempotent offline retries. */
    id: z.uuid().optional(),
    campusId: z.uuid('Please select a campus.'),
    departmentId: z.uuid().nullable().optional(),
    assetTypeId: z.string().trim().min(1, 'Please select an asset type.'),
    assetCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
        'Asset ID must be 2–40 uppercase letters, numbers, hyphens, or underscores (e.g. BH-MAIN-001).',
      ),
    name: z
      .string()
      .trim()
      .min(2, 'Asset name must be at least 2 characters.')
      .max(160, 'Asset name must be 160 characters or fewer.'),
    category: z.enum(ASSET_CATEGORIES),
    description: z.string().trim().max(2000).nullable().optional(),

    // WGS84 position (Phase 2 point capture; Phase 3 expands to full multi-vertex routes)
    latitude: z
      .number({ error: 'Latitude is required.' })
      .min(-90, 'Latitude must be between -90° and 90°.')
      .max(90, 'Latitude must be between -90° and 90°.'),
    longitude: z
      .number({ error: 'Longitude is required.' })
      .min(-180, 'Longitude must be between -180° and 180°.')
      .max(180, 'Longitude must be between -180° and 180°.'),

    installationDate: z.string().trim().nullable().optional(),
    operationalStatus: z.enum(OPERATIONAL_STATUSES).default('operational'),
    physicalCondition: z.enum(PHYSICAL_CONDITIONS).default('good'),
    /** Newly registered records may only start as 'draft' or 'submitted' — never 'verified'. */
    submissionMode: z.enum(['draft', 'submitted']).default('submitted'),
    isCriticalHazard: z.boolean().default(false),

    // Underground attributes (depth never derived from GPS altitude)
    material: z.string().trim().max(100).nullable().optional(),
    diameterMm: z.number().positive('Diameter must be greater than 0.').max(10000).nullable().optional(),
    cableSpecification: z.string().trim().max(160).nullable().optional(),
    recordedDepthM: z
      .number()
      .min(0, 'Burial depth cannot be negative.')
      .max(100, 'Burial depth must be 100 m or less.')
      .nullable()
      .optional(),
    depthIsVariable: z.boolean().default(true),
    depthMeasurementMethod: z.enum(DEPTH_MEASUREMENT_METHODS).nullable().optional(),
    documentedBeforeCovering: z.boolean().default(false),
    directionDescription: z.string().trim().max(240).nullable().optional(),
    constructionRecordRef: z.string().trim().max(160).nullable().optional(),

    // Dynamic type-specific attributes
    customAttributes: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .default({}),

    // Benchmark & location references
    referenceBenchmarkId: z.uuid().nullable().optional(),
    locationReferenceText: z.string().trim().max(300).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),

    // GNSS positioning metadata
    positionSource: z.enum(POSITION_SOURCES).default('smartphone_gps'),
    captureMethod: z.enum(CAPTURE_METHODS).default('gps_point'),
    receiverModel: z.string().trim().max(120).nullable().optional(),
    horizontalAccuracyM: z.number().min(0).max(5000).nullable().optional(),
    verticalAccuracyM: z.number().min(0).max(5000).nullable().optional(),
    fixQuality: z.enum(GNSS_FIX_QUALITIES).default('unknown'),
    correctionSource: z.string().trim().max(120).nullable().optional(),
    sourceCrs: z.string().trim().min(4).max(40).default('EPSG:4326'),
    measuredAt: z.string().trim().optional(),
    isManuallyAdjusted: z.boolean().default(false),
    capturedAt: z.string().trim().optional(),

    // Required when category === 'survey_reference'
    benchmark: surveyBenchmarkInputSchema.nullable().optional(),

    /** Explicitly persist to local IndexedDB syncQueue (used when offline or requested). */
    saveOffline: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === 'survey_reference' && !data.benchmark) {
      ctx.addIssue({
        code: 'custom',
        path: ['benchmark'],
        message:
          'Survey & reference features require benchmark metadata (reference code, monument type, datum, and survey method).',
      });
    }
    if (
      data.recordedDepthM !== null &&
      data.recordedDepthM !== undefined &&
      !data.depthMeasurementMethod
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['depthMeasurementMethod'],
        message:
          'Specify how burial depth was measured or documented (never infer from GPS elevation).',
      });
    }
  });

export type CreateAssetInput = z.input<typeof createAssetInputSchema>;

/**
 * Validates and cleans dynamic type-specific attributes against an AssetTypeDefinition's
 * `fieldSchema`. Throws a descriptive Error if any required or bounded field is invalid.
 */
export function validateDynamicAttributes(
  assetType: AssetTypeDefinition,
  raw: Record<string, CustomAttributeValue>,
  submissionMode: 'draft' | 'submitted',
): Record<string, CustomAttributeValue> {
  const cleaned: Record<string, CustomAttributeValue> = {};

  for (const field of assetType.fieldSchema) {
    const value = raw[field.key];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (isEmpty) {
      // Allow saving incomplete field drafts, but enforce required attributes on submission
      if (field.required && submissionMode === 'submitted') {
        throw new Error(
          `Field "${field.label}" is required when submitting a ${assetType.name} record.`,
        );
      }
      continue;
    }

    if (field.type === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numeric)) {
        throw new Error(`Field "${field.label}" must be a valid number.`);
      }
      if (field.min !== undefined && numeric < field.min) {
        throw new Error(
          `Field "${field.label}" must be at least ${field.min}${field.unit ? ` ${field.unit}` : ''}.`,
        );
      }
      if (field.max !== undefined && numeric > field.max) {
        throw new Error(
          `Field "${field.label}" must be at most ${field.max}${field.unit ? ` ${field.unit}` : ''}.`,
        );
      }
      cleaned[field.key] = numeric;
    } else if (field.type === 'select') {
      const text = String(value).trim();
      if (field.options && field.options.length > 0 && !field.options.includes(text)) {
        throw new Error(
          `Invalid option "${text}" for "${field.label}".`,
        );
      }
      cleaned[field.key] = text;
    } else if (field.type === 'boolean') {
      cleaned[field.key] = Boolean(value);
    } else {
      const text = String(value).trim();
      if (text.length > 300) {
        throw new Error(
          `Field "${field.label}" must be 300 characters or fewer.`,
        );
      }
      cleaned[field.key] = text;
    }
  }

  return cleaned;
}

export const reviewVerificationSchema = z
  .object({
    assetId: z.uuid(),
    toStatus: z.enum(VERIFICATION_STATUSES),
    remarks: z.string().trim().max(1000).default(''),
  })
  .superRefine((val, ctx) => {
    if (
      (val.toStatus === 'rejected' || val.toStatus === 'needs_resurvey') &&
      val.remarks.length < 4
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['remarks'],
        message:
          'Provide clear remarks (at least 4 characters) explaining why the record is rejected or requires re-survey.',
      });
    }
  });

export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;

export const uploadAssetPhotoMetaSchema = z.object({
  assetId: z.uuid(),
  photoKind: z.enum(PHOTO_KINDS).default('overview'),
  caption: z.string().trim().max(500).optional(),
  capturedAt: z.string().trim().optional(),
});

export const uploadAssetDocumentMetaSchema = z.object({
  assetId: z.uuid(),
  documentKind: z.enum(DOCUMENT_KINDS).default('technical_report'),
  title: z
    .string()
    .trim()
    .min(2, 'Document title must be at least 2 characters.')
    .max(160, 'Document title must be 160 characters or fewer.'),
  description: z.string().trim().max(500).optional(),
});
