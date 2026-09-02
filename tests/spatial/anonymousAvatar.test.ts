import { describe, expect, it } from 'vitest';
import { toAnonymousRenderEntity } from '../../src/spatial/anonymousAvatar';
import type { SpatialTrackSample } from '../../src/spatial/types';

describe('anonymous avatar rendering', () => {
  it('maps a spatial cyclist track to an abstract cycle avatar', () => {
    const sample: SpatialTrackSample = {
      schemaVersion: '2.0',
      sessionId: 'session_test',
      renderTrackId: 'r_local_1',
      timestampMs: 1000,
      entityType: 'cyclist',
      position: { xMeters: 12.4, yMeters: 3.1 },
      headingDegrees: 90,
      speedMps: 4.2,
      confidence: 0.9,
      calibrationQuality: 0.8,
      motionQuality: 0.85,
    };

    const rendered = toAnonymousRenderEntity(sample);

    expect(rendered.shape).toBe('cycle');
    expect(rendered.renderTrackId).toBe('r_local_1');
    expect(rendered.position).toEqual({ xMeters: 12.4, yMeters: 3.1 });
    expect(rendered.opacity).toBeGreaterThan(0.25);
    expect(rendered.opacity).toBeLessThanOrEqual(1);

    // Privacy invariant: renderer contract contains no visual/identity attributes.
    expect(Object.keys(rendered)).not.toContain('image');
    expect(Object.keys(rendered)).not.toContain('face');
    expect(Object.keys(rendered)).not.toContain('plate');
    expect(Object.keys(rendered)).not.toContain('color');
    expect(Object.keys(rendered)).not.toContain('embedding');
  });
});
