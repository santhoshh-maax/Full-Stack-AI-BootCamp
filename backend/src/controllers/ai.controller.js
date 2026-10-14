'use strict';

const circuitService = require('../services/circuit.service');
const aiService = require('../services/ai.service');
const { validateAIRequest, requireObject } = require('../utils/validate');
const { AppError } = require('../middleware/errors');

/** Recompute validation and rebuild the board capabilities from the server. */
function buildAuthoritativeContext(rawContext) {
  requireObject(rawContext, 'context');
  const boardId = rawContext.board && rawContext.board.id;
  if (!boardId) {
    throw new AppError('MISSING_BOARD', 'context.board.id is required.', 400);
  }
  const board = circuitService.requireBoard(boardId);

  const circuitInput = Object.assign({}, rawContext.circuit, {
    board: boardId,
    lesson: (rawContext.lesson && rawContext.lesson.id) || (rawContext.circuit && rawContext.circuit.lesson) || 'led'
  });
  const validation = circuitService.validate(circuitInput);

  return {
    board: circuitService.capabilities(board),
    lesson: rawContext.lesson || { id: circuitInput.lesson },
    circuit: {
      board: boardId,
      lesson: circuitInput.lesson,
      components: circuitInput.components || [],
      connections: circuitInput.connections || []
    },
    validation: validation,
    code: typeof rawContext.code === 'string' ? rawContext.code.slice(0, 8000) : '',
    blinkInterval: rawContext.blinkInterval
  };
}

async function explain(req, res, next) {
  try {
    const { context, question } = validateAIRequest(req.body);
    if (!question) {
      throw new AppError('MISSING_QUESTION', 'A question is required.', 400);
    }
    const authoritative = buildAuthoritativeContext(context);
    const result = await aiService.explain(authoritative, question);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function generateCode(req, res, next) {
  try {
    const { context } = validateAIRequest(req.body);
    const authoritative = buildAuthoritativeContext(context);
    const result = await aiService.generateCode(authoritative);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function troubleshoot(req, res, next) {
  try {
    const { context } = validateAIRequest(req.body);
    const authoritative = buildAuthoritativeContext(context);
    const result = await aiService.troubleshoot(authoritative);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { explain, generateCode, troubleshoot };
