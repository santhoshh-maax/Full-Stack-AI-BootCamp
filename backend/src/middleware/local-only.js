'use strict';

const { AppError } = require('./errors');

/**
 * Restrict a route to local development machines.
 *
 * The usage dashboard is a local bootcamp prototype. Access control is required
 * before any public deployment; this guard blocks non-local callers by default.
 * Set USAGE_LOCALHOST_ONLY=false only when protected by your own authentication.
 */
function localOnly(req, res, next) {
  if (process.env.USAGE_LOCALHOST_ONLY === 'false') return next();

  const ip = (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
  const local = ['127.0.0.1', '::1', 'localhost', ''].includes(ip);
  if (local) return next();

  return next(new AppError(
    'FORBIDDEN_LOCAL_ONLY',
    'The usage dashboard is restricted to local development. Add authentication before '
      + 'exposing it publicly.',
    403
  ));
}

module.exports = { localOnly };
