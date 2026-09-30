export type PrometheusMetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface PrometheusMetricDefinition {
  help: string;
  name: string;
  type: PrometheusMetricType;
}

export function renderPrometheusMetricDefinitions(
  definitions: readonly PrometheusMetricDefinition[],
): string[] {
  return definitions.flatMap((definition) => [
    `# HELP ${definition.name} ${definition.help}`,
    `# TYPE ${definition.name} ${definition.type}`,
  ]);
}
