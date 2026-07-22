export type DatabaseTarget = {
  host: string;
  database: string;
  display: string;
  isLocalOrDev: boolean;
};

export type FreshStartEnvironment = Record<string, string | undefined>;

function normalizedDatabase(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 1) throw new Error("DATABASE_URL must include exactly one database name.");
  return decodeURIComponent(segments[0]!).trim();
}

export function getDatabaseTarget(databaseUrl: string | undefined): DatabaseTarget {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }
  if (url.protocol !== "mongodb:" && url.protocol !== "mongodb+srv:") throw new Error("DATABASE_URL must use mongodb or mongodb+srv.");

  const host = url.host.toLowerCase();
  const database = normalizedDatabase(url.pathname);
  const display = `${url.protocol}//${host}/${database}`;
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  const explicitDev = process.env.FRESH_START_TARGET === "development" && ["development", "test"].includes(process.env.NODE_ENV || "");

  return { host, database, display, isLocalOrDev: localHost || explicitDev };
}

function assertConfirmation(env: FreshStartEnvironment, name: string, expected: string) {
  if (env[name] !== expected) throw new Error(`Refusing operation: set ${name}=${expected}.`);
}

export function assertFreshStartAllowed(env: FreshStartEnvironment, target: DatabaseTarget, dryRun: boolean, operation: "RESET" | "BOOTSTRAP", subject: string) {
  if (dryRun) return;

  const productionGuard = !target.isLocalOrDev || env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  if (productionGuard) {
    assertConfirmation(env, `ALLOW_PRODUCTION_${operation}`, "yes");
    assertConfirmation(env, `PRODUCTION_${operation}_CONFIRMATION`, `${operation}_PRODUCTION:${target.display}:${subject}`);
    return;
  }
  assertConfirmation(env, `ALLOW_${operation}`, "yes");
  assertConfirmation(env, `${operation}_CONFIRMATION`, `${operation}:${target.display}:${subject}`);
}

export function assertResetAllowed(env: FreshStartEnvironment, target: DatabaseTarget, dryRun: boolean, includeMarketplace = false) {
  const noBackupConfirmation = `IRREVERSIBLE_NO_BACKUP:${target.display}`;
  const noBackupRequested = env.DATA_RESET_IRREVERSIBLE_NO_BACKUP_CONFIRMATION !== undefined;
  if (!dryRun && noBackupRequested) {
    assertConfirmation(env, "DATA_RESET_IRREVERSIBLE_NO_BACKUP_CONFIRMATION", noBackupConfirmation);
    if (!includeMarketplace || !target.isLocalOrDev || env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
      throw new Error("Refusing no-backup reset: it is allowed only with --include-marketplace on a recognized non-production local/dev target.");
    }
  }

  assertFreshStartAllowed(env, target, dryRun, "RESET", target.database);
  if (dryRun) return;

  if (!noBackupRequested) {
    assertConfirmation(env, "DATA_RESET_BACKUP_ACKNOWLEDGEMENT", `BACKUP_VERIFIED:${target.display}`);
  }
  assertConfirmation(env, "DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT", `MAINTENANCE_QUIESCED:${target.display}`);
  if (includeMarketplace) {
    assertConfirmation(env, "MARKETPLACE_RESET_CONFIRMATION", `RESET_MARKETPLACE:${target.display}`);
  }
}
