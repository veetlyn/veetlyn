/** Public provenance only. Never include credentials or tenant data here. */
export function releaseDescriptor(service: "web" | "api", env: {
  RELEASE_SHA: string;
  CF_VERSION_METADATA?: { id: string };
  DEPLOY_STAGE: string;
  PUBLIC_ACCESS: string;
  PLATFORM_NAME: string;
  PLATFORM_DOMAIN: string;
  STORE_DOMAIN: string;
  PAYPAL_ENVIRONMENT: string;
}) {
  return {
    service, workerVersion: env.CF_VERSION_METADATA?.id ?? null, sha: env.RELEASE_SHA, stage: env.DEPLOY_STAGE,
    publicAccess: env.PUBLIC_ACCESS, platformName: env.PLATFORM_NAME,
    platformDomain: env.PLATFORM_DOMAIN, storeDomain: env.STORE_DOMAIN,
    paypalEnvironment: env.PAYPAL_ENVIRONMENT,
  };
}
