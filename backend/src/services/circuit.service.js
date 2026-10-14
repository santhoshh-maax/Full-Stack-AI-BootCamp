'use strict';

/*
 * circuit.service.js
 *
 * Server-side circuit validation. Reuses the exact validator module that the
 * frontend uses, but recomputes the result from the backend board registry so a
 * client can never make an unsupported pin appear valid.
 */

const path = require('path');
const BoardRegistry = require('../config/board-registry');
const { AppError } = require('../middleware/errors');

const Validator = require(path.join(
  __dirname, '..', '..', '..', 'frontend', 'js', 'circuit-validator.js'
));

function capabilities(board) {
  return {
    id: board.id,
    name: board.name,
    variant: board.variant,
    platform: board.platform,
    mcu: board.mcu,
    logicVoltage: board.logicVoltage,
    digitalPins: board.digitalPins,
    analogPins: board.analogPins,
    pwmPins: board.pwmPins,
    powerPins: board.powerPins,
    powerPinVoltage: board.powerPinVoltage,
    groundPins: board.groundPins
  };
}

function listBoards() {
  return BoardRegistry.listBoards().map(capabilities);
}

function requireBoard(boardId) {
  const board = BoardRegistry.getBoard(boardId);
  if (!board) {
    throw new AppError('UNKNOWN_BOARD', 'Unknown board: ' + boardId, 400);
  }
  return board;
}

/** Normalise loosely-shaped input into the shared circuit state shape. */
function normalizeState(input) {
  if (!input || typeof input !== 'object') {
    throw new AppError('INVALID_CIRCUIT', 'A circuit object is required.', 400);
  }
  const boardId = input.board || (input.board && input.board.id);
  if (!boardId) {
    throw new AppError('MISSING_BOARD', 'Circuit board id is required.', 400);
  }
  requireBoard(boardId);
  const components = Array.isArray(input.components) ? input.components : [];
  const connections = Array.isArray(input.connections) ? input.connections : [];
  if (components.length > 200 || connections.length > 400) {
    throw new AppError('CIRCUIT_TOO_LARGE', 'Circuit exceeds the supported size.', 413);
  }
  return {
    board: boardId,
    lesson: input.lesson || 'led',
    components: components,
    connections: connections
  };
}

function validate(input) {
  const state = normalizeState(input);
  return Validator.validate(state);
}

module.exports = { capabilities, listBoards, requireBoard, normalizeState, validate };
