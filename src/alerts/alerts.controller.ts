import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import {
  requireArray,
  requiredEnum,
  requiredIsoDate,
  requiredString,
  requireRecord,
} from '../validation/primitives.js';

type Alert = {
  fingerprint: string;
  status: 'firing' | 'resolved';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  starts_at: string;
  ends_at: string | null;
};

function stringMap(value: unknown, field: string): Record<string, string> {
  const object = requireRecord(value, `${field} must be an object`);
  if (Object.values(object).some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${field} values must be strings`);
  }
  return object as Record<string, string>;
}

function parseAlert(value: unknown): Alert {
  const alert = requireRecord(value, 'alert must be an object');
  const status = requiredEnum(alert.status, 'status', ['firing', 'resolved'] as const);
  const starts_at = requiredIsoDate(alert.startsAt, 'startsAt');
  const ends_at = status === 'resolved' ? requiredIsoDate(alert.endsAt, 'endsAt') : null;
  if (ends_at && ends_at < starts_at) throw new ValidationError('endsAt must not precede startsAt');
  const labels = stringMap(alert.labels, 'labels');
  requiredString(labels.alertname, 'labels.alertname');
  return {
    fingerprint: requiredString(alert.fingerprint, 'fingerprint'),
    status,
    labels,
    annotations: stringMap(alert.annotations, 'annotations'),
    starts_at,
    ends_at,
  };
}

export function registerAlertRoutes(app: FastifyInstance, database: SqlExecutor | undefined): void {
  app.post('/alerts/webhook', async (request, reply) => {
    if (!database)
      return reply.code(503).send({ error: 'PostgreSQL is required to register alerts' });
    const body = requireRecord(request.body, 'notification must be an object');
    const alerts = requireArray(body.alerts, 'alerts must be an array').map(parseAlert);
    if (alerts.length === 0 || alerts.length > 1000)
      throw new ValidationError('alerts must contain 1 to 1000 entries');
    if (new Set(alerts.map((alert) => alert.fingerprint)).size !== alerts.length)
      throw new ValidationError('duplicate fingerprints in notification');
    await database.query(
      `
      INSERT INTO control_plane.alert_states AS current
        (fingerprint, status, labels, annotations, starts_at, ends_at)
      SELECT fingerprint, status, labels, annotations, starts_at, ends_at
      FROM jsonb_to_recordset($1::jsonb) AS incoming
        (fingerprint text, status text, labels jsonb, annotations jsonb, starts_at timestamptz, ends_at timestamptz)
      ON CONFLICT (fingerprint) DO UPDATE SET
        status = EXCLUDED.status, labels = EXCLUDED.labels, annotations = EXCLUDED.annotations,
        starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, updated_at = now()
      WHERE EXCLUDED.starts_at > current.starts_at
        OR (EXCLUDED.starts_at = current.starts_at AND (current.status = 'firing' OR EXCLUDED.status = 'resolved'))
    `,
      [JSON.stringify(alerts)],
    );
    return { accepted: alerts.length };
  });

  app.get('/alerts', async (request, reply) => {
    if (!database) return reply.code(503).send({ error: 'PostgreSQL is required to list alerts' });
    const query = requireRecord(request.query, 'query must be an object');
    const status =
      query.status === undefined
        ? null
        : requiredEnum(query.status, 'status', ['firing', 'resolved'] as const);
    const result = await database.query(
      `
      SELECT fingerprint, status, labels, annotations, starts_at AS "startsAt", ends_at AS "endsAt", updated_at AS "updatedAt"
      FROM control_plane.alert_states
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY updated_at DESC, fingerprint LIMIT 1000
    `,
      [status],
    );
    return { alerts: result.rows };
  });
}
