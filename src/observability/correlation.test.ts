import { type IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import {
  correlationIdHeader,
  getCorrelationContext,
  requestIdHeader,
  transactionIdHeader,
} from './correlation.js';

function requestWithHeaders(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('correlation context', () => {
  it('preserves valid inbound identifiers', () => {
    const context = getCorrelationContext(
      requestWithHeaders({
        [requestIdHeader]: 'gateway-request_123',
        [correlationIdHeader]: 'checkout-flow',
        [transactionIdHeader]: 'order:456',
      }),
    );

    expect(context).toEqual({
      requestId: 'gateway-request_123',
      correlationId: 'checkout-flow',
      transactionId: 'order:456',
    });
  });

  it('replaces missing or unsafe identifiers with UUIDs', () => {
    const context = getCorrelationContext(
      requestWithHeaders({
        [requestIdHeader]: 'contains spaces',
        [correlationIdHeader]: '<script>',
        [transactionIdHeader]: ['duplicate', 'headers'],
      }),
    );

    expect(context.requestId).toMatch(/^req_/);
    expect(context.correlationId).toMatch(/^corr_/);
    expect(context.transactionId).toMatch(/^txn_/);
  });

  it('returns the same context throughout one request', () => {
    const request = requestWithHeaders({});

    expect(getCorrelationContext(request)).toBe(getCorrelationContext(request));
  });
});
