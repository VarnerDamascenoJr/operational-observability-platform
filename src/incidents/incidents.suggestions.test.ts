import { describe, expect, it } from 'vitest';

import { suggestInvestigation } from './incidents.suggestions.js';

const incident = {
  detectedAt: '2026-11-24T12:00:00.000Z',
  service: { slug: 'sales-event-api', name: 'Sales API', id: 'service-id', environment: 'local' },
};
const now = new Date('2026-11-24T12:30:00.000Z');

describe('incident investigation suggestions', () => {
  it.each([
    ['OOPHighHttpErrorRate', 'errors', 'status = error'],
    ['OOPHighHttpLatency', 'latency', 'duration > 100ms'],
    ['OOPSloErrorBudgetBurn', 'error_budget', 'resource.service.name'],
    ['OOPSuccessfulTransactionsDrop', 'successful_transactions_drop', 'resource.service.name'],
  ])('suggests trace and log queries for %s', (name, symptom, filter) => {
    const result = suggestInvestigation({ ...incident, sourceAlert: { name } }, now);
    expect(result.symptom).toBe(symptom);
    expect(result.window).toEqual({ start: '2026-11-24T11:45:00.000Z', end: now.toISOString() });
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({ source: 'tempo', query: expect.stringContaining(filter) }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({ source: 'loki', query: '{service_name="sales-event-api"}' }),
    );
  });

  it('falls back to generic queries and bounds resolved incidents', () => {
    const result = suggestInvestigation(
      { ...incident, resolvedAt: '2026-11-24T12:10:00.000Z' },
      now,
    );
    expect(result.symptom).toBe('unknown');
    expect(result.window.end).toBe('2026-11-24T12:10:00.000Z');
    expect(result.suggestions[0].query).toBe('{ resource.service.name = "sales-event-api" }');
  });

  it('treats inherited object property names as unknown alerts', () => {
    const result = suggestInvestigation({ ...incident, sourceAlert: { name: 'toString' } }, now);
    expect(result.symptom).toBe('unknown');
    expect(result.suggestions[0].rationale).toContain('no symptom-specific mapping');
  });

  it('quotes service names safely in query literals', () => {
    const result = suggestInvestigation(
      { ...incident, service: { ...incident.service, slug: 'service"} |= "bad' } },
      now,
    );
    expect(result.suggestions[1].query).toBe('{service_name="service\\"} |= \\"bad"}');
  });
});
