// middleware/errorHandler.js — central error handler
'use strict';
const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
};
