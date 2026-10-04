import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors/not-found-error.js';
import { ValidationError } from '../errors/validation-error.js';
import {
  confidenceToScore,
  scoreToConfidence,
  summarizeHypothesisConfidence,
} from './incidents.confidence.js';
import type { IncidentRepository } from './incidents.repository.js';
import { canTransitionIncidentStatus } from './incidents.rules.js';
import { IncidentService } from './incidents.service.js';
import type { IncidentResponse } from './incidents.types.js';
import { parseIncidentListInput } from './incidents.validation.js';

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

describe('incident list validation', () => {
  it('applies a bounded default limit and decodes cursors', () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        detectedAt: '2026-01-01T00:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000001',
      }),
      'utf8',
    ).toString('base64url');

    expect(parseIncidentListInput({ cursor, limit: '25' })).toEqual({
      cursor: {
        createdAt: '2026-01-01T00:00:00.000Z',
        detectedAt: '2026-01-01T00:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000001',
      },
      limit: 25,
    });
    expect(parseIncidentListInput({})).toEqual({ limit: 50 });
    expect(() => parseIncidentListInput({ limit: '500' })).toThrow(ValidationError);
    expect(() => parseIncidentListInput({ cursor: 'not-json' })).toThrow(ValidationError);
  });

  it('preserves PostgreSQL microsecond precision in decoded cursors', () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-01-01T00:00:00.123456Z',
        detectedAt: '2026-01-01T00:00:00.654321Z',
        id: '00000000-0000-4000-8000-000000000001',
      }),
      'utf8',
    ).toString('base64url');

    expect(parseIncidentListInput({ cursor })).toEqual({
      cursor: {
        createdAt: '2026-01-01T00:00:00.123456Z',
        detectedAt: '2026-01-01T00:00:00.654321Z',
        id: '00000000-0000-4000-8000-000000000001',
      },
      limit: 50,
    });
  });
});

describe('incident service lookup', () => {
  it('raises a not found error when an incident id is unknown', async () => {
    const service = new IncidentService({
      findById: async () => undefined,
    } as unknown as IncidentRepository);

    await expect(service.findById('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
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
