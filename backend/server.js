// ============================================================
//  BLOCKCHAIN OTP — Node.js / Express Backend
//  Entry point: starts the API server
// ============================================================
'use strict';

require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const compression  = require('compression');

const otpRoutes    = require('./routes/otp');
const authRoutes   = require('./routes/auth');
const auditRoutes  = require('./routes/audit');
const errorHandler = require('./middleware/errorHandler');
const logger       = require('./config/logger');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE STACK
// ─────────────────────────────────────────────────────────────

app.use(helmet());          // Security headers
app.use(compression());     // gzip responses
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Global rate limit — 100 requests per 15 min per IP
app.use(rateLimit({
  windowMs : parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max      : 100,
  message  : { error: 'Too many requests, please try again later' },
  standardHeaders: true,
}));

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

app.use('/api/otp',   otpRoutes);
app.use('/api/auth',  authRoutes);
app.use('/api/audit', auditRoutes);

// Health check — used by Docker healthcheck and Kubernetes probes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Metrics endpoint for Prometheus (simple)
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`# HELP otp_requests_total Total OTP requests\notp_requests_total ${global.otpCounter || 0}\n`);
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler (must be last)
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────

global.otpCounter = 0;

app.listen(PORT, () => {
  logger.info(`OTP API server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
