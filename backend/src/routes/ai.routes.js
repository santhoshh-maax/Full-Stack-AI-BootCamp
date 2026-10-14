'use strict';

const express = require('express');
const aiController = require('../controllers/ai.controller');

const router = express.Router();

router.post('/explain', aiController.explain);
router.post('/generate-code', aiController.generateCode);
router.post('/troubleshoot', aiController.troubleshoot);

module.exports = router;
