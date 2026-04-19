// ============================================================
//  routes/auth.js — User registration and profile
//  Database: MongoDB (mongoose)
// ============================================================
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const User = require('../models/User');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE — verify JWT
// ─────────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(
      header.split(' ')[1],
      process.env.JWT_SECRET || 'dev-secret'
    );
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register — Create a new user
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, email, password]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: user_123
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: secret123
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Validation error
 *       409:
 *         description: User already exists
 */
router.post('/register', async (req, res, next) => {
  const { userId, email, password } = req.body;

  if (!userId || !email || !password) {
    return res.status(400).json({ error: 'userId, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    await User.create({ userId, email, passwordHash });

    logger.info(`New user registered: ${userId}`);
    return res.status(201).json({ success: true, message: 'User created' });

  } catch (error) {
    // MongoDB duplicate key error code
    if (error.code === 11000) {
      return res.status(409).json({ error: 'User already exists' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/profile — Get authenticated user profile
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Get authenticated user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *       401:
 *         description: No or invalid token
 *       404:
 *         description: User not found
 */
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findOne(
      { userId: req.user.userId },
      { passwordHash: 0, __v: 0 }   // exclude sensitive fields
    ).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.authenticate = authenticate;