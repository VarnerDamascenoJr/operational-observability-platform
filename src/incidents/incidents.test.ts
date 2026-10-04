import { describe, expect, it } from 'vitest';

import {
  confidenceToScore,
  scoreToConfidence,
  summarizeHypothesisConfidence,
} from './incidents.confidence.js';
import { canTransitionIncidentStatus } from './incidents.rules.js';
import type { IncidentResponse } from './incidents.types.js';

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

describe('incident hypothesis confidence', () => {
  it('maps qualitative confidence to sortable scores', () => {
    expect(confidenceToScore('low')).toBe(0.25);
    expect(confidenceToScore('medium')).toBe(0.5);
    expect(confidenceToScore('high')).toBe(0.75);

    expect(scoreToConfidence(0.39)).toBe('low');
    expect(scoreToConfidence(0.4)).toBe('medium');
    expect(scoreToConfidence(0.7)).toBe('high');
  });

  it('summarizes the strongest active hypothesis and remaining uncertainty', () => {
    const hypotheses = [
      buildHypothesis({
        confidenceScore: 0.95,
        id: 'later-hypothesis',
        statement: 'Dependency failure is the driver.',
      }),
      buildHypothesis({
        confidenceScore: 0.8,
        id: 'rejected-hypothesis',
        status: 'rejected',
        statement: 'The database is saturated.',
      }),
      buildHypothesis({
        confidenceScore: 0.5,
        id: 'initial-hypothesis',
        statement: 'The API is slow.',
      }),
    ];

    expect(summarizeHypothesisConfidence(hypotheses)).toEqual({
      mostLikelyHypothesis: {
        confidence: 'high',
        confidenceScore: 0.95,
        id: 'later-hypothesis',
        statement: 'Dependency failure is the driver.',
      },
      remainingUncertainty: 0.05,
    });
  });
});

function buildHypothesis(
  overrides: Partial<IncidentResponse['hypotheses'][number]>,
): IncidentResponse['hypotheses'][number] {
  return {
    confidence: 'high',
    confidenceHistory: [],
    confidenceScore: 0.75,
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'hypothesis-id',
    statement: 'A likely cause.',
    status: 'open',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
