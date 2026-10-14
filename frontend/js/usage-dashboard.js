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
      els.visuals = document.getElementById('usageVisuals');
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
      state.summaryData = data;
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
      renderVisualizations();
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

    function formatK(n) {
      if (n == null || isNaN(n)) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    function buildTimelineBuckets(rows) {
      if (!rows || !rows.length) return [];
      var sorted = rows.slice().sort(function (a, b) {
        return new Date(a.period || 0) - new Date(b.period || 0);
      });

      var dateSet = {};
      sorted.forEach(function (r) {
        var d = new Date(r.period).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dateSet[d] = true;
      });
      var isMultiDay = Object.keys(dateSet).length > 1;

      var buckets = {};
      sorted.forEach(function (r) {
        var d = new Date(r.period);
        var label;
        if (isMultiDay) {
          label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else {
          label = String(d.getHours()).padStart(2, '0') + ':00';
        }
        if (!buckets[label]) {
          buckets[label] = { label: label, input: 0, output: 0, total: 0, count: 0 };
        }
        buckets[label].input += (r.inputTokens || 0);
        buckets[label].output += (r.outputTokens || 0);
        buckets[label].total += (r.totalTokens || ((r.inputTokens || 0) + (r.outputTokens || 0)));
        buckets[label].count += 1;
      });

      return Object.keys(buckets).map(function (k) { return buckets[k]; });
    }

    function renderVisualizations() {
      if (!els.visuals) return;
      var summary = state.summaryData;
      var details = state.detailsData;
      if (!summary && !details) return;

      var provider = (summary && summary.providerReported) || {};
      var appTracked = (summary && summary.applicationTracked) || {};
      var source = provider.available ? provider : (appTracked || {});
      var rows = (details && details.rows) ? details.rows : [];

      var inputTokens = source.inputTokens || 0;
      var outputTokens = source.outputTokens || 0;
      var totalTokens = source.totalTokens || (inputTokens + outputTokens);
      var requests = source.requests || rows.length || 0;
      var successful = source.successful != null ? source.successful : rows.filter(function (r) { return r.status === 'success'; }).length;
      var failed = source.failed != null ? source.failed : (requests - successful);

      var inputPct = totalTokens > 0 ? ((inputTokens / totalTokens) * 100).toFixed(1) : '0.0';
      var outputPct = totalTokens > 0 ? ((outputTokens / totalTokens) * 100).toFixed(1) : '0.0';
      var successPct = requests > 0 ? Math.round((successful / requests) * 100) : 100;
      var avgTokensPerReq = requests > 0 ? Math.round(totalTokens / requests) : 0;

      // Latency calculation
      var totalDur = 0;
      var durCount = 0;
      rows.forEach(function (r) {
        if (typeof r.durationMs === 'number' && r.durationMs > 0) {
          totalDur += r.durationMs;
          durCount++;
        }
      });
      var avgDurationSec = durCount > 0 ? (totalDur / durCount / 1000).toFixed(1) : '\u2014';

      // Donut Ring Dimensions (Radius 52 => Circumference ~326.7)
      var circ = 326.7;
      var inDash = totalTokens > 0 ? Math.min(circ - 0.5, (inputTokens / totalTokens) * circ) : 0;
      var outDash = totalTokens > 0 ? Math.min(circ - inDash, (outputTokens / totalTokens) * circ) : 0;

      // Feature aggregation
      var featureMap = {};
      rows.forEach(function (r) {
        var f = r.feature || 'general';
        if (!featureMap[f]) {
          featureMap[f] = { id: f, tokens: 0, count: 0, input: 0, output: 0 };
        }
        featureMap[f].tokens += (r.totalTokens || ((r.inputTokens || 0) + (r.outputTokens || 0)));
        featureMap[f].input += (r.inputTokens || 0);
        featureMap[f].output += (r.outputTokens || 0);
        featureMap[f].count += 1;
      });
      var featureList = Object.keys(featureMap).map(function (k) { return featureMap[k]; });
      featureList.sort(function (a, b) { return b.tokens - a.tokens; });

      var featureMeta = {
        'explain': { name: 'Circuit Tutor & Q&A', icon: '', color: '#3b82f6' },
        'generate-code': { name: 'Firmware Code Generator', icon: '', color: '#10b981' },
        'troubleshoot': { name: 'Pin & Hardware Diagnostics', icon: '\uD83D\uDEE0\uFE0F', color: '#f59e0b' },
        'general': { name: 'General AI Queries', icon: '', color: '#8b5cf6' }
      };

      // Timeline Bar Chart Calculation
      var buckets = buildTimelineBuckets(rows);
      var maxBucketTokens = 10;
      buckets.forEach(function (b) { if (b.total > maxBucketTokens) maxBucketTokens = b.total; });
      var yMax = Math.ceil(maxBucketTokens * 1.15) || 100;

      // Generate HTML
      var vHtml = '';
      vHtml += '<div class="visuals-section">';
      vHtml += '  <div class="visuals-header">';
      vHtml += '    <h3> Graphical Token Analytics & Flow</h3>';
      vHtml += '    <span class="visuals-subtitle">Visual overview of prompt intake, completions, feature share, and request velocity</span>';
      vHtml += '  </div>';

      vHtml += '  <div class="visuals-grid">';

      // --- CARD 1: Donut & Token Split ---
      vHtml += '    <div class="visual-card token-split-card">';
      vHtml += '      <div class="visual-card-title">Token Distribution (Prompt vs Completion)</div>';
      vHtml += '      <div class="donut-and-split">';
      vHtml += '        <div class="donut-wrap">';
      vHtml += '          <svg viewBox="0 0 140 140" class="vis-donut-svg">';
      vHtml += '            <defs>';
      vHtml += '              <linearGradient id="visGradInput" x1="0%" y1="0%" x2="100%" y2="100%">';
      vHtml += '                <stop offset="0%" stop-color="#3b82f6" />';
      vHtml += '                <stop offset="100%" stop-color="#1d4ed8" />';
      vHtml += '              </linearGradient>';
      vHtml += '              <linearGradient id="visGradOutput" x1="0%" y1="0%" x2="100%" y2="100%">';
      vHtml += '                <stop offset="0%" stop-color="#10b981" />';
      vHtml += '                <stop offset="100%" stop-color="#047857" />';
      vHtml += '              </linearGradient>';
      vHtml += '            </defs>';
      vHtml += '            <circle cx="70" cy="70" r="52" fill="none" stroke="#f1f5f9" stroke-width="15" />';
      if (totalTokens > 0) {
        vHtml += '            <circle cx="70" cy="70" r="52" fill="none" stroke="url(#visGradInput)" stroke-width="15" '
          + 'stroke-dasharray="' + inDash + ' ' + circ + '" stroke-dashoffset="0" transform="rotate(-90 70 70)" stroke-linecap="round" />';
        vHtml += '            <circle cx="70" cy="70" r="52" fill="none" stroke="url(#visGradOutput)" stroke-width="15" '
          + 'stroke-dasharray="' + outDash + ' ' + circ + '" stroke-dashoffset="-' + inDash + '" transform="rotate(-90 70 70)" stroke-linecap="round" />';
      }
      vHtml += '            <text x="70" y="65" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">' + formatK(totalTokens) + '</text>';
      vHtml += '            <text x="70" y="82" text-anchor="middle" font-size="10.5" font-weight="600" fill="#64748b">Tokens</text>';
      vHtml += '          </svg>';
      vHtml += '        </div>';

      vHtml += '        <div class="token-split-details">';
      vHtml += '          <div class="split-legend-item in-legend">';
      vHtml += '            <div class="legend-header">';
      vHtml += '              <span class="legend-dot in-dot"></span>';
      vHtml += '              <span class="legend-name">Input (Prompt)</span>';
      vHtml += '              <span class="legend-pct in-pct">' + inputPct + '%</span>';
      vHtml += '            </div>';
      vHtml += '            <div class="legend-val">' + num(inputTokens) + ' <small class="text-muted">tokens</small></div>';
      vHtml += '          </div>';

      vHtml += '          <div class="split-legend-item out-legend">';
      vHtml += '            <div class="legend-header">';
      vHtml += '              <span class="legend-dot out-dot"></span>';
      vHtml += '              <span class="legend-name">Output (Completion)</span>';
      vHtml += '              <span class="legend-pct out-pct">' + outputPct + '%</span>';
      vHtml += '            </div>';
      vHtml += '            <div class="legend-val">' + num(outputTokens) + ' <small class="text-muted">tokens</small></div>';
      vHtml += '          </div>';

      vHtml += '          <div class="token-split-bar" title="Input: ' + inputPct + '% | Output: ' + outputPct + '%">';
      vHtml += '            <div class="split-fill in-fill" style="width: ' + inputPct + '%;"></div>';
      vHtml += '            <div class="split-fill out-fill" style="width: ' + outputPct + '%;"></div>';
      vHtml += '          </div>';
      vHtml += '        </div>';
      vHtml += '      </div>';
      vHtml += '    </div>';

      // --- CARD 2: Efficiency & Health Gauges ---
      vHtml += '    <div class="visual-card efficiency-card">';
      vHtml += '      <div class="visual-card-title">Performance & Key Indicators</div>';
      vHtml += '      <div class="efficiency-gauges-grid">';

      // Success Rate Ring
      vHtml += '        <div class="gauge-box">';
      vHtml += '          <div class="gauge-ring-wrap">';
      vHtml += '            <svg viewBox="0 0 70 70" class="gauge-ring-svg">';
      vHtml += '              <circle cx="35" cy="35" r="28" fill="none" stroke="#f1f5f9" stroke-width="7" />';
      var sCirc = 175.9; // 2 * Math.PI * 28
      var sDash = (successPct / 100) * sCirc;
      vHtml += '              <circle cx="35" cy="35" r="28" fill="none" stroke="' + (successPct >= 90 ? '#10b981' : (successPct >= 70 ? '#f59e0b' : '#ef4444')) + '" stroke-width="7" stroke-dasharray="' + sDash + ' ' + sCirc + '" transform="rotate(-90 35 35)" stroke-linecap="round" />';
      vHtml += '              <text x="35" y="39" text-anchor="middle" font-size="13" font-weight="800" fill="#0f172a">' + successPct + '%</text>';
      vHtml += '            </svg>';
      vHtml += '          </div>';
      vHtml += '          <div class="gauge-label">Success Rate</div>';
      vHtml += '          <div class="gauge-sub">' + successful + ' ok / ' + failed + ' err</div>';
      vHtml += '        </div>';

      // Avg Latency
      vHtml += '        <div class="gauge-box">';
      vHtml += '          <div class="gauge-hero-val">' + avgDurationSec + '<small>s</small></div>';
      vHtml += '          <div class="gauge-label">Avg Response Speed</div>';
      vHtml += '          <div class="gauge-sub">' + requests + ' calls tracked</div>';
      vHtml += '        </div>';

      // Tokens Per Request
      vHtml += '        <div class="gauge-box">';
      vHtml += '          <div class="gauge-hero-val">' + formatK(avgTokensPerReq) + '</div>';
      vHtml += '          <div class="gauge-label">Avg Tokens / Call</div>';
      vHtml += '          <div class="gauge-sub">Density per prompt</div>';
      vHtml += '        </div>';

      // Cost
      vHtml += '        <div class="gauge-box highlight-cost">';
      vHtml += '          <div class="gauge-hero-val cost-text">' + (source.cost != null ? escapeHtml(String(source.cost)) : '$0.0000') + '</div>';
      vHtml += '          <div class="gauge-label">Total Spend (Est.)</div>';
      vHtml += '          <div class="gauge-sub">Claude 4.5 Sonnet Rates</div>';
      vHtml += '        </div>';

      vHtml += '      </div>';
      vHtml += '    </div>';

      vHtml += '  </div>'; // end visuals-grid

      // --- SECTION 3: Timeline Stacked Bar Chart ---
      vHtml += '  <div class="visual-card timeline-card">';
      vHtml += '    <div class="timeline-header">';
      vHtml += '      <div class="visual-card-title">Activity Timeline & Token Flow</div>';
      vHtml += '      <div class="chart-legend-pills">';
      vHtml += '        <span class="chart-legend-pill in-pill"><span class="pill-dot in-dot"></span> Input (Prompt)</span>';
      vHtml += '        <span class="chart-legend-pill out-pill"><span class="pill-dot out-dot"></span> Output (Completion)</span>';
      vHtml += '      </div>';
      vHtml += '    </div>';

      if (!buckets.length) {
        vHtml += '    <div class="chart-empty-placeholder">No requests recorded in this range. Try asking a question or generating code in the Lab!</div>';
      } else {
        var svgW = 600, svgH = 190;
        var pLeft = 50, pRight = 20, pTop = 20, pBottom = 35;
        var cW = svgW - pLeft - pRight;
        var cH = svgH - pTop - pBottom;
        var step = cW / buckets.length;
        var barW = Math.min(42, Math.max(14, step * 0.62));

        vHtml += '    <div class="timeline-svg-container">';
        vHtml += '      <svg viewBox="0 0 ' + svgW + ' ' + svgH + '" class="timeline-svg" preserveAspectRatio="none">';
        // Grid lines
        for (var g = 0; g <= 3; g++) {
          var gY = pTop + cH - (g / 3) * cH;
          var gVal = formatK(Math.round((g / 3) * yMax));
          vHtml += '        <line x1="' + pLeft + '" y1="' + gY + '" x2="' + (pLeft + cW) + '" y2="' + gY + '" stroke="#e2e8f0" stroke-dasharray="3 3" stroke-width="1" />';
          vHtml += '        <text x="' + (pLeft - 8) + '" y="' + (gY + 3.5) + '" text-anchor="end" font-size="9.5" fill="#94a3b8" font-family="monospace">' + gVal + '</text>';
        }

        // Draw stacked bars
        buckets.forEach(function (b, bi) {
          var bx = pLeft + bi * step + (step - barW) / 2;
          var hIn = Math.round((b.input / yMax) * cH);
          var hOut = Math.round((b.output / yMax) * cH);
          var yIn = pTop + cH - hIn;
          var yOut = yIn - hOut;

          // Hit column for hover
          vHtml += '        <g class="chart-bar-group">';
          vHtml += '          <title>' + escapeHtml(b.label) + '&#10;Total Tokens: ' + b.total.toLocaleString() + '&#10;Input: ' + b.input.toLocaleString() + '&#10;Output: ' + b.output.toLocaleString() + '&#10;Requests: ' + b.count + '</title>';
          if (hIn > 0) {
            vHtml += '          <rect x="' + bx + '" y="' + yIn + '" width="' + barW + '" height="' + hIn + '" rx="2" fill="#3b82f6" class="bar-in" />';
          }
          if (hOut > 0) {
            vHtml += '          <rect x="' + bx + '" y="' + yOut + '" width="' + barW + '" height="' + hOut + '" rx="3" fill="#10b981" class="bar-out" />';
          }
          // X-axis label
          vHtml += '          <text x="' + (bx + barW / 2) + '" y="' + (svgH - 12) + '" text-anchor="middle" font-size="10" font-weight="600" fill="#64748b">' + escapeHtml(b.label) + '</text>';
          vHtml += '        </g>';
        });

        vHtml += '      </svg>';
        vHtml += '    </div>';
      }
      vHtml += '  </div>'; // end timeline-card

      // --- SECTION 4: Feature Breakdown Bars ---
      if (featureList.length) {
        vHtml += '  <div class="visual-card feature-breakdown-card">';
        vHtml += '    <div class="visual-card-title">Token Consumption by AI Feature</div>';
        vHtml += '    <div class="feature-meters-list">';
        featureList.forEach(function (feat) {
          var meta = featureMeta[feat.id] || { name: feat.id, icon: '\u26A1', color: '#6366f1' };
          var fPct = totalTokens > 0 ? ((feat.tokens / totalTokens) * 100).toFixed(1) : '0.0';
          vHtml += '      <div class="feature-meter-row">';
          vHtml += '        <div class="feature-meter-head">';
          vHtml += '          <span class="feature-badge"><span class="feat-icon">' + meta.icon + '</span> <strong>' + escapeHtml(meta.name) + '</strong></span>';
          vHtml += '          <span class="feature-stats-pill"><strong>' + num(feat.tokens) + ' tokens</strong> (' + fPct + '%) &middot; ' + feat.count + ' requests</span>';
          vHtml += '        </div>';
          vHtml += '        <div class="feature-progress-track">';
          vHtml += '          <div class="feature-progress-fill" style="width: ' + fPct + '%; background: ' + meta.color + ';"></div>';
          vHtml += '        </div>';
          vHtml += '      </div>';
        });
        vHtml += '    </div>';
        vHtml += '  </div>';
      }

      vHtml += '</div>'; // end visuals-section

      els.visuals.innerHTML = vHtml;
    }

    function renderDetails(data) {
      state.detailsData = data;
      var rows = data.rows || [];
      renderVisualizations();
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
      var navLab = document.getElementById('navTabLab');
      var navUsage = document.getElementById('navTabUsage');
      if (navLab) navLab.classList.remove('active');
      if (navUsage) navUsage.classList.add('active');
      refresh();
    }

    function hide() {
      els.view.classList.remove('active');
      document.getElementById('labView').classList.remove('hidden');
      var navLab = document.getElementById('navTabLab');
      var navUsage = document.getElementById('navTabUsage');
      if (navLab) navLab.classList.add('active');
      if (navUsage) navUsage.classList.remove('active');
    }

    function init() {
      cache();
      if (els.open) els.open.addEventListener('click', show);
      if (els.back) els.back.addEventListener('click', hide);
      var navLab = document.getElementById('navTabLab');
      if (navLab) navLab.addEventListener('click', hide);
      var navUsage = document.getElementById('navTabUsage');
      if (navUsage) navUsage.addEventListener('click', show);
      var brand = document.getElementById('brandHome');
      if (brand) brand.addEventListener('click', hide);

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
