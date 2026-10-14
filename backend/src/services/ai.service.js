'use strict';

/*
 * ai.service.js
 *
 * The only module that talks to the AI provider. All AI calls are proxied
 * through the backend so credentials never reach the browser.
 *
 * Two request formats are supported and selected automatically:
 *   - Anthropic Messages API  (POST /v1/messages, x-api-key, top-level system)
 *   - OpenAI-compatible Chat Completions (POST /chat/completions)
 *
 * The provider is chosen from AI_PROVIDER or inferred from AI_BASE_URL. Point
 * AI_BASE_URL at the authorised provider for your deployment.
 *
 * All prompts receive the selected board, lesson, circuit, deterministic
 * validation results and the student's question. The AI is explicitly told not
 * to override the deterministic board configuration or validation outcome, and
 * never to claim code was compiled, executed or tested on hardware.
 */

const { AppError } = require('../middleware/errors');
const usageService = require('./usage.service');

const ANTHROPIC_VERSION = '2023-06-01';

function providerName() {
  return process.env.AI_PROVIDER || 'anthropic';
}

function modelName() {
  return process.env.AI_MODEL || 'claude-sonnet-4-5';
}

function baseUrl() {
  return (process.env.AI_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
}

function isAnthropic() {
  const p = providerName().toLowerCase();
  return p === 'anthropic' || p === 'claude' || /anthropic\.com/.test(baseUrl());
}

function isConfigured() {
  return !!process.env.AI_API_KEY;
}

function timeoutMs() {
  const v = parseInt(process.env.AI_TIMEOUT_MS, 10);
  return isFinite(v) && v > 0 ? v : 30000;
}

function maxTokens() {
  const v = parseInt(process.env.AI_MAX_TOKENS, 10);
  return isFinite(v) && v > 0 ? v : 1024;
}

const GUARDRAILS = [
  'You are part of the Microcontroller AI Lab, an interactive electronics tutor.',
  'Explain concepts in beginner-friendly language.',
  'Use ONLY the board capabilities supplied in the context. Never invent pins,',
  'voltages or capabilities. If information is missing, say what is missing.',
  'The deterministic circuit validator decides whether a circuit is valid.',
  'Never contradict or override the validation result; you may explain it.',
  'Never claim that code was compiled, uploaded, executed or tested on real hardware.',
  'Clearly distinguish verified circuit facts from your own suggestions or assumptions.',
  'The in-browser simulator only models a small documented subset of behaviour.'
].join(' ');

function systemPrompt(feature) {
  if (feature === 'generate-code') {
    return GUARDRAILS + ' You generate Arduino-style C++ code that matches the selected '
      + 'board and the pins resolved from the circuit. Return the complete code inside a '
      + 'single ```cpp fenced block, then a short explanation of the key lines and the '
      + 'required libraries. Use the numeric pin numbers compatible with the board '
      + '(for example D8 -> 8 on the Arduino Uno, GPIO2 -> 2 on the ESP32).';
  }
  if (feature === 'troubleshoot') {
    return GUARDRAILS + ' You help diagnose why a circuit or program is not working. '
      + 'Base your answer on the actual validation errors, warnings and connections in the '
      + 'context. Give concrete, ordered steps and explain the reasoning.';
  }
  return GUARDRAILS + ' Answer the student\'s electronics question using the current '
    + 'board, lesson and circuit context.';
}

/** Build a compact, non-secret context string for the model. */
function serializeContext(ctx) {
  const clean = {
    board: ctx.board,
    lesson: ctx.lesson,
    circuit: ctx.circuit,
    validation: ctx.validation
      ? {
        valid: ctx.validation.valid,
        errors: ctx.validation.errors,
        warnings: ctx.validation.warnings,
        resolvedPins: ctx.validation.info && ctx.validation.info.pins
      }
      : null,
    code: ctx.code || '',
    blinkInterval: ctx.blinkInterval
  };
  return JSON.stringify(clean, null, 2);
}

function buildHeaders() {
  if (isAnthropic()) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': process.env.AI_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.AI_API_KEY
  };
}

function buildBody(system, messages) {
  if (isAnthropic()) {
    const body = {
      model: modelName(),
      max_tokens: maxTokens(),
      system: system,
      messages: messages
    };
    // Temperature is not supported by the newest Claude models; only send it
    // when explicitly configured so requests do not fail with a 400.
    if (process.env.AI_TEMPERATURE !== undefined && process.env.AI_TEMPERATURE !== '') {
      body.temperature = parseFloat(process.env.AI_TEMPERATURE);
    }
    return body;
  }
  return {
    model: modelName(),
    messages: [{ role: 'system', content: system }].concat(messages),
    max_tokens: maxTokens(),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3')
  };
}

