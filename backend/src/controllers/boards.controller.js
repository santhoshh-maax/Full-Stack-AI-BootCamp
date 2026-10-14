'use strict';

const circuitService = require('../services/circuit.service');

function health(req, res) {
  res.json({
    status: 'ok',
    service: 'microcontroller-ai-lab-backend',
    time: new Date().toISOString()
  });
}

function boards(req, res) {
  res.json({ boards: circuitService.listBoards() });
}

module.exports = { health, boards };
