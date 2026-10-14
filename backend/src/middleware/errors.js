'use strict';

/**
 * Application error with a stable machine-readable code and an HTTP status.
 */
class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status || 500;
    this.details = details;
    this.expose = true;
  }
}

function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'No route matches ' + req.method + ' ' + req.path }
  });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const body = {
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.expose ? err.message : 'An unexpected error occurred.'
    }
  };
  if (err.details) body.error.details = err.details;
  if (status >= 500) {
    // Log server errors only; never log request bodies (may contain prompts).
    console.error('[error]', err.code || err.name, '-', err.message);
  }
  res.status(status).json(body);
}

module.exports = { AppError, notFound, errorHandler };
