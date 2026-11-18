import { beforeEach, describe, expect, it } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { listInstitutionSyncQueue } from '@/lib/sync/syncQueue';

describe('Phase 2 Core Asset Registry, Governance, Isolation & Offline Queue', () => {
  let gateway: LocalDemoDataGateway;

  beforeEach(async () => {
    window.localStorage.clear();
    await badoDb.delete();
    await badoDb.open();
    gateway = new LocalDemoDataGateway();
  });

  it('enforces end-to-end technician registration, blocks self-verification, and logs supervisor approval', async () => {
    // 1. Field Technician registers an exposed underground water pipeline with photo + PDF report
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
    const instId = DEMO_IDS.primaryInstitution;

    const undergroundTypes = await gateway.listAssetTypes(
      instId,
      'underground',
    );
    const waterPipeType = undergroundTypes.find(
      (t) => t.code === 'WATER_PIPELINE',
    )!;

    const created = await gateway.createAsset(instId, {
      campusId: DEMO_IDS.mainCampus,
      departmentId: DEMO_IDS.deptWater,
      assetTypeId: waterPipeType.id,
      assetCode: 'WP-MAIN-205',
      name: 'Lecture Theatre Branch Water Line',
      category: 'underground',
      description: 'New 90 mm HDPE branch documented before trench backfill.',
      latitude: 7.30465,
      longitude: 5.13895,
      operationalStatus: 'operational',
      physicalCondition: 'good',
      submissionMode: 'submitted',
      isCriticalHazard: false,
      material: 'HDPE PE100',
      diameterMm: 90,
      recordedDepthM: 1.35,
      depthIsVariable: true,
      depthMeasurementMethod: 'open_trench_tape',
      documentedBeforeCovering: true,
      referenceBenchmarkId: DEMO_IDS.assetBenchmark1,
      locationReferenceText: '2.8 m south of LT-2 concrete walkway',
      notes: 'Blue warning tape laid at 0.45 m depth.',
      positionSource: 'smartphone_gps',
      captureMethod: 'gps_point',
      horizontalAccuracyM: 4.1,
      verticalAccuracyM: null,
      fixQuality: 'autonomous',
      sourceCrs: 'EPSG:4326',
      isManuallyAdjusted: true,
      customAttributes: {
        serviceType: 'Secondary service line',
        pressureClass: 'PN10',
        warningTapeInstalled: 'Yes',
      },
    });

    // Newly created assets NEVER auto-verify
    expect(created.verificationStatus).toBe('submitted');
    expect(created.dataQuality).toBe('unverified');
    expect(created.isManuallyAdjusted).toBe(true);
    expect(created.recordedDepthM).toBe(1.35);

    // Attach photo & technical document
    const photo = await gateway.uploadAssetPhoto(instId, {
      assetId: created.id,
      file: new File([new Uint8Array(512)], 'open-trench.jpg', {
        type: 'image/jpeg',
      }),
      photoKind: 'exposed_trench',
      caption: 'Exposed HDPE pipe at 1.35 m before backfilling',
    });
    expect(photo.photoKind).toBe('exposed_trench');

    const doc = await gateway.uploadAssetDocument(instId, {
      assetId: created.id,
      file: new File(['%PDF-1.4 sample'], 'pressure-test.pdf', {
        type: 'application/pdf',
      }),
      documentKind: 'technical_report',
      title: 'Hydrostatic Pressure Test Sheet',
    });
    expect(doc.documentKind).toBe('technical_report');

    // Technician CANNOT self-verify or archive
    await expect(
      gateway.reviewAssetVerification(instId, {
        assetId: created.id,
        toStatus: 'verified',
        remarks: 'Self approve attempt',
      }),
    ).rejects.toThrow(/role|authorised|permission/i);

    await expect(
      gateway.archiveAsset(instId, created.id, 'Delete test'),
    ).rejects.toThrow(/Archive|Supervisor|Administrator|permission/i);

    // 2. Surveyor flags Needs Re-survey (allowed), cannot mark Verified
    await gateway.signInAsDemoUser(DEMO_IDS.userSurveyor);

    await expect(
      gateway.reviewAssetVerification(instId, {
        assetId: created.id,
        toStatus: 'verified',
        remarks: 'Surveyor final verify attempt',
      }),
    ).rejects.toThrow(/assets:verify|Supervisor|Administrator/i);

    const flagged = await gateway.reviewAssetVerification(instId, {
      assetId: created.id,
      toStatus: 'needs_resurvey',
      remarks: 'Please verify tie distance to BM-DEMO-001 with tape.',
    });
    expect(flagged.verificationStatus).toBe('needs_resurvey');
    expect(flagged.dataQuality).toBe('needs_resurvey');

    // 3. Supervisor approves asset to Verified
    await gateway.signInAsDemoUser(DEMO_IDS.userSupervisor);

    const verified = await gateway.reviewAssetVerification(instId, {
      assetId: created.id,
      toStatus: 'verified',
      remarks: 'Confirmed trench photo, benchmark offset, and pressure report.',
    });
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.dataQuality).toBe('verified');
    expect(verified.lastVerifiedAt).toBeTruthy();
    expect(verified.version).toBe(3);

    const detail = await gateway.getAssetDetail(instId, created.id);
    expect(detail.photos).toHaveLength(1);
    expect(detail.documents).toHaveLength(1);
    expect(detail.referenceBenchmark?.referenceCode).toBe('BM-DEMO-001');
    expect(detail.verificationHistory.map((h) => h.toStatus)).toEqual([
      'verified',
      'needs_resurvey',
      'submitted',
    ]);

    // 4. Administrator verifies immutable audit log captured creation + verification transitions
    await gateway.signInAsDemoUser(DEMO_IDS.userAdmin);
    const audits = await gateway.listAuditLogs(instId, 40);
    const actionsForAsset = audits
      .filter((a) => a.entityId === created.id)
      .map((a) => a.action);
    expect(actionsForAsset).toContain('insert');
    expect(actionsForAsset).toContain('update');
    expect(actionsForAsset).toContain('approve');
  });

  it('restricts survey benchmark creation to Surveyor/Admin and supports independent benchmark lookup', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
    const instId = DEMO_IDS.primaryInstitution;

    const benchmarkTypes = await gateway.listAssetTypes(
      instId,
      'survey_reference',
    );
    const bmType = benchmarkTypes[0]!;

    await expect(
      gateway.createAsset(instId, {
        campusId: DEMO_IDS.mainCampus,
        assetTypeId: bmType.id,
        assetCode: 'BM-UNAUTH-01',
        name: 'Unauthorised Benchmark',
        category: 'survey_reference',
        latitude: 7.305,
        longitude: 5.139,
        benchmark: {
          referenceCode: 'BM-UNAUTH-01',
          monumentType: 'Concrete pillar with brass pin',
          elevationM: 361.5,
          verticalDatum: 'Mean Sea Level (MSL)',
          horizontalCrs: 'EPSG:4326',
          surveyMethod: 'Differential / RTK GNSS',
        },
      }),
    ).rejects.toThrow(/Surveyor|Administrator|permission/i);

    // Surveyor creates the benchmark successfully
    await gateway.signInAsDemoUser(DEMO_IDS.userSurveyor);
    const createdBm = await gateway.createAsset(instId, {
      campusId: DEMO_IDS.mainCampus,
      assetTypeId: bmType.id,
      assetCode: 'BM-SCI-007',
      name: 'Science Complex Control Monument',
      category: 'survey_reference',
      latitude: 7.30512,
      longitude: 5.13941,
      positionSource: 'external_gnss',
      captureMethod: 'coordinate_entry',
      receiverModel: 'Trimble R12i',
      horizontalAccuracyM: 0.008,
      verticalAccuracyM: 0.014,
      fixQuality: 'rtk_fixed',
      correctionSource: 'Local RTK Base',
      sourceCrs: 'EPSG:4326',
      submissionMode: 'submitted',
      benchmark: {
        referenceCode: 'CTRL-SCI-007',
        monumentType: 'Concrete pillar with brass pin',
        elevationM: 364.882,
        verticalDatum: 'EGM2008 Geoid',
        horizontalCrs: 'EPSG:4326',
        surveyMethod: 'Differential / RTK GNSS',
        horizontalAccuracyM: 0.008,
        verticalAccuracyM: 0.014,
        surveyDate: '2026-11-10',
        surveyorName: 'Surv. Kemi Adewale',
      },
    });

    // Searchable independently by benchmark Reference ID (distinct from assetCode)
    const searchResults = await gateway.listAssets(instId, {
      search: 'CTRL-SCI-007',
    });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.asset.id).toBe(createdBm.id);
    expect(searchResults[0]?.benchmark?.elevationM).toBe(364.882);

    // Appears in selectable benchmark references for field asset registration
    const refs = await gateway.listBenchmarkReferences(
      instId,
      DEMO_IDS.mainCampus,
    );
    expect(refs.some((r) => r.referenceCode === 'CTRL-SCI-007')).toBe(true);
  });

  it('keeps drafts private to author/reviewers and soft-archives without hard deletion', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
    const instId = DEMO_IDS.primaryInstitution;
    const surfaceTypes = await gateway.listAssetTypes(instId, 'surface');
    const boreholeType = surfaceTypes.find((t) => t.code === 'BOREHOLE')!;

    const draft = await gateway.createAsset(instId, {
      campusId: DEMO_IDS.mainCampus,
      assetTypeId: boreholeType.id,
      assetCode: 'BH-DRAFT-009',
      name: 'Unfinished Draft Borehole Entry',
      category: 'surface',
      latitude: 7.3041,
      longitude: 5.1381,
      submissionMode: 'draft',
    });
    expect(draft.verificationStatus).toBe('draft');

    // Read-only user cannot view someone else's unsubmitted draft
    await gateway.signInAsDemoUser(DEMO_IDS.userReadOnly);
    const roList = await gateway.listAssets(instId, { search: 'BH-DRAFT-009' });
    expect(roList).toHaveLength(0);
    await expect(gateway.getAssetDetail(instId, draft.id)).rejects.toThrow(
      /draft|visible|permission|found/i,
    );

    // Technician submits draft -> now visible & reviewable
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
    const submitted = await gateway.submitDraftAsset(instId, draft.id);
    expect(submitted.verificationStatus).toBe('submitted');

    // Supervisor soft-archives duplicate entry
    await gateway.signInAsDemoUser(DEMO_IDS.userSupervisor);
    await gateway.archiveAsset(
      instId,
      draft.id,
      'Duplicate test record — superseded by BH-DEMO-001',
    );

    // Hidden from active asset list
    const afterArchive = await gateway.listAssets(instId, {
      search: 'BH-DRAFT-009',
    });
    expect(afterArchive).toHaveLength(0);

    // Underlying database row is preserved with archivedAt (soft delete, never hard delete)
    const rawRow = await badoDb.assets.get(draft.id);
    expect(rawRow).toBeDefined();
    expect(rawRow?.archivedAt).toBeTruthy();
  });

  it('enforces multi-institution and campus-scoped isolation across asset queries', async () => {
    // Primary admin never sees secondary institution's borehole
    await gateway.signInAsDemoUser(DEMO_IDS.userAdmin);
    const primaryId = DEMO_IDS.primaryInstitution;

    const allPrimaryAssets = await gateway.listAssets(primaryId);
    expect(allPrimaryAssets.length).toBeGreaterThanOrEqual(10);
    expect(
      allPrimaryAssets.every((item) => item.asset.institutionId === primaryId),
    ).toBe(true);
    expect(
      allPrimaryAssets.some(
        (item) => item.asset.id === DEMO_IDS.assetSecondaryBorehole,
      ),
    ).toBe(false);

    await expect(
      gateway.getAssetDetail(primaryId, DEMO_IDS.assetSecondaryBorehole),
    ).rejects.toThrow(/not found|institution|access/i);

    await expect(
      gateway.listAssets(DEMO_IDS.secondaryInstitution),
    ).rejects.toThrow(/Access denied/i);

    // Read-only user restricted solely to Main Campus cannot see Annex Campus assets
    await gateway.signInAsDemoUser(DEMO_IDS.userReadOnly);
    const roAssets = await gateway.listAssets(primaryId);
    expect(roAssets.length).toBeGreaterThan(0);
    expect(
      roAssets.every((item) => item.asset.campusId === DEMO_IDS.mainCampus),
    ).toBe(true);
    expect(
      roAssets.some((item) => item.asset.id === DEMO_IDS.assetBenchmark2),
    ).toBe(false);
    expect(
      roAssets.some((item) => item.asset.id === DEMO_IDS.assetBuilding1),
    ).toBe(false);

    // Restrict Field Technician to Main Campus only and verify cross-campus write is blocked
    await badoDb.userInstitutions.update(
      '55555555-5555-4555-8555-555555555503',
      { allowedCampusIds: [DEMO_IDS.mainCampus] },
    );
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);

    const surfaceTypes = await gateway.listAssetTypes(primaryId, 'surface');
    const boreholeType = surfaceTypes.find((t) => t.code === 'BOREHOLE')!;
    await expect(
      gateway.createAsset(primaryId, {
        campusId: DEMO_IDS.annexCampus,
        assetTypeId: boreholeType.id,
        assetCode: 'BH-ANNEX-HACK',
        name: 'Cross-Campus Attempt',
        category: 'surface',
        latitude: 7.285,
        longitude: 5.162,
      }),
    ).rejects.toThrow(/campus|scope|access|permission/i);
  });

  it('preserves original capturedAt timestamp and queues asset + photo when captured offline', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
    const instId = DEMO_IDS.primaryInstitution;
    const surfaceTypes = await gateway.listAssetTypes(instId, 'surface');
    const boreholeType = surfaceTypes.find((t) => t.code === 'BOREHOLE')!;

    const fieldCapturedAt = '2026-11-18T07:15:00.000Z';
    const offlineAsset = await gateway.createAsset(instId, {
      campusId: DEMO_IDS.mainCampus,
      assetTypeId: boreholeType.id,
      assetCode: 'BH-OFFLINE-01',
      name: 'Offline Captured Field Borehole',
      category: 'surface',
      latitude: 7.3049,
      longitude: 5.1382,
      capturedAt: fieldCapturedAt,
      submissionMode: 'submitted',
      saveOffline: true,
    });

    await gateway.uploadAssetPhoto(instId, {
      assetId: offlineAsset.id,
      file: new File([new Uint8Array(256)], 'offline-wellhead.jpg', {
        type: 'image/jpeg',
      }),
      photoKind: 'overview',
      caption: 'Captured without mobile signal',
      capturedAt: fieldCapturedAt,
      saveOffline: true,
    });

    expect(offlineAsset.capturedAt).toBe(fieldCapturedAt);
    expect(offlineAsset.localSyncStatus).toBe('pending');

    const queue = await listInstitutionSyncQueue(instId);
    expect(queue).toHaveLength(2);
    expect(queue.map((q) => q.recordType).sort()).toEqual([
      'asset_photos',
      'assets',
    ]);
    expect(queue.every((q) => q.capturedAt === fieldCapturedAt)).toBe(true);
    expect(queue.every((q) => q.status === 'pending')).toBe(true);
  });
});
