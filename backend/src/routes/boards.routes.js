'use strict';

const express = require('express');
const boardsController = require('../controllers/boards.controller');

const router = express.Router();

router.get('/health', boardsController.health);
router.get('/boards', boardsController.boards);

module.exports = router;
