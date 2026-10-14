/*
 * ai-client.js
 * Frontend client for the AI Electronics Tutor. All AI calls go through the
 * Node backend; no API key is ever present in this code.
 */

(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderMarkdownLite(text) {
    if (!text) return '';
    var safe = escapeHtml(text);
    // Normalize newlines
    safe = safe.replace(/\r\n/g, '\n');
    // Fenced code blocks
    safe = safe.replace(/```([a-zA-Z0-9_+\-]*)[ \t]*\n([\s\S]*?)```/g, function (m, lang, code) {
      return '<pre class="chat-code">' + code.replace(/\n$/, '') + '</pre>';
    });
    // Inline code
    safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bold
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Headers
    safe = safe.replace(/^### (.*$)/gim, '<strong style="display:block;margin-top:6px;font-size:13px;">$1</strong>');
    safe = safe.replace(/^## (.*$)/gim, '<strong style="display:block;margin-top:8px;font-size:14px;color:var(--blue-dark);">$1</strong>');
    safe = safe.replace(/^# (.*$)/gim, '<strong style="display:block;margin-top:10px;font-size:15px;color:var(--blue-dark);">$1</strong>');
    // Convert newlines to <br>
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  function create(lab) {
    var els = {};

    function cache() {
      els.messages = document.getElementById('chatMessages');
      els.input = document.getElementById('chatInput');
      els.send = document.getElementById('btnChatSend');
      els.stop = document.getElementById('btnChatTroubleshoot');
      els.gen = document.getElementById('btnChatCode');
      els.suggestions = document.getElementById('chatSuggestions');
    }

    function addMessage(role, html) {
      if (!els.messages) cache();
      var bubble = document.createElement('div');
      bubble.className = 'chat-msg ' + role;
      bubble.innerHTML = '<div class="chat-avatar">' + (role === 'user' ? 'You' : 'AI') + '</div>'
        + '<div class="chat-bubble">' + html + '</div>';
      els.messages.appendChild(bubble);
      setTimeout(function () {
        els.messages.scrollTop = els.messages.scrollHeight;
      }, 20);
      return bubble;
    }

    function addPending() {
      return addMessage('assistant', '<span class="typing">Thinking\u2026</span>');
    }

    function endpoint(path) {
      var base = global.API_BASE || '';
      return base + path;
    }

    function postJSON(path, body) {
      return fetch(endpoint(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var msg = (data.error && data.error.message) || ('Request failed (' + res.status + ')');
            var err = new Error(msg);
            err.status = res.status;
            err.code = data.error && data.error.code;
            throw err;
          }
          return data;
        });
      });
    }

    function removePending(pending) {
      if (pending) {
        if (typeof pending.remove === 'function') {
          pending.remove();
        } else if (pending.parentNode) {
          pending.parentNode.removeChild(pending);
        }
      }
    }

    function ask(question) {
      if (!question || !question.trim()) return;
      addMessage('user', escapeHtml(question));
      var pending = addPending();
      els.input.value = '';
      setBusy(true);
      postJSON('/api/ai/explain', {
        question: question,
        context: lab.buildAIContext()
      }).then(function (data) {
        removePending(pending);
        var replyText = data.reply || data.text || '(no reply received)';
        addMessage('assistant', renderMarkdownLite(replyText));
      }).catch(function (err) {
        removePending(pending);
        addMessage('assistant error', renderMarkdownLite('**AI tutor unavailable:** ' + err.message));
      }).then(function () { setBusy(false); });
    }

    function generateCode() {
      addMessage('user', 'Generate board-compatible code for this lesson.');
      var pending = addPending();
      setBusy(true);
      postJSON('/api/ai/generate-code', {
        context: lab.buildAIContext()
      }).then(function (data) {
        removePending(pending);
        var html = renderMarkdownLite(data.explanation || 'Here is the generated code.');
        if (data.code) {
          html += '<pre class="chat-code">' + escapeHtml(data.code) + '</pre>';
        }
        if (data.libraries && data.libraries.length) {
          html += '<div class="chat-libs"><strong>Required libraries:</strong> '
            + data.libraries.map(escapeHtml).join(', ') + '</div>';
        }
        addMessage('assistant', html);
        if (data.code) {
          lab.codeEditor.setExternalCode(data.code);
          lab.toast('AI code placed in the editor.', 'success');
        }
      }).catch(function (err) {
        removePending(pending);
        addMessage('assistant error', renderMarkdownLite(
          '**Code generation unavailable:** ' + err.message
            + '\n\nThe deterministic code generator in the Code tab still works from your circuit.'));
      }).then(function () { setBusy(false); });
    }

    function troubleshoot() {
      addMessage('user', 'Why is my circuit or code not working?');
      var pending = addPending();
      setBusy(true);
      postJSON('/api/ai/troubleshoot', {
        context: lab.buildAIContext()
      }).then(function (data) {
        removePending(pending);
        addMessage('assistant', renderMarkdownLite(data.reply || '(no reply)'));
      }).catch(function (err) {
        removePending(pending);
        addMessage('assistant error', renderMarkdownLite('**Troubleshooting unavailable:** ' + err.message));
      }).then(function () { setBusy(false); });
    }

    function setBusy(busy) {
      els.send.disabled = busy;
      els.stop.disabled = busy;
      els.gen.disabled = busy;
    }

    function init() {
      cache();
      addMessage('assistant',
        'Hi! I am the Microcontroller AI Lab tutor. Ask me about GPIO pins, LEDs, '
        + 'resistors, voltage levels or your current wiring. I can also generate and '
        + 'explain code for the selected board.');

      els.send.addEventListener('click', function () { ask(els.input.value); });
      els.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          ask(els.input.value);
        }
      });
      els.gen.addEventListener('click', generateCode);
      els.stop.addEventListener('click', troubleshoot);

      var suggestions = [
        'How do I connect an LED to my board?',
        'Why does an LED need a resistor?',
        'What is a GPIO pin?',
        'What is the difference between Arduino Uno and ESP32?',
        'Explain my generated code.',
        'Why is my circuit not working?'
      ];
      suggestions.forEach(function (s) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = s;
        chip.addEventListener('click', function () { ask(s); });
        els.suggestions.appendChild(chip);
      });
    }

    return { init: init, ask: ask, generateCode: generateCode, troubleshoot: troubleshoot };
  }

  var api = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AIClient = api;
  }
})(typeof window !== 'undefined' ? window : this);
