// ============================================================
//  routes/otp.js — OTP request and verification endpoints
//  Database: MongoDB (mongoose)
// ============================================================
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const fabric = require('../services/fabric-client');
const logger = require('../config/logger');
const OtpSession = require('../models/Otpsession');
const User = require('../models/User');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// RATE LIMITING — 5 OTP requests per 15 min per userId / IP
// ─────────────────────────────────────────────────────────────

const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body.userId || req.ip,
  message: { error: 'Too many OTP requests. Please wait 15 minutes.' },
});

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function getExpiry(seconds = 300) {
  return Math.floor(Date.now() / 1000) + seconds;
}

async function deliverOTP(userId, otp) {
  // TODO: Replace with your delivery method:
  // - Email: sendgrid, nodemailer
  // - Push notification: Firebase FCM
  logger.info(`[DEV ONLY] OTP for ${userId}: ${otp}`);
  return true;
}

// ─────────────────────────────────────────────────────────────
// POST /api/otp/request
// Generate OTP → hash it → store hash on blockchain
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/otp/request:
 *   post:
 *     summary: Request a new OTP
 *     tags: [OTP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: user_123
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Invalid userId
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/request', otpRateLimit, async (req, res, next) => {
  const { userId } = req.body;

  if (!userId || typeof userId !== 'string' || userId.length > 128) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  try {
    // Verify user exists in MongoDB
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate OTP + timestamps
    const otp = generateOTP();
    const timestamp = Math.floor(Date.now() / 1000);
    const expiry = getExpiry(parseInt(process.env.OTP_EXPIRY_SECONDS) || 300);

    // Compute hash (same formula used during verify)
    console.log(otp)
    const otpHash = fabric.computeOTPHash(otp, userId, String(timestamp));

    console.log(otpHash)

    // Store hash on Hyperledger Fabric ledger
    await fabric.storeOTPHash(userId, otpHash, expiry);

    // Upsert OTP session in MongoDB
    await OtpSession.findOneAndUpdate(
      { userId },
      {
        userId,
        otpTimestamp: timestamp,
        expiresAt: new Date(expiry * 1000),
      },
      { upsert: true, new: true }
    );

    // Deliver OTP to user
    await deliverOTP(userId, otp);

    global.otpCounter = (global.otpCounter || 0) + 1;

    logger.info(`OTP requested for user: ${userId}`);
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: 300,
      // DEV ONLY — remove in production
      ...(process.env.NODE_ENV === 'development' ? { devOtp: otp } : {}),
    });

  } catch (error) {
    logger.error('OTP request failed:', error.message);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/otp/verify
// Verify submitted OTP against blockchain hash → issue JWT
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/otp/verify:
 *   post:
 *     summary: Verify OTP and receive JWT
 *     tags: [OTP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, otp]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: user_123
 *               otp:
 *                 type: string
 *                 example: "654321"
 *     responses:
 *       200:
 *         description: OTP verified — returns JWT
 *       400:
 *         description: Validation error or no active session
 *       401:
 *         description: Invalid or expired OTP
 */
router.post('/verify', async (req, res, next) => {
  const { userId, otp } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ error: 'userId and otp are required' });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'OTP must be 6 digits' });
  }

  try {
    // Fetch OTP session from MongoDB
    const session = await OtpSession.findOne({ userId });
    if (!session) {
      return res.status(400).json({ error: 'No active OTP session found' });
    }

    // Recompute hash with the original timestamp stored at request time
    const inputHash = fabric.computeOTPHash(otp, userId, String(session.otpTimestamp));

    // Verify against Hyperledger Fabric ledger
    const isValid = await fabric.verifyOTPHash(userId, inputHash);

    if (!isValid) {
      logger.warn(`Failed OTP verification for user: ${userId}`);
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Clean up session document
    await OtpSession.deleteOne({ userId });

    // Issue JWT
    const token = jwt.sign(
      { userId, iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET || 'dev-secret-change-me',
      { expiresIn: '24h' }
    );

    logger.info(`Successful OTP verification for user: ${userId}`);
    return res.json({
      success: true,
      message: 'OTP verified successfully',
      token,
      expiresIn: 86400,
    });

  } catch (error) {
    logger.error('OTP verification failed:', error.message);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/otp/invalidate — Admin: revoke an active OTP
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/otp/invalidate:
 *   post:
 *     summary: Admin — revoke an active OTP
 *     tags: [OTP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP invalidated
 *       400:
 *         description: userId required
 */
router.post('/invalidate', async (req, res, next) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Mark as used on blockchain
    await fabric.invalidateOTP(userId);

    // Remove session from MongoDB
    await OtpSession.deleteOne({ userId });

    return res.json({ success: true, message: 'OTP invalidated' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;