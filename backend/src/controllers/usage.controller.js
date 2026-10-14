'use strict';

const usageService = require('../services/usage.service');
const providerUsage = require('../services/provider-usage.service');
const aiService = require('../services/ai.service');
const { resolveUsageRange } = require('../utils/validate');

function status(req, res) {
  const enabled = providerUsage.isEnabled();
  res.json({
    provider: aiService.providerName(),
    keyLabel: providerUsage.keyLabel(),
    scope: enabled ? providerUsage.scope() : 'application-tracked',
    providerUsage: {
      enabled: enabled,
      available: enabled,
      scope: providerUsage.scope(),
      reason: enabled
        ? 'Provider usage API is enabled; availability depends on the provider response '
          + '(Anthropic requires an Admin API key and reports organization-level usage).'
        : 'The provider usage API is disabled, so only application-tracked usage is shown.'
    },
    applicationTracking: true
  });
}

async function summary(req, res, next) {
  try {
    const range = resolveUsageRange(req.query);
    const appTracked = usageService.summarize(range);

    let providerReported = { available: false };
    const providerResult = await providerUsage.fetchUsage(range);
    if (providerResult.available) {
      const summarised = providerUsage.summarize(providerResult.rows);
      providerReported = Object.assign(
        { available: true, scope: providerResult.scope, currency: providerResult.currency || null },
        summarised
      );
      if (providerResult.cost != null) {
        providerReported.cost = providerResult.cost;
      }
    } else {
      providerReported = { available: false, reason: providerResult.reason };
    }

    const models = Array.from(new Set(
      (appTracked.models || []).concat(providerReported.models || [])
    )).sort();

    res.json({
      providerReported: providerReported,
      applicationTracked: appTracked,
      models: models,
      period: { start: range.start.toISOString(), end: range.end.toISOString() },
      lastUpdated: usageService.lastUpdated()
    });
  } catch (err) {
    next(err);
  }
}

async function details(req, res, next) {
  try {
    const range = resolveUsageRange(req.query);
    const providerResult = await providerUsage.fetchUsage(range);

    if (providerResult.available && providerResult.rows.length) {
      return res.json({
        source: 'provider-reported (' + providerResult.scope + ' scope)',
        rows: providerResult.rows
      });
    }

    const rows = usageService.details(range);
    res.json({
      source: 'application-tracked',
      rows: rows,
      message: rows.length
        ? null
        : 'No requests have been recorded by this application for the selected range.'
          + (providerResult.available ? '' : ' ' + providerResult.reason)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { status, summary, details };
