-- ============================================================
--  PostgreSQL Schema — Blockchain OTP System
--  Run once at startup (handled by Docker entrypoint)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- USERS TABLE
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  user_id       VARCHAR(128) UNIQUE NOT NULL,
  email         VARCHAR(256) UNIQUE NOT NULL,
  password_hash VARCHAR(256)        NOT NULL,
  role          VARCHAR(32)  DEFAULT 'user',
  created_at    TIMESTAMP    DEFAULT NOW(),
  updated_at    TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);

-- ─────────────────────────────────────────────────────────────
-- OTP SESSIONS TABLE
-- Stores the timestamp needed to recompute the OTP hash during verify.
-- Does NOT store the raw OTP or the hash (those live on blockchain).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       VARCHAR(128) UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  otp_timestamp BIGINT       NOT NULL,        -- Unix timestamp used when hashing
  expires_at    TIMESTAMP    NOT NULL,
  created_at    TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_sessions_user_id ON otp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires ON otp_sessions(expires_at);

-- Auto-expire old sessions (run this periodically or via cron)
-- DELETE FROM otp_sessions WHERE expires_at < NOW();

-- ─────────────────────────────────────────────────────────────
-- SEED: Default admin user (change password in production!)
-- ─────────────────────────────────────────────────────────────
INSERT INTO users (user_id, email, password_hash, role)
VALUES ('admin', 'admin@otp.local', '$2b$12$placeholder_change_me', 'admin')
ON CONFLICT (user_id) DO NOTHING;
