'use strict';

const express = require('express');

const boardsRoutes = require('./boards.routes');
const aiRoutes = require('./ai.routes');
const circuitRoutes = require('./circuit.routes');
const usageRoutes = require('./usage.routes');

const router = express.Router();

router.use('/', boardsRoutes);
router.use('/ai', aiRoutes);
router.use('/circuit', circuitRoutes);
router.use('/usage', usageRoutes);

module.exports = router;
