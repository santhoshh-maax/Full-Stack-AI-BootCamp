'use strict';

const express = require('express');
const circuitController = require('../controllers/circuit.controller');

const router = express.Router();

router.post('/validate', circuitController.validate);

module.exports = router;
