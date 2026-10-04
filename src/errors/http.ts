import type { FastifyInstance } from 'fastify';

import { ValidationError } from './validation-error.js';

export function registerHttpErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ValidationError) {
      void reply.code(400).send({ error: error.message });
      return;
    }

    void reply.send(error);
  });
}
