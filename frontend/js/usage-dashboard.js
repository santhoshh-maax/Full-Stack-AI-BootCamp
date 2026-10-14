/*
 * usage-dashboard.js
 * Frontend for the AI API Key Usage dashboard.
 *
 * Shows usage for the SINGLE AI API key configured in the backend environment.
 * It never receives or displays the full key. It clearly distinguishes
 * provider-reported usage from application-tracked usage supplied by this
 * backend, and it never invents token counts or costs.
 */

(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function num(v) {
    if (v == null || v === '') return '\u2014';
    if (typeof v !== 'number') return escapeHtml(v);
    return v.toLocaleString();
  }

  function create() {
    var els = {};
    var state = { models: [] };

    function cache() {
      els.view = document.getElementById('usageView');
      els.open = document.getElementById('btnOpenUsage');
      els.back = document.getElementById('btnUsageBack');
      els.refresh = document.getElementById('btnUsageRefresh');
      els.range = document.getElementById('usageRange');
      els.custom = document.getElementById('usageCustom');
      els.start = document.getElementById('usageStart');
      els.end = document.getElementById('usageEnd');
      els.model = document.getElementById('usageModel');
      els.scopeNote = document.getElementById('usageScope');
      els.status = document.getElementById('usageStatus');
      els.cards = document.getElementById('usageCards');
      els.table = document.getElementById('usageTable');
      els.keyLabel = document.getElementById('usageKeyLabel');
      els.updated = document.getElementById('usageUpdated');
    }

    function endpoint(path) {
      var base = global.API_BASE || '';
      return base + path;
    }

    function getJSON(path) {
      return fetch(endpoint(path)).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var msg = (data.error && data.error.message) || ('Request failed (' + res.status + ')');
            var err = new Error(msg);
            throw err;
          }
          return data;
        });
      });
    }

    function query() {
      var params = [];
      var range = els.range.value;
      if (range === 'custom') {
        if (els.start.value) params.push('start=' + encodeURIComponent(els.start.value));
        if (els.end.value) params.push('end=' + encodeURIComponent(els.end.value));
      } else {
        params.push('range=' + encodeURIComponent(range));
      }
      if (els.model.value && els.model.value !== 'all') {
        params.push('model=' + encodeURIComponent(els.model.value));
      }
      return params.length ? '?' + params.join('&') : '';
    }

    function loadStatus() {
      return getJSON('/api/usage/status').then(function (data) {
        state.status = data;
        if (els.keyLabel) {
          els.keyLabel.textContent = data.keyLabel || 'Configured API key';
        }
        els.scopeNote.innerHTML = buildScopeNote(data);
      }).catch(function (err) {
        if (els.scopeNote) {
          els.scopeNote.innerHTML = '<p class="usage-warn">Could not read usage status: '
            + escapeHtml(err.message) + '</p>';
        }
      });
    }

    function buildScopeNote(data) {
      var parts = [];
      parts.push('<p><strong>Provider:</strong> ' + escapeHtml(data.provider || 'unknown')
        + ' &nbsp;|&nbsp; <strong>Scope:</strong> ' + escapeHtml(data.scope || 'unknown') + '</p>');
      if (data.providerUsage && data.providerUsage.available) {
        parts.push('<p class="usage-ok">Provider-reported usage is available for this '
          + 'configured key scope.</p>');
      } else if (data.providerUsage) {
        parts.push('<p class="usage-warn"><strong>Unavailable from provider.</strong> '
          + escapeHtml(data.providerUsage.reason || 'The provider did not supply usage data for this key.')
          + ' Only application-tracked usage is shown.</p>');
      }
      parts.push('<p class="muted">Provider-reported and application-tracked figures are '
        + 'kept separate and are never summed into a single total unless the source is '
        + 'identified.</p>');
      return parts.join('');
    }

    function card(label, value, note) {
      return '<div class="usage-card"><div class="usage-card-value">' + value
        + '</div><div class="usage-card-label">' + escapeHtml(label) + '</div>'
        + (note ? '<div class="usage-card-note">' + escapeHtml(note) + '</div>' : '')
        + '</div>';
    }

    function loadSummary() {
      els.status.textContent = 'Loading usage\u2026';
      return getJSON('/api/usage/summary' + query()).then(function (data) {
        renderSummary(data);
        els.status.textContent = '';
      }).catch(function (err) {
        els.status.textContent = 'Usage load failed: ' + err.message;
      });
    }

    function renderSummary(data) {
      var provider = data.providerReported || {};
      var appTracked = data.applicationTracked || {};
      var source = provider.available ? provider : appTracked;

      state.models = (data.models || source.models || []).slice();
      populateModels();

      var html = '';
      html += '<div class="usage-group">';
      html += '<h4>Source: '
        + (provider.available ? 'Provider-reported (authoritative)' : 'Application-tracked')
        + '</h4>';
      html += '<div class="usage-cards">';
      html += card('Input / prompt tokens', num(source.inputTokens));
      html += card('Output / completion tokens', num(source.outputTokens));
      html += card('Total tokens', num(source.totalTokens));
      html += card('API requests', num(source.requests));
      html += card('Successful', num(source.successful));
      html += card('Failed', num(source.failed));
      html += card('Cost', source.cost != null ? escapeHtml(String(source.cost)) : '$0.0000',
        provider.available ? 'Provider-reported' : 'Estimated (token rates)');
      html += '</div></div>';

      if (data.period) {
        els.updated.textContent = 'Period: ' + (data.period.start || '?') + ' \u2192 '
          + (data.period.end || '?') + '  \u00B7  Updated: '
          + (data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'unknown');
      }

      els.cards.innerHTML = html;
    }

    function populateModels() {
      var current = els.model.value;
      els.model.innerHTML = '<option value="all">All models</option>';
      state.models.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        els.model.appendChild(opt);
      });
      if (state.models.indexOf(current) !== -1) els.model.value = current;
    }

    function loadDetails() {
      els.table.innerHTML = '<p class="muted">Loading details\u2026</p>';
      return getJSON('/api/usage/details' + query()).then(function (data) {
        renderDetails(data);
      }).catch(function (err) {
        els.table.innerHTML = '<p class="usage-warn">Details unavailable: '
          + escapeHtml(err.message) + '</p>';
      });
    }

    function renderDetails(data) {
      var rows = data.rows || [];
      if (!rows.length) {
        els.table.innerHTML = '<p class="muted">' + escapeHtml(
          data.message || 'No usage details available for this range.') + '</p>';
        return;
      }
      var cols = ['period', 'model', 'inputTokens', 'outputTokens', 'totalTokens', 'requests', 'cost'];
      var labels = {
        period: 'Period / timestamp', model: 'Model', inputTokens: 'Input',
        outputTokens: 'Output', totalTokens: 'Total', requests: 'Requests', cost: 'Cost'
      };
      var html = '<p class="muted">Source: ' + escapeHtml(data.source || 'unknown') + '</p>';
      html += '<table class="usage-table"><thead><tr>';
      cols.forEach(function (c) { html += '<th>' + labels[c] + '</th>'; });
      html += '</tr></thead><tbody>';
      rows.forEach(function (row) {
        html += '<tr>';
        cols.forEach(function (c) {
          var v = row[c];
          if (c === 'period' && v) v = new Date(v).toLocaleString();
          else if (['inputTokens', 'outputTokens', 'totalTokens', 'requests'].indexOf(c) !== -1) v = num(v);
          else v = escapeHtml(v == null ? '\u2014' : v);
          html += '<td>' + v + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      els.table.innerHTML = html;
    }

    function refresh() {
      loadStatus().then(function () {
        loadSummary();
        loadDetails();
      });
    }

    function show() {
      els.view.classList.add('active');
      document.getElementById('labView').classList.add('hidden');
      refresh();
    }

    function hide() {
      els.view.classList.remove('active');
      document.getElementById('labView').classList.remove('hidden');
    }

    function init() {
      cache();
      els.open.addEventListener('click', show);
      els.back.addEventListener('click', hide);
      els.refresh.addEventListener('click', refresh);
      els.range.addEventListener('change', function () {
        els.custom.style.display = els.range.value === 'custom' ? '' : 'none';
        refresh();
      });
      els.model.addEventListener('change', function () { loadDetails(); });
      els.start.addEventListener('change', refresh);
      els.end.addEventListener('change', refresh);
      populateModels();
    }

    return { init: init, show: show, hide: hide, refresh: refresh };
  }

  var api = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.UsageDashboard = api;
  }
})(typeof window !== 'undefined' ? window : this);
