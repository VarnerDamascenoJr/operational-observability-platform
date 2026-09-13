import { type IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import {
  correlationIdHeader,
  getCorrelationContext,
  requestIdHeader,
  transactionIdHeader,
  traceparentHeader,
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

  it('extracts a trace id from a valid W3C traceparent header', () => {
    const context = getCorrelationContext(
      requestWithHeaders({
        [traceparentHeader]: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      }),
    );

    expect(context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('omits trace id when traceparent is unsafe or invalid', () => {
    const invalidTraceContext = getCorrelationContext(
      requestWithHeaders({
        [traceparentHeader]: '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      }),
    );
    const duplicateTraceContext = getCorrelationContext(
      requestWithHeaders({
        [traceparentHeader]: ['00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
      }),
    );

    expect(invalidTraceContext.traceId).toBeUndefined();
    expect(duplicateTraceContext.traceId).toBeUndefined();
  });
});
