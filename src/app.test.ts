import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('health endpoint', () => {
  it('reports that the API is available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('enables readable logs during local development', async () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const developmentApp = buildApp();

    await developmentApp.ready();
    await developmentApp.close();
    process.env.NODE_ENV = nodeEnv;
  });
});
