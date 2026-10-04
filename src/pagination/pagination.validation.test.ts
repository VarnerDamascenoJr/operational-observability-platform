import { describe, expect, it } from 'vitest';

import { ValidationError } from '../errors/validation-error.js';
import {
  decodePaginationCursor,
  encodePaginationCursor,
  parsePaginationInput,
} from './pagination.validation.js';

describe('pagination validation', () => {
  it('parses bounded limits and delegates cursor validation', () => {
    const cursor = encodePaginationCursor({ id: 'cursor-id' });

    expect(
      parsePaginationInput(
        { cursor, limit: '25' },
        {
          defaultLimit: 50,
          maximumLimit: 100,
          parseCursor: (value) => decodePaginationCursor(String(value), 'cursor is invalid'),
        },
      ),
    ).toEqual({
      cursor: { id: 'cursor-id' },
      limit: 25,
    });
  });

  it('uses defaults and rejects invalid limits', () => {
    const options = {
      defaultLimit: 50,
      maximumLimit: 100,
      parseCursor: (value: unknown) => value,
    };

    expect(parsePaginationInput({}, options)).toEqual({ limit: 50 });
    expect(() => parsePaginationInput({ limit: '0' }, options)).toThrow(ValidationError);
    expect(() => parsePaginationInput({ limit: '101' }, options)).toThrow(ValidationError);
  });
});
