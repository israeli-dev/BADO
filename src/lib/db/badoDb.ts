import Dexie, { type EntityTable } from 'dexie';
import type {
  AuditLogEntry,
  CacheMetaRecord,
  Campus,
  Department,
  Institution,
  InstitutionSettings,
  SyncQueueRecord,
  UserInstitutionMembership,
  UserProfile,
} from '@/types/domain';

/**
 * BADO Offline-First Local Database (IndexedDB via Dexie.js).
 *
 * Phase 1 establishes institutional reference caches, audit log storage for the
 * local demonstration sandbox, cache-age tracking (`cacheMeta`), and the
 * idempotent synchronisation outbox (`syncQueue`). Later phases append versioned
 * schema upgrades for assets, linear routes, depth observations, passports, and
 * compressed photo blobs without breaking existing offline stores.
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

  constructor(dbName = 'bado_local_v1') {
    super(dbName);

    this.version(1).stores({
      institutions: 'id, &slug, isDemo, isActive',
      institutionSettings: 'institutionId',
      campuses: 'id, institutionId, [institutionId+code], [institutionId+isActive]',
      departments: 'id, institutionId, [institutionId+code], [institutionId+isActive]',
      profiles: 'id, email',
      userInstitutions:
        'id, userId, institutionId, &[userId+institutionId], [institutionId+role]',
      auditLogs: 'id, institutionId, [institutionId+createdAt], [institutionId+entityType]',
      syncQueue:
        'id, institutionId, [institutionId+status], [institutionId+recordType+recordId], createdAt',
      cacheMeta: 'key, institutionId, [institutionId+scope]',
    });
  }
}

export const badoDb = new BadoLocalDatabase();
