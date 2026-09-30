// Allows compact, header-safe correlation identifiers.
export const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const correlationContextSymbol = Symbol('correlation-context');

// Matches a W3C traceparent version.
export const traceVersionPattern = /^[0-9a-f]{2}$/;

// Matches a W3C lowercase trace id.
export const traceIdPattern = /^[0-9a-f]{32}$/;

// Matches a W3C lowercase span id.
export const spanIdPattern = /^[0-9a-f]{16}$/;

// Matches W3C trace flags.
export const traceFlagsPattern = /^[0-9a-f]{2}$/;
