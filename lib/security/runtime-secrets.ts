type Environment = Record<string, string | undefined>;

export const runtimeSecretNames = [
  "JWT_SECRET",
  "CRON_SECRET",
  "MARKETPLACE_SYNC_WORKER_SECRET",
  "INTERNAL_API_KEY",
] as const;

/** Validate runtime credentials, never values in diagnostics or a build bypass. */
export function assertSecureRuntimeSecrets(env: Environment = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const configured: Array<{ name: string; value: string }> = [];
  for (const name of runtimeSecretNames) {
    const value = env[name];
    if (value === undefined && name !== "JWT_SECRET") continue;
    if (
      !value || value.trim() !== value || value.length < 32 ||
      /placeholder|change[-_ ]?me|your[-_ ](?:super[-_ ])?secret|your[-_ ].*(?:key|token)|unit[-_ ]test|(?:test|build)[-_ ]only|synthetic/i.test(value) ||
      /^(.)\1+$/.test(value)
    ) {
      throw new Error(`Unsafe runtime credential: ${name} must contain at least 32 non-placeholder characters with no surrounding whitespace`);
    }
    if (configured.some((secret) => secret.value === value)) {
      throw new Error(`Unsafe runtime credentials: ${name} must be independent of other session/service credentials`);
    }
    configured.push({ name, value });
  }
}
