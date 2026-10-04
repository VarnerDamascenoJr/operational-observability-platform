import { ValidationError } from '../../errors/validation-error.js';
import { isNil } from '../../utils/presence.js';
import {
  parseStringNumber,
  requiredInteger,
  requiredString,
  requireRecord,
} from '../../validation/primitives.js';
import type { PaginationInput } from './pagination.types.js';

export interface PaginationQueryOptions<Cursor> {
  defaultLimit: number;
  maximumLimit: number;
  parseCursor: (value: unknown) => Cursor;
}

export function encodePaginationCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodePaginationCursor(value: string, message: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ValidationError(message);
  }
}

export function parsePaginationInput<Cursor>(
  value: unknown,
  options: PaginationQueryOptions<Cursor>,
): PaginationInput<Cursor> {
  const query = requireRecord(value, 'Query params must be an object');
  const rawLimit = query.limit;
  const limit =
    rawLimit === undefined
      ? options.defaultLimit
      : requiredInteger(parseStringNumber(rawLimit), 'limit', {
          maximum: options.maximumLimit,
          minimum: 1,
        });

  return {
    cursor: parseOptionalCursor(query.cursor, options),
    limit,
  };
}

function parseOptionalCursor<Cursor>(
  value: unknown,
  options: PaginationQueryOptions<Cursor>,
): Cursor | undefined {
  if (isNil(value)) {
    return undefined;
  }

  return options.parseCursor(requiredString(value, 'cursor'));
}
