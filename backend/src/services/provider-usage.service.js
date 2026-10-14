'use strict';

/*
 * provider-usage.service.js
 *
 * Provider-specific retrieval of usage / billing data for the configured AI
 * account. Kept in its own module because providers expose different endpoints
 * and response shapes.
 *
 * Supported:
 *   - Anthropic Admin "Usage & Cost" API
 *       GET /v1/organizations/usage_report/messages
 *       GET /v1/organizations/cost_report
 *     These require an Admin API key (sk-ant-admin...) and report ORG-level
 *     (account/project) usage, not usage scoped to a single API key.
 *   - OpenAI-compatible organization usage endpoint (best effort).
 *
 * This module only calls a documented usage endpoint when explicitly enabled
 * via environment variables and returns { available:false, reason } otherwise.
 * It never invents token counts, quotas or costs.
 */

const PROVIDER_TIMEOUT_MS = 15000;

function isEnabled() {
  return process.env.AI_USAGE_API_ENABLED === 'true' && !!process.env.AI_USAGE_API_KEY;
}

function providerName() {
  return (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
}

function isAnthropic() {
  const base = process.env.AI_USAGE_BASE_URL || process.env.AI_BASE_URL || '';
  return providerName() === 'anthropic' || providerName() === 'claude'
    || /anthropic\.com/.test(base);
}

function baseUrl() {
  return (process.env.AI_USAGE_BASE_URL || process.env.AI_BASE_URL
    || 'https://api.anthropic.com/v1').replace(/\/$/, '');
}

/** Return a safe label for the configured key without ever exposing it. */
function keyLabel() {
  const key = process.env.AI_API_KEY || '';
  if (!key) return 'Not configured';
  const suffix = key.length >= 4 ? key.slice(-4) : '';
  return suffix ? 'Configured API key \u2022\u2022\u2022\u2022' + suffix : 'Configured API key';
}

function scope() {
  return process.env.AI_USAGE_SCOPE === 'key' ? 'key' : 'account';
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function anthropicHeaders() {
  return {
    'x-api-key': process.env.AI_USAGE_API_KEY,
    'anthropic-version': '2023-06-01'
  };
}

async function readError(response) {
  try {
    const data = await response.json();
    if (data && data.error && data.error.message) return data.error.message;
  } catch (e) { /* ignore */ }
  return '';
}

/**
 * Attempt to read provider usage. Returns:
 *   { available:true, rows:[...], cost?, currency?, scope, period }
 * or
 *   { available:false, reason }
 */
async function fetchUsage(range) {
  if (!isEnabled()) {
    return {
      available: false,
      reason: 'Provider usage API is not enabled. Set AI_USAGE_API_ENABLED=true and '
        + 'AI_USAGE_API_KEY (an admin-scoped key) only if your provider exposes a usage endpoint.'
    };
  }
  if (isAnthropic()) return fetchAnthropicUsage(range);
  return fetchOpenAICompatibleUsage(range);
}

async function fetchAnthropicUsage(range) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const days = Math.min(31, Math.max(1, Math.ceil((range.end - range.start) / 86400000)));

  const usageUrl = baseUrl() + '/organizations/usage_report/messages'
    + '?starting_at=' + encodeURIComponent(startISO)
    + '&ending_at=' + encodeURIComponent(endISO)
    + '&bucket_width=1d&group_by%5B%5D=model&limit=' + days;

  let response;
  try {
    response = await fetchWithTimeout(usageUrl, { headers: anthropicHeaders() });
  } catch (err) {
    return { available: false, reason: 'Anthropic usage request failed: ' + err.message };
  }

  if (!response.ok) {
    const detail = await readError(response);
    return {
      available: false,
      reason: 'Anthropic usage API returned HTTP ' + response.status
        + (detail ? ' (' + detail + ')' : '')
        + '. This endpoint requires an Admin API key (sk-ant-admin...).'
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return { available: false, reason: 'Anthropic usage response was not valid JSON.' };
  }

  const rows = normalizeAnthropicUsage(payload);
  const cost = await fetchAnthropicCost(range);

  return {
    available: true,
    scope: scope(),
    rows: rows,
    cost: cost ? cost.amount : null,
    currency: cost ? cost.currency : null,
    period: range
  };
}

function normalizeAnthropicUsage(payload) {
  const rows = [];
  const buckets = Array.isArray(payload.data) ? payload.data : [];
  buckets.forEach(function (bucket) {
    const results = Array.isArray(bucket.results) ? bucket.results : [];
    results.forEach(function (r) {
      const cacheCreation = r.cache_creation || {};
      const inputTokens = (r.uncached_input_tokens || 0)
        + (r.cache_read_input_tokens || 0)
        + (cacheCreation.ephemeral_5m_input_tokens || 0)
        + (cacheCreation.ephemeral_1h_input_tokens || 0);
      const outputTokens = r.output_tokens || 0;
      if (!inputTokens && !outputTokens) return;
      rows.push({
        period: bucket.starting_at || null,
        model: r.model || 'unknown',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        requests: null,
        cost: null
      });
    });
  });
  return rows;
}

async function fetchAnthropicCost(range) {
  const url = baseUrl() + '/organizations/cost_report'
    + '?starting_at=' + encodeURIComponent(range.start.toISOString())
    + '&ending_at=' + encodeURIComponent(range.end.toISOString())
    + '&bucket_width=1d';

  let response;
  try {
    response = await fetchWithTimeout(url, { headers: anthropicHeaders() });
  } catch (err) {
    return null;
  }
  if (!response.ok) return null;

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return null;
  }

  let minorUnits = 0; // amounts are decimal strings in the lowest currency unit (cents)
  let currency = 'USD';
  const buckets = Array.isArray(payload.data) ? payload.data : [];
  buckets.forEach(function (bucket) {
    (bucket.results || []).forEach(function (r) {
      const amount = parseFloat(r.amount);
      if (isFinite(amount)) minorUnits += amount;
      if (r.currency) currency = r.currency;
    });
  });
  return { amount: minorUnits / 100, currency: currency };
}

async function fetchOpenAICompatibleUsage(range) {
  const url = baseUrl()
    + '/organization/usage/completions'
    + '?start_time=' + Math.floor(range.start.getTime() / 1000)
    + '&end_time=' + Math.floor(range.end.getTime() / 1000)
    + '&bucket_width=1d&limit=31&group_by=model';

  let response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { Authorization: 'Bearer ' + process.env.AI_USAGE_API_KEY }
    });
  } catch (err) {
    return { available: false, reason: 'Provider usage request failed: ' + err.message };
  }

  if (!response.ok) {
    const detail = await readError(response);
    return {
      available: false,
      reason: 'Provider returned HTTP ' + response.status
        + (detail ? ' (' + detail + ')' : '')
        + '. Usage may require an admin-scoped key or an unsupported endpoint.'
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return { available: false, reason: 'Provider usage response was not valid JSON.' };
  }

  const rows = [];
  (payload.data || []).forEach(function (bucket) {
    (bucket.results || []).forEach(function (r) {
      if (!r.input_tokens && !r.output_tokens && !r.num_model_requests) return;
      rows.push({
        period: bucket.start_time ? new Date(bucket.start_time * 1000).toISOString() : null,
        model: r.model || 'unknown',
        inputTokens: r.input_tokens != null ? r.input_tokens : null,
        outputTokens: r.output_tokens != null ? r.output_tokens : null,
        totalTokens: (r.input_tokens || 0) + (r.output_tokens || 0),
        requests: r.num_model_requests != null ? r.num_model_requests : null,
        cost: null
      });
    });
  });
  return { available: true, scope: scope(), rows: rows, cost: null, currency: null, period: range };
}

function summarize(rows) {
  const summary = {
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    requests: 0, successful: null, failed: null, cost: null, models: []
  };
  const modelSet = {};
  rows.forEach(function (r) {
    summary.inputTokens += r.inputTokens || 0;
    summary.outputTokens += r.outputTokens || 0;
    summary.totalTokens += r.totalTokens || 0;
    if (r.requests != null) summary.requests += r.requests;
    modelSet[r.model] = true;
  });
  summary.models = Object.keys(modelSet);
  return summary;
}

module.exports = { isEnabled, isAnthropic, keyLabel, scope, fetchUsage, summarize };
