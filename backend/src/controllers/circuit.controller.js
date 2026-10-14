'use strict';

const circuitService = require('../services/circuit.service');
const { requireObject } = require('../utils/validate');

function validate(req, res, next) {
  try {
    requireObject(req.body, 'Request body');
    // Accept either a full AI context or a bare circuit object.
    const input = req.body.context ? req.body.context.circuit : req.body;
    const result = circuitService.validate(input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { validate };
