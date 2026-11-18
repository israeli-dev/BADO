import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { BadoLocalDatabase } from '@/lib/db/badoDb';

describe('multi-institution isolation, RBAC enforcement & audit integrity', () => {
  let db: BadoLocalDatabase;
  let gateway: LocalDemoDataGateway;

  beforeEach(() => {
    db = new BadoLocalDatabase(`bado_test_iso_${crypto.randomUUID()}`);
    gateway = new LocalDemoDataGateway(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('prevents an Administrator of Institution A from reading or mutating Institution B', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userAdmin);

    const ownCampuses = await gateway.listCampuses(DEMO_IDS.primaryInstitution);
    expect(ownCampuses).toHaveLength(2);
    expect(
      ownCampuses.every((c) => c.institutionId === DEMO_IDS.primaryInstitution),
    ).toBe(true);

    await expect(
      gateway.listCampuses(DEMO_IDS.secondaryInstitution),
    ).rejects.toThrow(/Cross-institution/);

    await expect(
      gateway.listAuditLogs(DEMO_IDS.secondaryInstitution),
    ).rejects.toThrow(/Cross-institution/);

    await expect(
      gateway.createCampus(DEMO_IDS.secondaryInstitution, {
        name: 'Unauthorised Campus',
        code: 'UNAUTH',
        defaultZoom: 16,
      }),
    ).rejects.toThrow(/Cross-institution/);
  });

  it('scopes campus visibility when a user has explicit allowedCampusIds', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userReadOnly);
    const visibleCampuses = await gateway.listCampuses(DEMO_IDS.primaryInstitution);

    expect(visibleCampuses).toHaveLength(1);
    expect(visibleCampuses[0]?.id).toBe(DEMO_IDS.mainCampus);

    await expect(
      gateway.getDashboardSummary(DEMO_IDS.primaryInstitution, DEMO_IDS.annexCampus),
    ).rejects.toThrow(/ACCESS DENIED/);
  });

  it('blocks non-administrators from creating campuses, altering settings, or reading audit logs', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);

    await expect(
      gateway.createCampus(DEMO_IDS.primaryInstitution, {
        name: 'Tech Attempt',
        code: 'TECH_01',
        defaultZoom: 16,
      }),
    ).rejects.toThrow(/ACCESS DENIED/);

    await expect(
      gateway.listAuditLogs(DEMO_IDS.primaryInstitution),
    ).rejects.toThrow(/ACCESS DENIED/);
  });

  it('protects the last active administrator and records role/threshold changes in audit logs', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userAdmin);
    const members = await gateway.listInstitutionMembers(DEMO_IDS.primaryInstitution);
    const adminMembership = members.find((m) => m.userId === DEMO_IDS.userAdmin)!;
    const supervisorMembership = members.find(
      (m) => m.userId === DEMO_IDS.userSupervisor,
    )!;

    // Cannot demote sole administrator
    await expect(
      gateway.updateMemberRole(
        DEMO_IDS.primaryInstitution,
        adminMembership.id,
        'supervisor',
        true,
      ),
    ).rejects.toThrow(/last active administrator/);

    // Reject misordered live proximity thresholds (Close must be < Approaching < Nearby)
    await expect(
      gateway.updateInstitutionThresholds(DEMO_IDS.primaryInstitution, {
        defaultDigBufferM: 15,
        liveNearbyM: 20,
        liveApproachingM: 10,
        liveCloseM: 12,
        requireVerificationApproval: true,
        allowPublicPassports: false,
      }),
    ).rejects.toThrow(/Close < Approaching < Nearby/);

    // Promote second administrator, then confirm audit log captured the mutation
    await gateway.updateMemberRole(
      DEMO_IDS.primaryInstitution,
      supervisorMembership.id,
      'admin',
      true,
    );

    const logs = await gateway.listAuditLogs(DEMO_IDS.primaryInstitution);
    expect(
      logs.some(
        (entry) =>
          entry.entityType === 'user_institutions' && entry.action === 'update',
      ),
    ).toBe(true);
  });
});
