export const APP_ENVIRONMENTS = ["development", "beta", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type RuntimeInstanceIdentity = {
  environment: AppEnvironment;
  instanceId: string;
};

const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export function requireRuntimeInstanceIdentity(
  appEnvironment: string | undefined,
  instanceId: string | undefined,
): RuntimeInstanceIdentity {
  const environment = String(appEnvironment ?? "").trim().toLowerCase();
  if (!APP_ENVIRONMENTS.includes(environment as AppEnvironment)) {
    throw new Error(`APP_ENV must explicitly be one of: ${APP_ENVIRONMENTS.join(", ")}`);
  }

  const normalizedInstanceId = String(instanceId ?? "").trim().toLowerCase();
  if (!normalizedInstanceId) {
    throw new Error("INSTANCE_ID is required for D1 instance safety");
  }
  if (!INSTANCE_ID_PATTERN.test(normalizedInstanceId)) {
    throw new Error("INSTANCE_ID must use 1-128 lowercase letters, numbers, dots, underscores, colons, or hyphens");
  }
  const requiredPrefix = `${environment}:`;
  if (!normalizedInstanceId.startsWith(requiredPrefix) || normalizedInstanceId.length === requiredPrefix.length) {
    throw new Error(`INSTANCE_ID must be namespaced as ${requiredPrefix}<instance>`);
  }

  return { environment: environment as AppEnvironment, instanceId: normalizedInstanceId };
}

export function assertStoredInstanceIdentity(
  runtime: RuntimeInstanceIdentity,
  markers: ReadonlyMap<string, string>,
): void {
  const storedEnvironment = markers.get("app_environment")?.trim().toLowerCase();
  if (!storedEnvironment) {
    throw new Error(`D1 environment identity is missing; expected ${runtime.environment}`);
  }
  if (storedEnvironment !== runtime.environment) {
    throw new Error(`D1 environment mismatch: expected ${runtime.environment}, found ${storedEnvironment}`);
  }

  const storedInstanceId = markers.get("instance_id")?.trim().toLowerCase();
  if (!storedInstanceId) {
    throw new Error(`D1 instance identity is missing; expected ${runtime.instanceId}`);
  }
  if (storedInstanceId !== runtime.instanceId) {
    throw new Error(`D1 instance mismatch: expected ${runtime.instanceId}, found ${storedInstanceId}`);
  }
}
