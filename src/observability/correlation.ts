import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const requestIdHeader = 'x-request-id';
export const correlationIdHeader = 'x-correlation-id';
export const transactionIdHeader = 'x-transaction-id';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const correlationContextSymbol = Symbol('correlation-context');

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  transactionId: string;
}

type CorrelatedIncomingMessage = IncomingMessage & {
  [correlationContextSymbol]?: CorrelationContext;
};

function validHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];

  return typeof value === 'string' && correlationIdPattern.test(value) ? value : undefined;
}

export function getCorrelationContext(request: IncomingMessage): CorrelationContext {
  const correlatedRequest = request as CorrelatedIncomingMessage;
  const existingContext = correlatedRequest[correlationContextSymbol];

  if (existingContext) {
    return existingContext;
  }

  const context = {
    requestId: validHeaderValue(request.headers, requestIdHeader) ?? createId('req'),
    correlationId: validHeaderValue(request.headers, correlationIdHeader) ?? createId('corr'),
    transactionId: validHeaderValue(request.headers, transactionIdHeader) ?? createId('txn'),
  };
  correlatedRequest[correlationContextSymbol] = context;

  return context;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
