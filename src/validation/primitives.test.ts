import { describe, expect, it } from 'vitest';

import { ValidationError } from '../errors/validation-error.js';
import { isNil, isPresent } from '../utils/presence.js';
import {
  optionalString,
  parseStringNumber,
  requiredEnum,
  requiredInteger,
  requiredNumber,
  requiredNumberInRange,
  requireRecord,
} from './primitives.js';

describe('presence helpers', () => {
  it('treats only null and undefined as absent', () => {
    expect(isNil(null)).toBe(true);
    expect(isNil(undefined)).toBe(true);
    expect(isNil(0)).toBe(false);
    expect(isNil(false)).toBe(false);
    expect(isNil('')).toBe(false);

    expect(isPresent(0)).toBe(true);
    expect(isPresent(false)).toBe(true);
  });
});

describe('validation primitives', () => {
  it('keeps optional strings limited to null and undefined', () => {
    expect(optionalString(null, 'name')).toBeUndefined();
    expect(optionalString(undefined, 'name')).toBeUndefined();
    expect(() => optionalString('', 'name')).toThrow(ValidationError);
  });

  it('requires records without accepting null or arrays', () => {
    expect(requireRecord({ id: 'value' }, 'body must be an object')).toEqual({ id: 'value' });
    expect(() => requireRecord(null, 'body must be an object')).toThrow(ValidationError);
    expect(() => requireRecord([], 'body must be an object')).toThrow(ValidationError);
  });

  it('parses finite numeric inputs without dropping zero', () => {
    expect(parseStringNumber('0')).toBe(0);
    expect(requiredNumber(0, 'scoreDelta')).toBe(0);
    expect(requiredNumber('0.25', 'scoreDelta')).toBe(0.25);
    expect(() => requiredNumber('', 'scoreDelta')).toThrow(ValidationError);
  });

  it('validates enums and numeric ranges with shared primitives', () => {
    expect(requiredEnum('page', 'severity', ['info', 'page'] as const)).toBe('page');
    expect(() => requiredEnum('critical', 'severity', ['info', 'page'] as const)).toThrow(
      ValidationError,
    );

    expect(requiredInteger(3, 'limit', { maximum: 5, minimum: 1 })).toBe(3);
    expect(() => requiredInteger(1.5, 'limit', { maximum: 5, minimum: 1 })).toThrow(
      ValidationError,
    );

    expect(requiredNumberInRange('0.25', 'lambda', { maximum: 1, minimum: 0.01 })).toBe(0.25);
    expect(() => requiredNumberInRange(2, 'lambda', { maximum: 1, minimum: 0.01 })).toThrow(
      ValidationError,
    );
  });
});
