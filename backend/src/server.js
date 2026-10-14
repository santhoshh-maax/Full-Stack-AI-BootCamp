'use strict';

/*
 * server.js
 * Express entry point for the Microcontroller AI Lab backend.
 *
 * - Serves the static frontend.
 * - Exposes REST endpoints under /api.
 * - Proxies all AI requests so credentials never reach the browser.
 * - Reads configuration from backend/.env (see .env.example).
 */

const path = require('path');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const apiRoutes = require('./routes');
const usageService = require('./services/usage.service');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', false);

// --- CORS (local development) --------------------------------------
// The frontend may be opened from the Express server or from a local file /
// dev server. This allows local origins; add strict origin checks before any
// public deployment.
app.use(function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// --- Body parsing with a sensible size limit -----------------------
app.use(express.json({ limit: '256kb' }));

// --- Minimal request logging (never logs bodies or headers) --------
app.use(function logRequest(req, res, next) {
  const started = Date.now();
  res.on('finish', function () {
    console.log(req.method + ' ' + req.originalUrl + ' -> ' + res.statusCode
      + ' (' + (Date.now() - started) + 'ms)');
  });
  next();
});

// --- Static frontend ------------------------------------------------
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// --- API ------------------------------------------------------------
app.use('/api', apiRoutes);

// --- 404 + error handling ------------------------------------------
app.use(notFound);
app.use(errorHandler);

// --- Startup --------------------------------------------------------
usageService.load();

app.listen(PORT, function () {
  console.log('Microcontroller AI Lab backend listening on http://localhost:' + PORT);
  console.log('  Board registry : loaded (Arduino Uno R3, ESP32 DevKit)');
  console.log('  AI provider     : ' + (process.env.AI_PROVIDER || 'openai-compatible')
    + ' (key ' + (process.env.AI_API_KEY ? 'configured' : 'NOT configured') + ')');
  if (!process.env.AI_API_KEY) {
    console.log('  NOTE: set AI_API_KEY in backend/.env to enable AI features.');
  }
});

module.exports = app;
