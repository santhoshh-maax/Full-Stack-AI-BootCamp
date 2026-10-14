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

// Standard token pricing rates in USD per 1,000,000 tokens (1M tokens)
const MODEL_PRICING = {
  // Claude 3.5 / 3.7 / 4.5 Sonnet: $3.00 input / $15.00 output
  'claude-sonnet-4-5-20250929': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-sonnet-4-5': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-sonnet-4-6': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-sonnet-5': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-sonnet-5-5': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-3-5-sonnet-20241022': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-3-5-sonnet-latest': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-3-7-sonnet-20250219': { inputPerM: 3.00, outputPerM: 15.00 },
  'claude-3-7-sonnet-latest': { inputPerM: 3.00, outputPerM: 15.00 },

  // Claude 3.5 / 4.5 / 5.5 Haiku: $0.80 input / $4.00 output
  'claude-haiku-4-5-20251001': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-haiku-4-5': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-haiku-5-5': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-3-5-haiku-20241022': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-3-5-haiku-latest': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-3-haiku-20240307': { inputPerM: 0.25, outputPerM: 1.25 },

  // Claude 3 / 4.5 / 5.5 Opus: $15.00 input / $75.00 output
  'claude-opus-4-5-20251101': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-4-6': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-4-7': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-4-8': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-5': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-5-5': { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-3-opus-20240229': { inputPerM: 15.00, outputPerM: 75.00 },

  // OpenAI models
  'gpt-4o': { inputPerM: 2.50, outputPerM: 10.00 },
  'gpt-4o-2024-08-06': { inputPerM: 2.50, outputPerM: 10.00 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.60 },
  'gpt-4o-mini-2024-07-18': { inputPerM: 0.15, outputPerM: 0.60 },
  'gpt-4-turbo': { inputPerM: 10.00, outputPerM: 30.00 },
  'gpt-3.5-turbo': { inputPerM: 0.50, outputPerM: 1.50 }
};

function getModelPricing(modelName) {
  if (!modelName) return { inputPerM: 3.00, outputPerM: 15.00 };
  const lower = modelName.toLowerCase();
  if (MODEL_PRICING[lower]) return MODEL_PRICING[lower];

  if (lower.includes('haiku')) return { inputPerM: 0.80, outputPerM: 4.00 };
  if (lower.includes('opus')) return { inputPerM: 15.00, outputPerM: 75.00 };
  if (lower.includes('mini')) return { inputPerM: 0.15, outputPerM: 0.60 };
  if (lower.includes('sonnet')) return { inputPerM: 3.00, outputPerM: 15.00 };

  return { inputPerM: 3.00, outputPerM: 15.00 };
}

function calculateCost(model, inputTokens, outputTokens) {
  if (typeof inputTokens !== 'number' && typeof outputTokens !== 'number') {
    return 0;
  }
  const pricing = getModelPricing(model);
  const inCost = ((inputTokens || 0) / 1000000) * pricing.inputPerM;
  const outCost = ((outputTokens || 0) / 1000000) * pricing.outputPerM;
  return inCost + outCost;
}

function formatCost(amount) {
  if (amount == null || isNaN(amount)) return '$0.0000';
  if (amount === 0) return '$0.0000';
  if (amount < 0.0001) return '< $0.0001';
  return '$' + amount.toFixed(4);
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
    cost: '$0.0000',
    rawCost: 0,
    models: []
  };
  const modelSet = {};
  let totalCost = 0;

  filtered.forEach(function (r) {
    if (typeof r.inputTokens === 'number') summary.inputTokens += r.inputTokens;
    if (typeof r.outputTokens === 'number') summary.outputTokens += r.outputTokens;
    if (typeof r.totalTokens === 'number') summary.totalTokens += r.totalTokens;
    if (r.status === 'success') {
      summary.successful += 1;
      totalCost += calculateCost(r.model, r.inputTokens, r.outputTokens);
    } else {
      summary.failed += 1;
    }
    modelSet[r.model] = true;
  });

  summary.models = Object.keys(modelSet);
  summary.rawCost = totalCost;
  summary.cost = formatCost(totalCost);
  return summary;
}

function details(range) {
  return records
    .filter(function (r) {
      return inRange(r.timestamp, range.start, range.end)
        && (!range.model || r.model === range.model);
    })
    .map(function (r) {
      const costAmount = r.status === 'success'
        ? calculateCost(r.model, r.inputTokens, r.outputTokens)
        : 0;
      return {
        period: r.timestamp,
        model: r.model,
        feature: r.feature,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        requests: 1,
        cost: formatCost(costAmount),
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

module.exports = { load, record, summarize, details, lastUpdated, calculateCost, formatCost, getModelPricing };
