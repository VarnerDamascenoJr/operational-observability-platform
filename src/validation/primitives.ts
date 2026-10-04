import { ValidationError } from '../errors/validation-error.js';
import { isNil } from '../utils/presence.js';
import { slugPattern, uuidPattern } from './patterns.js';

export function parseOptionalArray<Item>(
  value: unknown,
  parser: (entry: unknown) => Item,
  message = 'Expected an array',
): Item[] {
  if (isNil(value)) {
    return [];
  }

  return requireArray(value, message).map(parser);
}

export function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(message);
  }

  return value;
}

export function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || isNil(value) || Array.isArray(value)) {
    throw new ValidationError(message);
  }

  return value as Record<string, unknown>;
}

export function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const time = Date.parse(text);

  if (!Number.isFinite(time)) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }

  return new Date(time).toISOString();
}

export function requiredEnum<const Value extends string>(
  value: unknown,
  field: string,
  options: readonly Value[],
  label = options.join(', '),
): Value {
  if (typeof value === 'string' && options.includes(value as Value)) {
    return value as Value;
  }

  throw new ValidationError(`${field} must be ${label}`);
}

export function requiredInteger(
  value: unknown,
  field: string,
  range: { maximum: number; minimum: number },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < range.minimum ||
    value > range.maximum
  ) {
    throw new ValidationError(
      `${field} must be an integer between ${range.minimum} and ${range.maximum}`,
    );
  }

  return value;
}

export function requiredNumber(value: unknown, field: string): number {
  const parsed = parseStringNumber(value);

  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a finite number`);
  }

  return parsed;
}

export function requiredNumberInRange(
  value: unknown,
  field: string,
  range: { maximum: number; minimum: number },
): number {
  const parsed = requiredNumber(value, field);

  if (parsed < range.minimum || parsed > range.maximum) {
    throw new ValidationError(
      `${field} must be a number between ${range.minimum} and ${range.maximum}`,
    );
  }

  return parsed;
}

export function requiredSlug(value: unknown, field: string): string {
  const slug = requiredString(value, field);

  if (!slugPattern.test(slug)) {
    throw new ValidationError(`${field} must be a safe slug`);
  }

  return slug;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }

  return value.trim();
}

export function requiredUuid(value: unknown, field: string): string {
  const id = requiredString(value, field);

  if (!uuidPattern.test(id)) {
    throw new ValidationError(`${field} must be a UUID`);
  }

  return id;
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (isNil(value)) {
    return undefined;
  }

  return requiredString(value, field);
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (isNil(value)) {
    return undefined;
  }

  return requiredUuid(value, field);
}

export function parseStringNumber(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
}
