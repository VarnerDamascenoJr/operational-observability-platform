import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Sales journey dashboard correlation link', () => {
  it('filters OTLP metadata without parsing the plain-text log body as JSON', async () => {
    const dashboard = JSON.parse(
      await readFile('observability/grafana/dashboards/sales-event-journey.json', 'utf8'),
    ) as { links: Array<{ title: string; url: string }> };
    const link = dashboard.links.find((item) => item.title === 'Abrir logs por correlacao no Loki');
    expect(link).toBeDefined();
    const url = new URL(link!.url, 'http://localhost:3001');
    const explore = JSON.parse(url.searchParams.get('left')!) as {
      queries: Array<{ expr: string }>;
    };
    expect(explore.queries[0].expr).toBe(
      '{service_name=~"sales-event-api|sales-event-worker|sales-event-email-retry-worker"} | correlation_id="$correlation_id"',
    );
  });
});
