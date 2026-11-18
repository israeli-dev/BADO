import { describe, expect, it } from 'vitest';
import { buildInstitutionAssetTypes } from '@/lib/assets/defaultAssetTypes';
import {
  createAssetInputSchema,
  reviewVerificationSchema,
  validateDynamicAttributes,
} from '@/lib/assets/validation';
import {
  MAX_DOCUMENT_BYTES,
  MAX_RAW_PHOTO_BYTES,
  preparePhotoForStorage,
  sanitizeStorageFileName,
  validateDocumentFile,
  validatePhotoFile,
} from '@/lib/media/fileValidation';

const VALID_INSTITUTION_ID = '11111111-1111-4111-8111-111111111101';
const VALID_CAMPUS_ID = '22222222-2222-4222-8222-222222222201';
const VALID_TYPE_ID = 'asset-type-test-001';

describe('Asset registry & GNSS validation schemas', () => {
  it('accepts a valid surface asset with survey-grade GNSS metadata', () => {
    const parsed = createAssetInputSchema.parse({
      campusId: VALID_CAMPUS_ID,
      assetTypeId: VALID_TYPE_ID,
      assetCode: 'BH-MAIN-010',
      name: 'Faculty of Sciences Borehole',
      category: 'surface',
      latitude: 7.30425,
      longitude: 5.13852,
      positionSource: 'external_gnss',
      captureMethod: 'gps_point',
      receiverModel: 'Emlid Reach RS2+',
      horizontalAccuracyM: 0.02,
      verticalAccuracyM: 0.04,
      fixQuality: 'rtk_fixed',
      correctionSource: 'NTRIP CORS',
      sourceCrs: 'EPSG:4326',
      isManuallyAdjusted: false,
      submissionMode: 'submitted',
    });

    expect(parsed.fixQuality).toBe('rtk_fixed');
    expect(parsed.horizontalAccuracyM).toBe(0.02);
    expect(parsed.submissionMode).toBe('submitted');
  });

  it('rejects out-of-range WGS84 coordinates', () => {
    expect(() =>
      createAssetInputSchema.parse({
        campusId: VALID_CAMPUS_ID,
        assetTypeId: VALID_TYPE_ID,
        assetCode: 'BH-BAD-01',
        name: 'Invalid Coordinate Asset',
        category: 'surface',
        latitude: 95.5,
        longitude: 5.13,
      }),
    ).toThrow(/Latitude/);

    expect(() =>
      createAssetInputSchema.parse({
        campusId: VALID_CAMPUS_ID,
        assetTypeId: VALID_TYPE_ID,
        assetCode: 'BH-BAD-02',
        name: 'Invalid Longitude Asset',
        category: 'surface',
        latitude: 7.3,
        longitude: -195,
      }),
    ).toThrow(/Longitude/);
  });

  it('requires explicit depth measurement method when underground burial depth is recorded', () => {
    expect(() =>
      createAssetInputSchema.parse({
        campusId: VALID_CAMPUS_ID,
        assetTypeId: VALID_TYPE_ID,
        assetCode: 'WP-MAIN-099',
        name: 'Unattributed Depth Pipe',
        category: 'underground',
        latitude: 7.304,
        longitude: 5.138,
        recordedDepthM: 1.25,
        depthMeasurementMethod: null,
      }),
    ).toThrow(/depth/i);

    const valid = createAssetInputSchema.parse({
      campusId: VALID_CAMPUS_ID,
      assetTypeId: VALID_TYPE_ID,
      assetCode: 'WP-MAIN-100',
      name: 'Measured Trench Water Pipe',
      category: 'underground',
      latitude: 7.304,
      longitude: 5.138,
      recordedDepthM: 1.25,
      depthMeasurementMethod: 'open_trench_tape',
      documentedBeforeCovering: true,
    });
    expect(valid.depthMeasurementMethod).toBe('open_trench_tape');
    expect(valid.depthIsVariable).toBe(true);
  });

  it('requires complete benchmark metadata when category is survey_reference', () => {
    expect(() =>
      createAssetInputSchema.parse({
        campusId: VALID_CAMPUS_ID,
        assetTypeId: VALID_TYPE_ID,
        assetCode: 'BM-MAIN-099',
        name: 'Incomplete Benchmark',
        category: 'survey_reference',
        latitude: 7.305,
        longitude: 5.139,
      }),
    ).toThrow(/benchmark/i);

    const valid = createAssetInputSchema.parse({
      campusId: VALID_CAMPUS_ID,
      assetTypeId: VALID_TYPE_ID,
      assetCode: 'BM-MAIN-100',
      name: 'Senate Quad Benchmark',
      category: 'survey_reference',
      latitude: 7.305,
      longitude: 5.139,
      benchmark: {
        referenceCode: 'BM-MAIN-100',
        monumentType: 'Concrete pillar with brass pin',
        elevationM: 363.215,
        verticalDatum: 'Mean Sea Level (MSL)',
        horizontalCrs: 'EPSG:4326',
        surveyMethod: 'Differential / RTK GNSS',
        horizontalAccuracyM: 0.012,
        verticalAccuracyM: 0.019,
        surveyDate: '2026-10-15',
        surveyorName: 'Surv. Kemi Adewale',
      },
    });

    expect(valid.benchmark?.referenceCode).toBe('BM-MAIN-100');
    expect(valid.benchmark?.elevationM).toBe(363.215);
  });

  it('validates dynamic asset-type attributes, enforces required fields on submit, and strips unknown keys', () => {
    const types = buildInstitutionAssetTypes(
      VALID_INSTITUTION_ID,
      '2026-11-18T00:00:00.000Z',
    );
    const transformerType = types.find((t) => t.code === 'TRANSFORMER')!;

    const cleaned = validateDynamicAttributes(
      transformerType,
      {
        ratingKva: '500',
        voltageRatio: '11kV / 0.415kV',
        coolingType: 'ONAN (Oil-immersed)',
        injected_unknown_key: 'should-be-dropped',
      },
      'submitted',
    );

    expect(cleaned).toEqual({
      ratingKva: 500,
      voltageRatio: '11kV / 0.415kV',
      coolingType: 'ONAN (Oil-immersed)',
    });

    // Drafts may omit required fields while in the field; submitted records enforce them
    expect(() =>
      validateDynamicAttributes(transformerType, {}, 'draft'),
    ).not.toThrow();
    expect(() =>
      validateDynamicAttributes(transformerType, {}, 'submitted'),
    ).toThrow(/Rated Capacity \(kVA\)/);

    // Invalid option rejected
    expect(() =>
      validateDynamicAttributes(
        transformerType,
        {
          ratingKva: 500,
          voltageRatio: '11kV / 0.415kV',
          coolingType: 'Invalid Cooling Option',
        },
        'submitted',
      ),
    ).toThrow(/Cooling Type/);
  });

  it('requires reviewer remarks when rejecting or flagging needs_resurvey', () => {
    expect(() =>
      reviewVerificationSchema.parse({
        assetId: VALID_CAMPUS_ID,
        toStatus: 'rejected',
        remarks: '',
      }),
    ).toThrow(/remarks/i);

    expect(() =>
      reviewVerificationSchema.parse({
        assetId: VALID_CAMPUS_ID,
        toStatus: 'needs_resurvey',
        remarks: 'no',
      }),
    ).toThrow(/remarks/i);

    const ok = reviewVerificationSchema.parse({
      assetId: VALID_CAMPUS_ID,
      toStatus: 'verified',
      remarks: '',
    });
    expect(ok.toStatus).toBe('verified');
  });
});

