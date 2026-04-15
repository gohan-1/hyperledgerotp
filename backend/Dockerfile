# ============================================================
#  Backend Dockerfile — Multi-stage build
# ============================================================

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

# Copy only production deps from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Create logs directory
RUN mkdir -p logs && chown -R appuser:appgroup /app

USER appuser
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "server.js"]
