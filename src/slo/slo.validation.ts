import { ValidationError } from '../errors/validation-error.js';
import {
  optionalString,
  parseStringNumber,
  requiredEnum,
  requiredIsoDate,
  requiredInteger,
  requiredNumberInRange,
  requiredSlug,
  requiredString,
  requiredUuid,
  requireArray,
  requireRecord,
} from '../validation/primitives.js';
import type {
  CreateEvaluationInput,
  CreateSloInput,
  EvaluationSource,
  SliEventCounts,
  SliObjectiveInput,
} from './slo.types.js';
import { round } from './slo.calculations.js';

export function parseCreateSloInput(value: unknown): CreateSloInput {
  const body = requireRecord(value, 'Request body must be an object');
  const project = requireRecord(body.project, 'project must be an object');
  const service = requireRecord(body.service, 'service must be an object');
  const objectives = requireArray(body.objectives, 'objectives must be an array').map(
    parseObjective,
  );
  const objectiveTypes = new Set(objectives.map((objective) => objective.type));

  if (objectives.length === 0) {
    throw new ValidationError('At least one SLI objective is required');
  }

  if (objectiveTypes.size !== objectives.length) {
    throw new ValidationError('Each SLI objective type can appear only once');
  }

  return {
    description: optionalString(body.description, 'description'),
    name: requiredString(body.name, 'name'),
    objectives,
    project: {
      description: optionalString(project.description, 'project.description'),
      name: requiredString(project.name, 'project.name'),
      slug: requiredSlug(project.slug, 'project.slug'),
    },
    service: {
      environment: requiredString(service.environment, 'service.environment'),
      name: requiredString(service.name, 'service.name'),
      owner: optionalString(service.owner, 'service.owner'),
      slug: requiredSlug(service.slug, 'service.slug'),
    },
    slug: requiredSlug(body.slug, 'slug'),
    windowDays: requiredInteger(body.windowDays, 'windowDays', { maximum: 90, minimum: 1 }),
  };
}

export function parseEvaluationInput(value: unknown): CreateEvaluationInput {
  const body = requireRecord(value, 'Request body must be an object');
  const indicators = requireRecord(body.indicators, 'indicators must be an object');
  const windowStartedAt = requiredIsoDate(body.windowStartedAt, 'windowStartedAt');
  const windowEndedAt = requiredIsoDate(body.windowEndedAt, 'windowEndedAt');

  if (Date.parse(windowEndedAt) <= Date.parse(windowStartedAt)) {
    throw new ValidationError('windowEndedAt must be after windowStartedAt');
  }

  return {
    indicators: {
      availability: parseOptionalCounts(indicators.availability, 'indicators.availability'),
      latency: parseOptionalCounts(indicators.latency, 'indicators.latency'),
    },
    source: parseEvaluationSource(body.source),
    windowEndedAt,
    windowStartedAt,
  };
}

export function parseSloId(value: unknown): string {
  const params = requireRecord(value, 'Route params must be an object');
  return requiredUuid(params.sloId, 'sloId');
}

export function parseRollingWindowLimit(value: unknown): number {
  const query = requireRecord(value, 'Query params must be an object');
  const rawLimit = query.limit;

  if (rawLimit === undefined) {
    return 14;
  }

  return requiredInteger(parseStringNumber(rawLimit), 'limit', { maximum: 90, minimum: 1 });
}

export function parseBurnRateWindowCounts(value: unknown): {
  longWindowCount: number;
  shortWindowCount: number;
} {
  const query = requireRecord(value, 'Query params must be an object');
  const shortWindowCount = optionalInteger(query.shortWindows, 'shortWindows', {
    defaultValue: 1,
    maximum: 30,
    minimum: 1,
  });
  const longWindowCount = optionalInteger(query.longWindows, 'longWindows', {
    defaultValue: 6,
    maximum: 90,
    minimum: 1,
  });

  if (longWindowCount < shortWindowCount) {
    throw new ValidationError('longWindows must be greater than or equal to shortWindows');
  }

  return { longWindowCount, shortWindowCount };
}

export function parseProcessControlInput(value: unknown): {
  baselineWindowCount: number;
  ewmaLambda: number;
  limit: number;
  sigmaMultiplier: number;
  sustainedWindowCount: number;
} {
  const query = requireRecord(value, 'Query params must be an object');

  return {
    baselineWindowCount: optionalInteger(query.baselineWindows, 'baselineWindows', {
      defaultValue: 5,
      maximum: 60,
      minimum: 2,
    }),
    ewmaLambda: optionalNumber(query.lambda, 'lambda', {
      defaultValue: 0.3,
      maximum: 1,
      minimum: 0.01,
    }),
    limit: optionalInteger(query.limit, 'limit', {
      defaultValue: 14,
      maximum: 90,
      minimum: 3,
    }),
    sigmaMultiplier: optionalNumber(query.sigmaMultiplier, 'sigmaMultiplier', {
      defaultValue: 3,
      maximum: 6,
      minimum: 1,
    }),
    sustainedWindowCount: optionalInteger(query.sustainedWindows, 'sustainedWindows', {
      defaultValue: 3,
      maximum: 10,
      minimum: 2,
    }),
  };
}

function parseEvaluationSource(value: unknown): EvaluationSource {
  if (value === undefined) {
    return { kind: 'manual' };
  }

  const source = requireRecord(value, 'source must be an object');
  const kind = requiredEnum(
    source.kind,
    'source.kind',
    ['manual', 'fixture', 'prometheus'] as const,
    'manual, fixture or prometheus',
  );

  return {
    kind,
    period: optionalString(source.period, 'source.period'),
    query: optionalString(source.query, 'source.query'),
  };
}

function parseOptionalCounts(value: unknown, field: string): SliEventCounts | undefined {
  if (value === undefined) {
    return undefined;
  }

  const counts = requireRecord(value, `${field} must be an object`);
  const totalEvents = requiredInteger(counts.totalEvents, `${field}.totalEvents`, {
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 0,
  });
  const goodEvents = requiredInteger(counts.goodEvents, `${field}.goodEvents`, {
    maximum: totalEvents,
    minimum: 0,
  });

  return { goodEvents, totalEvents };
}

function parseObjective(value: unknown): SliObjectiveInput {
  const objective = requireRecord(value, 'objective must be an object');
  const type = requiredEnum(
    objective.type,
    'objective.type',
    ['availability', 'latency'] as const,
    'availability or latency',
  );

  return {
    ...(type === 'latency'
      ? {
          latencyThresholdMilliseconds: requiredInteger(
            objective.latencyThresholdMilliseconds,
            'objective.latencyThresholdMilliseconds',
            { maximum: 60_000, minimum: 1 },
          ),
        }
      : {}),
    targetPercentage: requiredPercentage(objective.targetPercentage, 'objective.targetPercentage'),
    type,
  };
}

function requiredPercentage(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 100) {
    throw new ValidationError(`${field} must be greater than 0 and lower than 100`);
  }

  return round(value, 3);
}

function optionalInteger(
  value: unknown,
  field: string,
  range: { defaultValue: number; maximum: number; minimum: number },
): number {
  if (value === undefined) {
    return range.defaultValue;
  }

  return requiredInteger(parseStringNumber(value), field, range);
}

function optionalNumber(
  value: unknown,
  field: string,
  range: { defaultValue: number; maximum: number; minimum: number },
): number {
  if (value === undefined) {
    return range.defaultValue;
  }

  return round(requiredNumberInRange(parseStringNumber(value), field, range), 5);
}
