// ============================================================
//  routes/otp.js — OTP request and verification endpoints
// ============================================================
'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const jwt       = require('jsonwebtoken');
const { Pool }  = require('pg');

const fabric    = require('../services/fabric-client');
const logger    = require('../config/logger');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// DATABASE POOL
// ─────────────────────────────────────────────────────────────

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// ─────────────────────────────────────────────────────────────
// RATE LIMITING (OTP-specific — stricter than global)
// 5 OTP requests per 15 minutes per IP
// ─────────────────────────────────────────────────────────────

const otpRateLimit = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 5,
  keyGenerator: (req) => req.body.userId || req.ip,
  message  : { error: 'Too many OTP requests. Please wait 15 minutes.' },
});

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Generate a cryptographically random 6-digit OTP */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/** Compute expiry timestamp (5 minutes from now) */
function getExpiry(seconds = 300) {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** Deliver OTP to the user. In production, integrate your email/notification service here */
async function deliverOTP(userId, otp) {
  // TODO: Replace with your delivery method:
  // - Email: sendgrid, nodemailer
  // - Push notification: Firebase FCM
  // - Internal display: return in response (dev only)
  logger.info(`[DEV ONLY] OTP for ${userId}: ${otp}`);
  return true;
}

// ─────────────────────────────────────────────────────────────
// POST /api/otp/request
// Generate a new OTP, hash it, store hash on blockchain
// ─────────────────────────────────────────────────────────────

router.post('/request', otpRateLimit, async (req, res, next) => {
  const { userId } = req.body;

  if (!userId || typeof userId !== 'string' || userId.length > 128) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  try {
    // Check user exists in our database
    const userResult = await db.query('SELECT id FROM users WHERE user_id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate OTP
    const otp       = generateOTP();
    const timestamp = Math.floor(Date.now() / 1000);
    const expiry    = getExpiry(parseInt(process.env.OTP_EXPIRY_SECONDS) || 300);

    // Compute hash — same formula as verification
    const otpHash = fabric.computeOTPHash(otp, userId, String(timestamp));

    // Store hash on blockchain (not the raw OTP)
    await fabric.storeOTPHash(userId, otpHash, expiry);

    // Store timestamp in PostgreSQL so we can recompute the hash during verify
    await db.query(
      `INSERT INTO otp_sessions (user_id, otp_timestamp, expires_at)
       VALUES ($1, $2, to_timestamp($3))
       ON CONFLICT (user_id) DO UPDATE
       SET otp_timestamp = $2, expires_at = to_timestamp($3)`,
      [userId, timestamp, expiry]
    );

    // Deliver OTP to user
    await deliverOTP(userId, otp);

    global.otpCounter = (global.otpCounter || 0) + 1;

    logger.info(`OTP requested for user: ${userId}`);
    return res.json({
      success : true,
      message : 'OTP sent successfully',
      expiresIn: 300,
      // DEV ONLY: remove this in production
      ...(process.env.NODE_ENV === 'development' ? { devOtp: otp } : {}),
    });

  } catch (error) {
    logger.error('OTP request failed:', error.message);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/otp/verify
// Verify submitted OTP against blockchain hash
// ─────────────────────────────────────────────────────────────

router.post('/verify', async (req, res, next) => {
  const { userId, otp } = req.body;

  // Input validation
  if (!userId || !otp) {
    return res.status(400).json({ error: 'userId and otp are required' });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'OTP must be 6 digits' });
  }

  try {
    // Get the original timestamp from PostgreSQL (needed to recompute hash)
    const sessionResult = await db.query(
      'SELECT otp_timestamp FROM otp_sessions WHERE user_id = $1',
      [userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active OTP session found' });
    }

    const { otp_timestamp } = sessionResult.rows[0];

    // Recompute hash using the same formula as generation
    const inputHash = fabric.computeOTPHash(otp, userId, String(otp_timestamp));

    // Verify against blockchain
    const isValid = await fabric.verifyOTPHash(userId, inputHash);

    if (!isValid) {
      logger.warn(`Failed OTP verification for user: ${userId}`);
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Clean up session
    await db.query('DELETE FROM otp_sessions WHERE user_id = $1', [userId]);

    // Issue JWT token
    const token = jwt.sign(
      { userId, iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET || 'dev-secret-change-me',
      { expiresIn: '24h' }
    );

    logger.info(`Successful OTP verification for user: ${userId}`);
    return res.json({
      success : true,
      message : 'OTP verified successfully',
      token,
      expiresIn: 86400,
    });

  } catch (error) {
    logger.error('OTP verification failed:', error.message);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/otp/invalidate — Admin: revoke an OTP
// ─────────────────────────────────────────────────────────────

router.post('/invalidate', async (req, res, next) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    await fabric.invalidateOTP(userId);
    await db.query('DELETE FROM otp_sessions WHERE user_id = $1', [userId]);
    return res.json({ success: true, message: 'OTP invalidated' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
