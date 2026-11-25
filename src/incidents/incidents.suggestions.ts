import type { IncidentResponse } from './incidents.types.js';

type SuggestionInput = Pick<
  IncidentResponse,
  'detectedAt' | 'resolvedAt' | 'service' | 'sourceAlert'
>;

export interface InvestigationSuggestions {
  symptom: 'errors' | 'latency' | 'error_budget' | 'successful_transactions_drop' | 'unknown';
  serviceName: string;
  window: { start: string; end: string };
  suggestions: Array<{
    source: 'tempo' | 'loki';
    query: string;
    rationale: string;
  }>;
}

export function suggestInvestigation(
  incident: SuggestionInput,
  now = new Date(),
): InvestigationSuggestions {
  const symptoms: Record<string, InvestigationSuggestions['symptom']> = {
    OOPHighHttpErrorRate: 'errors',
    OOPHighHttpLatency: 'latency',
    OOPSloErrorBudgetBurn: 'error_budget',
    OOPSuccessfulTransactionsDrop: 'successful_transactions_drop',
  };
  const alertName = incident.sourceAlert?.name ?? '';
  const symptom = Object.hasOwn(symptoms, alertName) ? symptoms[alertName] : 'unknown';
  // The project convention uses the service slug as service.name. JSON quoting
  // prevents service values from escaping either query's string literal.
  const service = JSON.stringify(incident.service.slug);
  const detected = new Date(incident.detectedAt).getTime();
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now.getTime();
  const filter =
    symptom === 'errors'
      ? ' && status = error'
      : symptom === 'latency'
        ? ' && duration > 100ms'
        : '';
  const rationale = {
    errors: 'Start with error traces, then correlate their trace IDs with logs.',
    latency: 'Inspect traces slower than the local 100 ms demonstration threshold.',
    error_budget: 'Compare traces and logs in the affected SLO window; identify errors or latency.',
    successful_transactions_drop:
      'Compare transaction traces and logs with expected demand and failures.',
    unknown: 'Inspect service traces and logs; the source alert has no symptom-specific mapping.',
  }[symptom];
  return {
    symptom,
    serviceName: incident.service.slug,
    window: {
      start: new Date(detected - 15 * 60_000).toISOString(),
      end: new Date(Math.max(end, detected)).toISOString(),
    },
    suggestions: [
      { source: 'tempo', query: `{ resource.service.name = ${service}${filter} }`, rationale },
      {
        source: 'loki',
        query: `{service_name=${service}}`,
        rationale: 'Review service logs in the same window and filter by trace_id when available.',
      },
    ],
  };
}
