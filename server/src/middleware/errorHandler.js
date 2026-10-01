import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'That route does not exist.', 'not_found'));
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error(error.cause || error);
  }
  const message = status >= 500 && env.isProd
    ? 'Something went wrong. Try again.'
    : error.message || 'Something went wrong. Try again.';
  res.status(status).json({
    success: false,
    error: {
      code: error.code || 'internal_error',
      message,
      details: status === 422 ? error.details : undefined
    }
  });
}
