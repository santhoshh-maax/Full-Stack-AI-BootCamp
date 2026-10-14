'use strict';

/*
 * usage.service.js
 *
 * Application-tracked usage for the single AI API key configured in the
 * backend environment. Records ONLY metadata returned by the AI provider
 * (timestamp, model, feature, token counts, status, duration). It never stores
 * API keys, authorization headers, full prompts or personal content.
 *
 * This is deliberately separate from provider-reported usage; the two are
 * never summed unless the scope is validated and explained in the dashboard.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'usage.json');

let records = [];
let saveTimer = null;
const MAX_RECORDS = 5000;

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.records)) records = parsed.records.slice(-MAX_RECORDS);
    }
  } catch (err) {
    console.warn('[usage] Could not load usage file:', err.message);
    records = [];
  }
}

function persistNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    records = records.slice(-MAX_RECORDS);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ records }, null, 2));
  } catch (err) {
    console.warn('[usage] Could not persist usage file:', err.message);
  }
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 500);
}

/**
 * Record one AI request's metadata.
 * @param {{model:string, feature:string, inputTokens?:number, outputTokens?:number,
 *          totalTokens?:number, status:string, durationMs:number}} entry
 */
function record(entry) {
  records.push({
    timestamp: new Date().toISOString(),
    model: entry.model || 'unknown',
    feature: entry.feature || 'unknown',
    inputTokens: typeof entry.inputTokens === 'number' ? entry.inputTokens : null,
    outputTokens: typeof entry.outputTokens === 'number' ? entry.outputTokens : null,
    totalTokens: typeof entry.totalTokens === 'number' ? entry.totalTokens : null,
    status: entry.status || 'unknown',
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null
  });
  persist();
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function summarize(range) {
  const filtered = records.filter(function (r) {
    return inRange(r.timestamp, range.start, range.end)
      && (!range.model || r.model === range.model);
  });

  const summary = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: filtered.length,
    successful: 0,
    failed: 0,
    cost: null,
    models: []
  };
  const modelSet = {};
  filtered.forEach(function (r) {
    if (typeof r.inputTokens === 'number') summary.inputTokens += r.inputTokens;
    if (typeof r.outputTokens === 'number') summary.outputTokens += r.outputTokens;
    if (typeof r.totalTokens === 'number') summary.totalTokens += r.totalTokens;
    if (r.status === 'success') summary.successful += 1;
    else summary.failed += 1;
    modelSet[r.model] = true;
  });
  summary.models = Object.keys(modelSet);
  // Cost is intentionally null: no verified pricing is configured.
  return summary;
}

function details(range) {
  return records
    .filter(function (r) {
      return inRange(r.timestamp, range.start, range.end)
        && (!range.model || r.model === range.model);
    })
    .map(function (r) {
      return {
        period: r.timestamp,
        model: r.model,
        feature: r.feature,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        requests: 1,
        cost: null,
        status: r.status,
        durationMs: r.durationMs
      };
    })
    .reverse();
}

function lastUpdated() {
  if (!records.length) return null;
  return records[records.length - 1].timestamp;
}

module.exports = { load, record, summarize, details, lastUpdated };
