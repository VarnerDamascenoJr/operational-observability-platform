export interface ServiceIdentity {
  environment: string;
  serviceName: string;
}

export const defaultEnvironment = 'development';
export const defaultServiceName = 'operational-observability-platform';

export function loadServiceIdentity(env: NodeJS.ProcessEnv = process.env): ServiceIdentity {
  return {
    environment: env.NODE_ENV ?? defaultEnvironment,
    serviceName: defaultServiceName,
  };
}
