import { describe, expect, it } from 'vitest';

import { canTransitionIncidentStatus } from './incidents.js';

describe('incident status transitions', () => {
  it('allows an active incident to move through investigation states', () => {
    expect(canTransitionIncidentStatus('open', 'investigating')).toBe(true);
    expect(canTransitionIncidentStatus('investigating', 'mitigated')).toBe(true);
    expect(canTransitionIncidentStatus('mitigated', 'resolved')).toBe(true);
  });

  it('keeps resolved incidents closed', () => {
    expect(canTransitionIncidentStatus('resolved', 'resolved')).toBe(true);
    expect(canTransitionIncidentStatus('resolved', 'investigating')).toBe(false);
    expect(canTransitionIncidentStatus('resolved', 'open')).toBe(false);
  });
});
