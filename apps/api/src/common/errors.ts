import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@remindora/database';
import type { Response } from 'express';
import * as Sentry from '@sentry/node';

/** Error helpers that produce the API's consistent `{ error: { code, message, details } }` shape. */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  notFound: (what = 'Resource') => new AppError(HttpStatus.NOT_FOUND, 'not_found', `${what} not found`),
  forbidden: (message = 'You do not have permission to do that') => new AppError(HttpStatus.FORBIDDEN, 'forbidden', message),
  unauthorized: (message = 'Authentication required', code = 'unauthorized') => new AppError(HttpStatus.UNAUTHORIZED, code, message),
  reauthRequired: () => new AppError(HttpStatus.FORBIDDEN, 'reauth_required', 'Please confirm it’s you before continuing'),
  badRequest: (message: string, code = 'bad_request', details?: unknown) => new AppError(HttpStatus.BAD_REQUEST, code, message, details),
  conflict: (message: string, details?: unknown, code = 'conflict') => new AppError(HttpStatus.CONFLICT, code, message, details),
  gone: (message: string, code = 'gone') => new AppError(HttpStatus.GONE, code, message),
  tooMany: (retryAfter: number) => new AppError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests, slow down', { retryAfter }),
  planLimit: (key: string, limit: number, label: string) =>
    new AppError(HttpStatus.PAYMENT_REQUIRED, 'plan_limit', `Your plan allows up to ${limit} ${label}. Upgrade to Premium for more.`, { key, limit }),
  planFeature: (feature: string) => new AppError(HttpStatus.PAYMENT_REQUIRED, 'plan_feature', 'This is a Premium feature.', { feature }),
  notConfigured: (what: string) => new AppError(HttpStatus.NOT_IMPLEMENTED, 'not_configured', `${what} is not configured on this server`),
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'object' && body && 'code' in body
          ? body
          : { code: status === 404 ? 'not_found' : 'http_error', message: typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message) };
      if (status === 429 && typeof payload === 'object' && 'details' in payload) {
        const retry = (payload as { details?: { retryAfter?: number } }).details?.retryAfter;
        if (retry) res.setHeader('Retry-After', String(retry));
      }
      res.status(status).json({ error: payload });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') return void res.status(404).json({ error: { code: 'not_found', message: 'Resource not found' } });
      if (exception.code === 'P2002') return void res.status(409).json({ error: { code: 'conflict', message: 'Already exists' } });
    }

    // Never echo internals; request bodies are never logged (they can hold codes/tokens).
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    Sentry.captureException(exception);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
  }
}
