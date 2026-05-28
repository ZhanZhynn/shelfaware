/**
 * API Response Utilities
 * Helper functions for standardized API responses
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/monitoring/sentry";
import type { ApiResponse, ApiError, ValidationError } from "@/types/api";

/**
 * Success response helper
 */
export function successResponse<T>(
  data: T,
  message?: string,
  status = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status }
  );
}

export type ErrorResponseOptions = {
  /** When false, 5xx responses are not sent to Sentry (expected ops failures) */
  reportToSentry?: boolean;
};

/**
 * Error response helper
 */
export function errorResponse(
  error: string,
  statusCode = 500,
  details?: Record<string, unknown>,
  options?: ErrorResponseOptions,
): NextResponse<ApiError> {
  const reportToSentry = options?.reportToSentry ?? true;

  logger.error("API Error:", { error, statusCode, details });

  if (statusCode >= 500 && reportToSentry) {
    const errorObj = new Error(error);
    captureException(errorObj, {
      statusCode,
      details,
      apiError: true,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error,
      statusCode,
      details,
    },
    { status: statusCode },
  );
}

/**
 * Expected service unavailability (billing, missing config) — warn only, no Sentry.
 */
export function serviceUnavailableResponse(
  error: string,
  details?: Record<string, unknown>,
): NextResponse<ApiError> {
  logger.warn("Service unavailable:", { error, details });
  return NextResponse.json(
    {
      success: false,
      error,
      statusCode: 503,
      details,
    },
    { status: 503 },
  );
}

/**
 * Validation error response helper
 */
export function validationErrorResponse(
  errors: ValidationError[]
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "Validation failed",
      statusCode: 400,
      errors,
    },
    { status: 400 }
  );
}

/**
 * Unauthorized response helper
 */
export function unauthorizedResponse(
  message = "Unauthorized"
): NextResponse<ApiError> {
  return errorResponse(message, 401);
}

/**
 * Not found response helper
 */
export function notFoundResponse(
  resource = "Resource"
): NextResponse<ApiError> {
  return errorResponse(`${resource} not found`, 404);
}

/**
 * Forbidden response helper
 */
export function forbiddenResponse(
  message = "Forbidden"
): NextResponse<ApiError> {
  return errorResponse(message, 403);
}

/**
 * Try-catch wrapper for API routes
 * Automatically handles errors and returns standardized error responses
 */
export async function apiHandler<T>(
  handler: () => Promise<T>,
  errorMessage = "An error occurred"
): Promise<NextResponse<ApiResponse<T> | ApiError>> {
  try {
    const data = await handler();
    return successResponse(data);
  } catch (error) {
    logger.error(`${errorMessage}:`, error);

    if (error instanceof Error) {
      return errorResponse(error.message);
    }

    return errorResponse(errorMessage);
  }
}
