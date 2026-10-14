'use strict';

/*
 * Backend board registry.
 *
 * The canonical registry lives in frontend/js/board-registry.js so the client
 * and server can never drift apart. The backend re-exports it here as required
 * by the project structure. Validation endpoints recompute capabilities from
 * this registry and never trust pin data supplied by the browser.
 */

const path = require('path');

const registry = require(path.join(
  __dirname, '..', '..', '..', 'frontend', 'js', 'board-registry.js'
));

module.exports = registry;
