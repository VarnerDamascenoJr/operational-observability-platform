import { writeFile } from 'node:fs/promises';

import { buildApp } from '../../dist/app.js';
import { OtlpHttpTelemetryExporter } from '../../dist/observability/otlp.js';

const identity = { environment: 'outage-test', serviceName: 'collector-outage-test' };
const app = buildApp({
  identity,
  telemetry: new OtlpHttpTelemetryExporter({
    ...identity,
    endpoint: process.env.TEST_OTLP_ENDPOINT,
  }),
});
const address = await app.listen({ host: '127.0.0.1', port: 0 });
await writeFile(process.env.TEST_ADDRESS_FILE, address);
process.on('SIGTERM', () => {
  void app.close().finally(() => process.exit(0));
});