describe('Photograph & technical document file validation', () => {
  it('accepts valid JPEG/PNG/WebP images and rejects SVG/oversized files', async () => {
    const validJpeg = new File([new Uint8Array(1024)], 'trench photo #1.jpg', {
      type: 'image/jpeg',
    });
    expect(() => validatePhotoFile(validJpeg)).not.toThrow();

    const prepared = await preparePhotoForStorage(validJpeg);
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.fileName).toBe('trench_photo_1.jpg');

    const svgFile = new File(['<svg><script>alert(1)</script></svg>'], 'x.svg', {
      type: 'image/svg+xml',
    });
    expect(() => validatePhotoFile(svgFile)).toThrow(/Unsupported image format/);

    const oversized = {
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: MAX_RAW_PHOTO_BYTES + 1,
    } as File;
    expect(() => validatePhotoFile(oversized)).toThrow(/15 MB/);
  });

  it('accepts PDF, CSV, and GeoJSON documents and rejects HTML/oversized files', () => {
    const pdf = new File(['%PDF-1.4'], 'borehole-log.pdf', {
      type: 'application/pdf',
    });
    expect(validateDocumentFile(pdf).mimeType).toBe('application/pdf');

    // Browsers often submit .geojson with empty MIME type
    const geojson = new File(
      ['{"type":"FeatureCollection","features":[]}'],
      'campus-water-main.geojson',
      { type: '' },
    );
    expect(validateDocumentFile(geojson).mimeType).toBe('application/geo+json');

    const csv = new File(['id,lat,lng\n1,7.3,5.1'], 'survey-points.csv', {
      type: 'text/csv',
    });
    expect(validateDocumentFile(csv).mimeType).toBe('text/csv');

    const html = new File(['<html></html>'], 'evil.html', {
      type: 'text/html',
    });
    expect(() => validateDocumentFile(html)).toThrow(/Unsupported document/);

    const hugePdf = {
      name: 'massive.pdf',
      type: 'application/pdf',
      size: MAX_DOCUMENT_BYTES + 10,
    } as File;
    expect(() => validateDocumentFile(hugePdf)).toThrow(/15 MB/);
  });

  it('sanitises path-traversal characters out of storage filenames', () => {
    const clean = sanitizeStorageFileName('../../etc/passwd.pdf');
    expect(clean).not.toContain('/');
    expect(clean).toContain('passwd.pdf');
  });
});
