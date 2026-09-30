import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import {
  correlationIdHeader,
  requestIdHeader,
  transactionIdHeader,
  traceparentHeader,
} from '../constants/headers.js';
import type { CorrelatedIncomingMessage, CorrelationContext } from './correlation.types.js';
import {
  correlationContextSymbol,
  correlationIdPattern,
  spanIdPattern,
  traceFlagsPattern,
  traceIdPattern,
  traceVersionPattern,
} from '../utils/correlation.js';

export type { CorrelationContext } from './correlation.types.js';

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

  if (version === 'ff' || !traceVersionPattern.test(version)) {
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
