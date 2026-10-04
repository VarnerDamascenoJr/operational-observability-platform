export function isNil(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

export function isPresent<Value>(value: Value): value is NonNullable<Value> {
  return !isNil(value);
}
