'use strict';

const { AppError } = require('../middleware/errors');

const MAX_QUESTION = 2000;
const MAX_MODEL = 100;

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_BODY', name + ' must be a JSON object.', 400);
  }
  return value;
}

function asString(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('INVALID_FIELD', name + ' is required and must be a non-empty string.', 400);
  }
  if (max && value.length > max) {
    throw new AppError('FIELD_TOO_LONG', name + ' must be at most ' + max + ' characters.', 413);
  }
  return value.trim();
}

/** Validate the shared AI request envelope sent by the frontend. */
function validateAIRequest(body) {
  requireObject(body, 'Request body');
  const context = requireObject(body.context, 'context');
  const boardId = context.board && context.board.id;
  if (!boardId) {
    throw new AppError('MISSING_BOARD',
      'context.board.id is required so the AI knows which board is selected.', 400);
  }
  const question = body.question == null ? '' : String(body.question);
  if (question.length > MAX_QUESTION) {
    throw new AppError('QUESTION_TOO_LONG',
      'The question must be at most ' + MAX_QUESTION + ' characters.', 413);
  }
  return { context, question: question.trim() };
}

function parseDate(value, name) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new AppError('INVALID_DATE', name + ' must be a valid ISO date.', 400);
  }
  return d;
}

/** Normalise usage query filters into a { start, end, model } range. */
function resolveUsageRange(query) {
  const now = new Date();
  const range = query.range || '7d';
  let start;
  let end = parseDate(query.end, 'end') || now;
  const model = query.model && query.model !== 'all' ? String(query.model) : null;
  if (model && model.length > MAX_MODEL) {
    throw new AppError('INVALID_MODEL', 'model is too long.', 400);
  }

  if (range === 'custom') {
    start = parseDate(query.start, 'start');
    if (!start) {
      throw new AppError('INVALID_RANGE', 'A custom range requires a start date.', 400);
    }
  } else if (range === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === '30d') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (range === '7d') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    throw new AppError('INVALID_RANGE',
      'range must be one of: today, 7d, 30d, custom.', 400);
  }

  if (start > end) {
    throw new AppError('INVALID_RANGE', 'start must be before end.', 400);
  }
  return { start, end, model, range };
}

module.exports = {
  requireObject,
  asString,
  validateAIRequest,
  resolveUsageRange,
  MAX_QUESTION
};
