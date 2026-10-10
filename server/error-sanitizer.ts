import { logger } from './logger';

/**
 * Sanitize errors to prevent exposing internal details, stack traces, or configuration
 * SECURITY: Never expose API keys, file paths, database queries, or implementation details
 */
export function sanitizeError(error: unknown, context?: string): string {
  // Log full error server-side for debugging
  if (context) {
    logger.error(`Error in ${context}:`, error);
  } else {
    logger.error('Error occurred:', error);
  }

  // Return safe, generic messages to client
  if (error instanceof Error) {
    // Common error patterns that are safe to expose
    const safePatterns = [
      /not found/i,
      /invalid/i,
      /missing/i,
      /required/i,
      /failed to/i,
      /unable to/i,
      /timeout/i,
      /rate limit/i,
    ];

    const message = error.message;
    const isSafe = safePatterns.some(pattern => pattern.test(message));

    if (isSafe && !message.includes('process.env') && !message.includes('Error:')) {
      // Return sanitized version of the message (remove any potential paths or details)
      return message.replace(/\/[^\s]+/g, '').replace(/Error: /gi, '').trim();
    }
  }

  // Default generic error message
  return 'An error occurred processing your request';
}

/**
 * Safe error response for API endpoints
 * SECURITY: Prevents internal implementation details from leaking
 */
export function createSafeErrorResponse(
  error: unknown,
  context?: string,
  statusCode: number = 500
): { status: number; error: string } {
  return {
    status: statusCode,
    error: sanitizeError(error, context),
  };
}
