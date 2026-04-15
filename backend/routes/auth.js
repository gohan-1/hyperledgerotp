// ============================================================
//  routes/auth.js — User registration and profile
// ============================================================
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { Pool } = require('pg');
const logger  = require('../config/logger');

const router = express.Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Middleware: verify JWT
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register — Create a new user
// ─────────────────────────────────────────────────────────────

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
    await db.query(
      'INSERT INTO users (user_id, email, password_hash) VALUES ($1, $2, $3)',
      [userId, email, passwordHash]
    );
    logger.info(`New user registered: ${userId}`);
    return res.status(201).json({ success: true, message: 'User created' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'User already exists' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/profile — Get authenticated user profile
// ─────────────────────────────────────────────────────────────

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT user_id, email, created_at FROM users WHERE user_id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.authenticate = authenticate;
