import { beforeEach, describe, expect, it } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';

describe('linear route field workflow', () => {
  let gateway: LocalDemoDataGateway;
  beforeEach(async () => {
    localStorage.clear();
    await badoDb.delete();
    await badoDb.open();
    gateway = new LocalDemoDataGateway();
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);
  });
  it('persists route metadata, vertices, measured depth and junctions', async () => {
    const types = await gateway.listAssetTypes(DEMO_IDS.primaryInstitution, 'underground');
    const type = types.find(t => t.code === 'WATER_PIPELINE')!;
    const asset = await gateway.createLinearRoute(DEMO_IDS.primaryInstitution, {
      campusId: DEMO_IDS.mainCampus, assetTypeId: type.id, assetCode: 'WP-TEST-300', name: 'Test water route',
      geometry: { type: 'LineString', coordinates: [[5.138, 7.304], [5.139, 7.304]] },
      submissionMode: 'submitted', customAttributes: { serviceType: 'Secondary service line' },
      vertices: [{ sequenceIndex: 0, longitude: 5.138, latitude: 7.304, vertexKind: 'start_point' }, { sequenceIndex: 1, longitude: 5.139, latitude: 7.304, vertexKind: 'valve', horizontalAccuracyM: 3 }],
      depthObservations: [{ longitude: 5.1385, latitude: 7.304, depthM: 1.2, measurementMethod: 'open_trench_tape', documentedBeforeCovering: true }],
      junctions: [{ longitude: 5.1385, latitude: 7.304, junctionKind: 'tee', label: 'Branch', depthM: 1.2, depthMeasurementMethod: 'open_trench_tape' }],
    });
    const detail = await gateway.getAssetDetail(DEMO_IDS.primaryInstitution, asset.id);
    expect(detail?.asset.routeLengthM).toBeGreaterThan(100);
    expect(detail?.routeVertices.map(v => v.vertexKind)).toEqual(['start_point', 'valve']);
    expect(detail?.depthObservations[0]).toMatchObject({ depthM: 1.2, documentedBeforeCovering: true });
    expect(detail?.junctions[0]).toMatchObject({ junctionKind: 'tee', label: 'Branch' });
    await gateway.addDepthObservation(DEMO_IDS.primaryInstitution, { assetId: asset.id, latitude: 7.304, longitude: 5.13875, depthM: 0.8, measurementMethod: 'gpr' });
    expect((await gateway.getAssetDetail(DEMO_IDS.primaryInstitution, asset.id))?.depthObservations).toHaveLength(2);
  });
  it('rejects junction depth without a measurement method', async () => {
    const types = await gateway.listAssetTypes(DEMO_IDS.primaryInstitution, 'underground');
    const type = types.find(t => t.code === 'WATER_PIPELINE')!;
    await expect(gateway.createLinearRoute(DEMO_IDS.primaryInstitution, {
      campusId: DEMO_IDS.mainCampus, assetTypeId: type.id, assetCode: 'WP-TEST-301', name: 'Invalid route', submissionMode: 'draft',
      geometry: { type: 'LineString', coordinates: [[5.138, 7.304], [5.139, 7.304]] },
      junctions: [{ latitude: 7.304, longitude: 5.1385, depthM: 1 }],
    })).rejects.toThrow();
  });
});
