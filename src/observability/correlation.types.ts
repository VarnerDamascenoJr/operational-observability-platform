import type { IncomingMessage } from 'node:http';

import { correlationContextSymbol } from '../utils/correlation.js';

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  transactionId: string;
  traceId?: string;
}

export type CorrelatedIncomingMessage = IncomingMessage & {
  [correlationContextSymbol]?: CorrelationContext;
};
