import Dexie, { type EntityTable } from 'dexie';
import type {
  AssetDocumentRecord,
  AssetObservationRecord,
  AssetPhotoRecord,
  AssetRecord,
  AssetTypeDefinition,
  AssetVerificationEvent,
  AuditLogEntry,
  CacheMetaRecord,
  Campus,
  Department,
  Institution,
  InstitutionSettings,
  LocalMediaBlobRecord,
  SurveyBenchmarkRecord,
  SyncQueueRecord,
  UserInstitutionMembership,
  UserProfile,
  UtilityDepthObservationRecord,
  UtilityJunctionRecord,
  UtilityRouteVertexRecord,
} from '@/types/domain';

/**
 * BADO Offline-First Local Database (IndexedDB via Dexie.js).
 *
 * v1: Institutional hierarchy, settings, RBAC memberships, audit logs, syncQueue, cacheMeta.
 * v2 (Phase 2): Configurable asset types, core assets, survey benchmarks, field observations,
 *               verification history, asset photos & documents metadata, and isolated binary
 *               media blobs (`localMediaBlobs`) for offline photo/document storage.
 */
export class BadoLocalDatabase extends Dexie {
  institutions!: EntityTable<Institution, 'id'>;
  institutionSettings!: EntityTable<InstitutionSettings, 'institutionId'>;
  campuses!: EntityTable<Campus, 'id'>;
  departments!: EntityTable<Department, 'id'>;
  profiles!: EntityTable<UserProfile, 'id'>;
  userInstitutions!: EntityTable<UserInstitutionMembership, 'id'>;
  auditLogs!: EntityTable<AuditLogEntry, 'id'>;
  syncQueue!: EntityTable<SyncQueueRecord, 'id'>;
  cacheMeta!: EntityTable<CacheMetaRecord, 'key'>;

  // Phase 2 stores
  assetTypes!: EntityTable<AssetTypeDefinition, 'id'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  surveyBenchmarks!: EntityTable<SurveyBenchmarkRecord, 'assetId'>;
  assetObservations!: EntityTable<AssetObservationRecord, 'id'>;
  verificationHistory!: EntityTable<AssetVerificationEvent, 'id'>;
  assetPhotos!: EntityTable<AssetPhotoRecord, 'id'>;
  assetDocuments!: EntityTable<AssetDocumentRecord, 'id'>;
  localMediaBlobs!: EntityTable<LocalMediaBlobRecord, 'id'>;

  // Phase 3 stores (Linear infrastructure vertices, depth observations & junctions)
  routeVertices!: EntityTable<UtilityRouteVertexRecord, 'id'>;
  depthObservations!: EntityTable<UtilityDepthObservationRecord, 'id'>;
  utilityJunctions!: EntityTable<UtilityJunctionRecord, 'id'>;

  constructor(dbName = 'bado_local_v1') {
    super(dbName);

    this.version(1).stores({
      institutions: 'id, &slug, isDemo, isActive',
      institutionSettings: 'institutionId',
      campuses: 'id, institutionId, [institutionId+code], [institutionId+isActive]',
      departments:
        'id, institutionId, [institutionId+code], [institutionId+isActive]',
      profiles: 'id, email',
      userInstitutions:
        'id, userId, institutionId, &[userId+institutionId], [institutionId+role]',
      auditLogs:
        'id, institutionId, [institutionId+createdAt], [institutionId+entityType]',
      syncQueue:
        'id, institutionId, [institutionId+status], [institutionId+recordType+recordId], createdAt',
      cacheMeta: 'key, institutionId, [institutionId+scope]',
    });

    this.version(2).stores({
      assetTypes:
        'id, institutionId, &[institutionId+code], [institutionId+category]',
      assets:
        'id, institutionId, &[institutionId+assetCode], [institutionId+campusId], [institutionId+category], [institutionId+verificationStatus], updatedAt',
      surveyBenchmarks:
        'assetId, institutionId, &[institutionId+referenceCode]',
      assetObservations: 'id, institutionId, [institutionId+assetId], measuredAt',
      verificationHistory: 'id, institutionId, [institutionId+assetId], createdAt',
      assetPhotos: 'id, institutionId, [institutionId+assetId], createdAt',
      assetDocuments: 'id, institutionId, [institutionId+assetId], createdAt',
      localMediaBlobs: 'id, institutionId, [institutionId+assetId], mediaKind',
    });

    this.version(3).stores({
      routeVertices:
        'id, institutionId, [institutionId+assetId], [assetId+partIndex+sequenceIndex]',
      depthObservations:
        'id, institutionId, [institutionId+assetId], observedAt',
      utilityJunctions:
        'id, institutionId, [institutionId+assetId], connectedAssetId',
    });
  }
}

export const badoDb = new BadoLocalDatabase();
