/**
 * Sentry helpers for app code (logger, ErrorBoundary, API routes).
 * Requires Sentry.init from instrumentation / sentry.*.config when DSN is set.
 */

import * as Sentry from "@sentry/nextjs";
import { getSentryDsn, isSentryEnabled } from "./sentry-config";
import { redactError, redactTelemetry, redactText } from "@/lib/security/redaction";

export {
  getSentryDsn,
  isSentryEnabled as isSentryConfigured,
  SENTRY_TUNNEL_PATH,
} from "./sentry-config";

export function captureException(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  try {
    const safeError = redactError(error);
    if (context) {
      Sentry.captureException(safeError, {
        contexts: { custom: redactTelemetry(context) },
      });
    } else {
      Sentry.captureException(safeError);
    }
  } catch {
    // SDK not initialized
  }
}

export function captureMessage(
  message: string,
  level: "error" | "warning" | "info" = "error",
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  try {
    if (context) {
      Sentry.captureMessage(redactText(message), {
        level,
        contexts: { custom: redactTelemetry(context) },
      });
    } else {
      Sentry.captureMessage(redactText(message), { level });
    }
  } catch {
    // SDK not initialized
  }
}

export function setUserContext(user: {
  id: string;
  email?: string;
  username?: string;
  name?: string;
  role?: string;
}): void {
  if (!isSentryEnabled()) {
    return;
  }

  try {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username || user.name,
    });
    if (user.role) {
      Sentry.setTag("role", user.role);
    }
  } catch {
    // SDK not initialized
  }
}

/** Sync Sentry user from auth context (login, session restore, logout). */
export function syncSentryUserFromAuth(user: {
  id: string;
  email?: string;
  name?: string;
  role?: string;
} | null): void {
  if (!user) {
    clearUserContext();
    return;
  }
  setUserContext({
    id: user.id,
    email: user.email,
    username: user.name,
    role: user.role,
  });
}

export function clearUserContext(): void {
  if (!isSentryEnabled()) {
    return;
  }

  try {
    Sentry.setUser(null);
  } catch {
    // SDK not initialized
  }
}

export function addBreadcrumb(
  message: string,
  category?: string,
  level: "error" | "warning" | "info" | "debug" = "info",
  data?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  try {
    Sentry.addBreadcrumb(redactTelemetry({
      message,
      category,
      level,
      data,
    }));
  } catch {
    // SDK not initialized
  }
}
