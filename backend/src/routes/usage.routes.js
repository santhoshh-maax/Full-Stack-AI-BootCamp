'use strict';

const express = require('express');
const usageController = require('../controllers/usage.controller');
const { localOnly } = require('../middleware/local-only');

const router = express.Router();

router.use(localOnly);

router.get('/status', usageController.status);
router.get('/summary', usageController.summary);
router.get('/details', usageController.details);

module.exports = router;