function parseResponse(payload) {
  if (!payload) return { text: '', usage: {}, model: modelName() };
  if (isAnthropic()) {
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content
      .filter(function (block) { return block && block.type === 'text'; })
      .map(function (block) { return block.text; })
      .join('');
    return {
      text: text,
      usage: payload.usage || {},
      model: payload.model || modelName(),
      inputTokens: payload.usage && payload.usage.input_tokens,
      outputTokens: payload.usage && payload.usage.output_tokens
    };
  }
  const choice = payload.choices && payload.choices[0];
  const text = choice && choice.message ? choice.message.content : '';
  const usage = payload.usage || {};
  return {
    text: text,
    usage: usage,
    model: payload.model || modelName(),
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens
  };
}

/** Send a chat request to the configured provider. */
async function chat(system, messages, feature) {
  if (!isConfigured()) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'The AI provider is not configured on the backend. Add AI_API_KEY to backend/.env '
        + 'and restart the server. Deterministic validation and code generation still work '
        + 'without an AI key.',
      503
    );
  }

  const url = isAnthropic() ? baseUrl() + '/messages' : baseUrl() + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs());
  const started = Date.now();
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(buildBody(system, messages)),
      signal: controller.signal
    });
  } catch (err) {
    usageService.record({
      model: modelName(), feature: feature, status: 'failed', durationMs: Date.now() - started
    });
    if (err.name === 'AbortError') {
      throw new AppError('AI_TIMEOUT',
        'The AI provider did not respond within ' + timeoutMs() + ' ms.', 504);
    }
    throw new AppError('AI_UNREACHABLE',
      'Could not reach the AI provider: ' + err.message, 502);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    usageService.record({
      model: modelName(), feature: feature, status: 'failed', durationMs: Date.now() - started
    });
    throw new AppError('AI_RATE_LIMIT',
      'The AI provider rate limit was reached. Wait a moment and try again.', 429);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok) {
    usageService.record({
      model: modelName(), feature: feature, status: 'failed', durationMs: Date.now() - started
    });
    const detail = payload && payload.error && payload.error.message ? payload.error.message : '';
    throw new AppError('AI_PROVIDER_ERROR',
      'The AI provider returned HTTP ' + response.status + (detail ? ': ' + detail : ''),
      502);
  }

  const parsed = parseResponse(payload);

  usageService.record({
    model: parsed.model,
    feature: feature,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    totalTokens: (typeof parsed.inputTokens === 'number' || typeof parsed.outputTokens === 'number')
      ? (parsed.inputTokens || 0) + (parsed.outputTokens || 0)
      : undefined,
    status: 'success',
    durationMs: Date.now() - started
  });

  if (!parsed.text) {
    throw new AppError('AI_EMPTY_RESPONSE', 'The AI provider returned an empty response.', 502);
  }
  return parsed.text;
}

async function explain(context, question) {
  const user = 'Current lab context:\n```json\n' + serializeContext(context)
    + '\n```\n\nStudent question: ' + question;
  const reply = await chat(systemPrompt('explain'), [{ role: 'user', content: user }], 'explain');
  return { reply: reply };
}

async function generateCode(context) {
  const user = 'Generate board-compatible code for this lab context:\n```json\n'
    + serializeContext(context) + '\n```';
  const reply = await chat(
    systemPrompt('generate-code'),
    [{ role: 'user', content: user }],
    'generate-code'
  );
  return parseCodeReply(reply);
}

async function troubleshoot(context) {
  const user = 'Help me troubleshoot this lab context:\n```json\n'
    + serializeContext(context) + '\n```';
  const reply = await chat(
    systemPrompt('troubleshoot'),
    [{ role: 'user', content: user }],
    'troubleshoot'
  );
  return { reply: reply };
}

function parseCodeReply(text) {
  const match = /```(?:cpp|c\+\+|arduino|ino)?\s*([\s\S]*?)```/i.exec(text);
  const code = match ? match[1].trim() : '';
  const explanation = text.replace(/```[\s\S]*?```/g, '').trim();
  const libMatch = /#include\s*<([^>]+)>/g;
  const libraries = [];
  let m;
  while ((m = libMatch.exec(code)) !== null) libraries.push(m[1]);
  return { code: code, explanation: explanation, libraries: libraries };
}

module.exports = {
  isConfigured,
  providerName,
  modelName,
  isAnthropic,
  explain,
  generateCode,
  troubleshoot
};
