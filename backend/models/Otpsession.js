// ============================================================
//  models/OtpSession.js — Mongoose schema for OTP sessions
//  One document per user — upserted on each OTP request.
//  MongoDB TTL index auto-deletes expired sessions.
// ============================================================
'use strict';

const mongoose = require('mongoose');

const otpSessionSchema = new mongoose.Schema(
  {
    userId: {
      type    : String,
      required: true,
      unique  : true,   // one active OTP per user
      trim    : true,
    },
    otpTimestamp: {
      type    : Number,    // Unix timestamp (seconds) — used to recompute hash on verify
      required: true,
    },
    expiresAt: {
      type    : Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index — MongoDB automatically removes documents after expiresAt
// This is a safety net; sessions are also explicitly deleted on verify/invalidate
otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);