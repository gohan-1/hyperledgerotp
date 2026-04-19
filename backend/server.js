// ============================================================
//  server.js — Blockchain OTP API entry point
// ============================================================
'use strict';

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const mongoose = require('mongoose');

const swaggerSpec = require('./config/swagger');
const { connectDB } = require('./config/db');
const fabric = require('./services/fabric-client');
const otpRoutes = require('./routes/otp');
const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audit');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');

const app = express();
const PORT = process.env.PORT || 4003;
const HOST = process.env.HOST || 'localhost';

// app.set('trust proxy', true);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://validator.swagger.io'],
    },
  },
}));
app.use(compression());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
}));

// Swagger
app.get('/api-docs/swagger.json', (req, res) => { res.setHeader('Content-Type', 'application/json'); res.send(swaggerSpec); });
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Blockchain OTP API Docs',
  swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, docExpansion: 'list', filter: true, tryItOutEnabled: true },
}));

// Routes
app.use('/api/otp', otpRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: process.env.APP_VERSION || '1.0.0' }));
app.get('/metrics', (req, res) => { res.set('Content-Type', 'text/plain'); res.send(`# HELP otp_requests_total Total OTP requests\notp_requests_total ${global.otpCounter || 0}\n`); });
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────
global.otpCounter = 0;

const server = app.listen(PORT, HOST, async () => {
  try {
    logger.info({ host: HOST, port: PORT }, `OTP API server running: http://${HOST}:${PORT}`);
    logger.info(`Swagger UI: http://${HOST}:${PORT}/api-docs`);

    // 1. MongoDB
    await connectDB();
    if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected.');
    logger.info('Connected to MongoDB.');

    // 2. Hyperledger Fabric
    await fabric.connectToFabric();
    logger.info('Connected to Hyperledger Fabric.');

    process.on('uncaughtException', (err) => logger.error('Uncaught Exception:', err));
    process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection:', reason));

  } catch (error) {
    logger.error('Error during server initialization:', error);
    process.exit(1);
  }
});

// ── Graceful shutdown ────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  server.close(async () => {
    logger.info('HTTP server closed — port released');

    try { fabric.disconnect(); } catch (err) { logger.error('Error closing Fabric:', err.message); }
    try { await mongoose.connection.close(); logger.info('MongoDB disconnected'); } catch (err) { logger.error('Error closing MongoDB:', err.message); }

    process.exit(0);
  });

  setTimeout(() => { logger.error('Shutdown timeout — forcing exit'); process.exit(1); }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;