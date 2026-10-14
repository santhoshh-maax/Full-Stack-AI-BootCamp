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

/** Follow Anthropic's cursor pagination (has_more / next_page) and collect all buckets. */
async function fetchAnthropicPages(baseUrlWithQuery) {
  const buckets = [];
  let page = null;
  for (let i = 0; i < 20; i++) {
    const url = baseUrlWithQuery + (page ? '&page=' + encodeURIComponent(page) : '');
    const response = await fetchWithTimeout(url, { headers: anthropicHeaders() });
    if (!response.ok) {
      const err = new Error('HTTP ' + response.status);
      err.status = response.status;
      err.detail = await readError(response);
      throw err;
    }
    const payload = await response.json();
    (Array.isArray(payload.data) ? payload.data : []).forEach(function (b) { buckets.push(b); });
    if (payload.has_more && payload.next_page) page = payload.next_page;
    else break;
  }
  return buckets;
}

async function fetchAnthropicUsage(range) {
  const usageUrl = baseUrl() + '/organizations/usage_report/messages'
    + '?starting_at=' + encodeURIComponent(range.start.toISOString())
    + '&ending_at=' + encodeURIComponent(range.end.toISOString())
    + '&bucket_width=1d&group_by%5B%5D=model&limit=31';

  let buckets;
  try {
    buckets = await fetchAnthropicPages(usageUrl);
  } catch (err) {
    return {
      available: false,
      reason: err.status
        ? 'Anthropic usage API returned ' + err.message
          + (err.detail ? ' (' + err.detail + ')' : '')
          + '. This endpoint requires an Admin API key (sk-ant-admin...).'
        : 'Anthropic usage request failed: ' + err.message
    };
  }

  let rows = normalizeAnthropicUsage({ data: buckets });
  if (range.model) rows = rows.filter(function (r) { return r.model === range.model; });
  const cost = await fetchAnthropicCost(range.start, range.end);

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

/** Total cost (USD) for the whole organization between two dates, or null if unavailable. */
async function fetchAnthropicCost(start, end) {
  const url = baseUrl() + '/organizations/cost_report'
    + '?starting_at=' + encodeURIComponent(start.toISOString())
    + '&ending_at=' + encodeURIComponent(end.toISOString())
    + '&bucket_width=1d&limit=31';

  let buckets;
  try {
    buckets = await fetchAnthropicPages(url);
  } catch (err) {
    return null;
  }

  let minorUnits = 0; // decimal strings in the lowest currency unit (cents)
  let currency = 'USD';
  buckets.forEach(function (bucket) {
    (bucket.results || []).forEach(function (r) {
      const amount = parseFloat(r.amount);
      if (isFinite(amount)) minorUnits += amount;
      if (r.currency) currency = r.currency;
    });
  });
  return { amount: minorUnits / 100, currency: currency };
}

/**
 * Credit balance. Neither Anthropic nor OpenAI exposes a prepaid-balance API, so
 * the balance is: AI_CREDIT_TOTAL (credits purchased/granted, set by the user)
 * minus overall provider-reported spend since AI_CREDIT_START (optional date).
 * Returns { configured:false } when AI_CREDIT_TOTAL is not set.
 */
async function fetchBalance(appTrackedCost) {
  const total = parseFloat(process.env.AI_CREDIT_TOTAL);
  if (!isFinite(total)) {
    return { configured: false, reason: 'Set AI_CREDIT_TOTAL (credits purchased, in USD) to enable the remaining balance.' };
  }
  const startRaw = process.env.AI_CREDIT_START;
  const start = startRaw && !isNaN(new Date(startRaw)) ? new Date(startRaw)
    : new Date(Date.now() - 365 * 86400000);

  let spent = null;
  let source = null;
  if (isEnabled() && isAnthropic()) {
    const cost = await fetchAnthropicCost(start, new Date());
    if (cost) { spent = cost.amount; source = 'provider-reported (overall)'; }
  }
  if (spent == null && appTrackedCost != null) {
    spent = appTrackedCost;
    source = 'application-tracked estimate (does not include other API usage)';
  }
  if (spent == null) {
    return { configured: true, available: false, total: total, reason: 'Spend could not be determined.' };
  }
  return {
    configured: true, available: true, total: total, spent: spent,
    remaining: Math.max(0, total - spent), source: source,
    since: start.toISOString(), currency: 'USD'
  };
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

module.exports = { isEnabled, isAnthropic, keyLabel, scope, fetchUsage, fetchBalance, summarize };

