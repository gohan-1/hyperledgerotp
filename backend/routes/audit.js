// ============================================================
//  routes/audit.js — Blockchain audit trail endpoints
// ============================================================
'use strict';

const express = require('express');
const fabric  = require('../services/fabric-client');
const { authenticate } = require('./auth');
const logger  = require('../config/logger');

const router = express.Router();

// GET /api/audit/:userId — retrieve audit trail from blockchain
router.get('/:userId', authenticate, async (req, res, next) => {
  const { userId } = req.params;

  // Users can only view their own audit trail (admins can view all)
  if (req.user.userId !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const trail = await fabric.getAuditTrail(userId);
    return res.json({ success: true, userId, events: trail, count: trail.length });
  } catch (error) {
    logger.error(`Audit trail fetch failed for ${userId}:`, error.message);
    next(error);
  }
});

module.exports = router;
