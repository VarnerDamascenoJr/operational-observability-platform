import { type IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { getCorrelationContext, requestIdHeader, transactionIdHeader } from './correlation.js';

function requestWithHeaders(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('correlation context', () => {
  it('preserves valid inbound identifiers', () => {
    const context = getCorrelationContext(
      requestWithHeaders({
        [requestIdHeader]: 'gateway-request_123',
        [transactionIdHeader]: 'order:456',
      }),
    );

    expect(context).toEqual({
      requestId: 'gateway-request_123',
      transactionId: 'order:456',
    });
  });

  it('replaces missing or unsafe identifiers with UUIDs', () => {
    const context = getCorrelationContext(
      requestWithHeaders({
        [requestIdHeader]: 'contains spaces',
        [transactionIdHeader]: ['duplicate', 'headers'],
      }),
    );

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.transactionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same context throughout one request', () => {
    const request = requestWithHeaders({});

    expect(getCorrelationContext(request)).toBe(getCorrelationContext(request));
  });
});
