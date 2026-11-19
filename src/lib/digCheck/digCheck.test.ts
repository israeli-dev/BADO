import { describe, expect, it } from 'vitest';
import { demoDistanceM, validateDigCheck } from './digCheck';

describe('dig check geometry', () => {
  it('uses the route rather than its endpoints or centroid', () => {
    expect(demoDistanceM({type:'Point',coordinates:[5.1385,7.304]}, {type:'LineString',coordinates:[[5.138,7.304],[5.139,7.304]]})).toBeLessThan(0.1);
  });
  it('detects crossing routes and polygon containment', () => {
    const area = {type:'Polygon' as const,coordinates:[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]};
    expect(demoDistanceM(area, {type:'LineString',coordinates:[[-0.01,0.005],[0.02,0.005]]})).toBe(0);
    expect(demoDistanceM(area, {type:'Point',coordinates:[0.005,0.005]})).toBe(0);
  });
  it('rejects invalid buffers and self-intersecting or antimeridian areas', () => {
    const input = {campusId:'campus',bufferM: 5,geometry:{type:'Point' as const,coordinates:[0,0]}};
    expect(() => validateDigCheck({...input,bufferM:NaN})).toThrow();
    expect(() => validateDigCheck({...input,bufferM:501})).toThrow();
    expect(() => validateDigCheck({...input,geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}})).toThrow();
    expect(() => validateDigCheck({...input,geometry:{type:'Polygon',coordinates:[[[179,0],[-179,0],[-179,1],[179,0]]]}})).toThrow();
  });
});
