import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const requestIdHeader = 'x-request-id';
export const correlationIdHeader = 'x-correlation-id';
export const transactionIdHeader = 'x-transaction-id';
export const traceparentHeader = 'traceparent';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const correlationContextSymbol = Symbol('correlation-context');
const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;
const traceFlagsPattern = /^[0-9a-f]{2}$/;

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  transactionId: string;
  traceId?: string;
}

type CorrelatedIncomingMessage = IncomingMessage & {
  [correlationContextSymbol]?: CorrelationContext;
};

function validHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];

  return typeof value === 'string' && correlationIdPattern.test(value) ? value : undefined;
}

function traceIdFromTraceparent(headers: IncomingHttpHeaders): string | undefined {
  const value = headers[traceparentHeader];

  if (typeof value !== 'string') {
    return undefined;
  }

  const [version, traceId, spanId, traceFlags, extra] = value.split('-');

  if (
    extra !== undefined ||
    version === undefined ||
    traceId === undefined ||
    spanId === undefined ||
    traceFlags === undefined
  ) {
    return undefined;
  }

  if (version === 'ff' || !/^[0-9a-f]{2}$/.test(version)) {
    return undefined;
  }

  if (
    !traceIdPattern.test(traceId) ||
    traceId === '00000000000000000000000000000000' ||
    !spanIdPattern.test(spanId) ||
    spanId === '0000000000000000' ||
    !traceFlagsPattern.test(traceFlags)
  ) {
    return undefined;
  }

  return traceId;
}

export function getCorrelationContext(request: IncomingMessage): CorrelationContext {
  const correlatedRequest = request as CorrelatedIncomingMessage;
  const existingContext = correlatedRequest[correlationContextSymbol];

  if (existingContext) {
    return existingContext;
  }

  const traceId = traceIdFromTraceparent(request.headers);
  const context: CorrelationContext = {
    requestId: validHeaderValue(request.headers, requestIdHeader) ?? createId('req'),
    correlationId: validHeaderValue(request.headers, correlationIdHeader) ?? createId('corr'),
    transactionId: validHeaderValue(request.headers, transactionIdHeader) ?? createId('txn'),
  };

  if (traceId) {
    context.traceId = traceId;
  }

  correlatedRequest[correlationContextSymbol] = context;

  return context;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
