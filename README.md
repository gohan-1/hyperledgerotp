# ⛓ BlockOTP — Blockchain-Based OTP Verification

Enterprise-grade authentication using Hyperledger Fabric. No SMS costs. Immutable audit trail.

---

## 📁 Project Structure

```
blockchain-otp/
├── chaincode/              ← Go smart contract (Hyperledger Fabric)
│   ├── otp.go              ← StoreOTPHash, VerifyOTPHash, GetAuditTrail
│   └── go.mod
├── backend/                ← Node.js / Express API server
│   ├── server.js           ← Entry point, middleware setup
│   ├── routes/
│   │   ├── otp.js          ← POST /api/otp/request, /verify, /invalidate
│   │   ├── auth.js         ← POST /api/auth/register, GET /api/auth/profile
│   │   └── audit.js        ← GET /api/audit/:userId
│   ├── services/
│   │   └── fabric-client.js ← Fabric SDK wrapper (connect, store, verify)
│   ├── config/logger.js
│   ├── middleware/errorHandler.js
│   ├── package.json
│   └── Dockerfile
├── frontend/               ← React 18 + Vite
│   ├── src/
│   │   ├── App.jsx         ← Root component + auth context
│   │   ├── main.jsx        ← React DOM entry
│   │   ├── styles.css      ← Complete UI styles
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx   ← Enter userId → request OTP
│   │   │   ├── OTPPage.jsx     ← 6-box OTP entry + timer
│   │   │   └── Dashboard.jsx   ← Authenticated dashboard + audit trail
│   │   └── utils/api.js        ← All fetch calls to backend
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── Dockerfile
└── devops/
    ├── docker/
    │   ├── docker-compose.yml  ← Full stack orchestration
    │   └── init-db.sql         ← PostgreSQL schema
    ├── nginx/
    │   └── nginx.conf          ← Reverse proxy + SSL + rate limiting
    ├── monitoring/
    │   └── prometheus.yml      ← Metrics scraping config
    └── scripts/
        ├── deploy.sh           ← Master deployment script
        └── ci-cd.yml           ← GitHub Actions pipeline
```

---

## 🚀 Quick Start (Development)

### Prerequisites
- Docker Desktop
- Node.js v18+
- Go v1.21+

### Step 1 — Clone and configure
```bash
git clone https://github.com/your-org/blockchain-otp.git
cd blockchain-otp
cp .env.example .env
```

### Step 2 — Start everything
```bash
chmod +x devops/scripts/deploy.sh
./devops/scripts/deploy.sh dev
```

This single command:
1. Downloads Hyperledger Fabric binaries
2. Generates crypto material (certs, keys)
3. Starts 3-node Fabric network (1 orderer + 2 peers)
4. Creates the OTP channel
5. Deploys the Go chaincode
6. Starts PostgreSQL + Redis
7. Starts the Node.js backend
8. Starts the React frontend
9. Starts NGINX reverse proxy
10. Starts Prometheus + Grafana monitoring

### Step 3 — Open the app
| Service    | URL                          |
|------------|------------------------------|
| Frontend   | http://localhost:3000        |
| Backend    | http://localhost:4000        |
| Grafana    | http://localhost:3001        |
| CouchDB    | http://localhost:5984        |
| Prometheus | http://localhost:9090        |

---

## 🔄 How It Works (Step by Step)

```
User enters userId
      ↓
POST /api/otp/request
      ↓
Backend: generates random 6-digit OTP
Backend: computes hash = SHA-256(otp + userId + timestamp)
Backend: stores hash on Hyperledger Fabric blockchain (NOT the OTP)
Backend: stores timestamp in PostgreSQL (to recompute hash during verify)
Backend: delivers OTP to user (email / display in dev mode)
      ↓
User enters OTP in the 6-box form
      ↓
POST /api/otp/verify
      ↓
Backend: recomputes hash = SHA-256(submittedOTP + userId + storedTimestamp)
Backend: calls VerifyOTPHash on blockchain
Chaincode: compares hashes, checks expiry, checks used flag
Chaincode: marks OTP as used (prevents replay attack)
      ↓
Backend: issues JWT token
User: authenticated ✓
```

---

## 🔐 Security Features

| Feature              | How it works                                          |
|----------------------|-------------------------------------------------------|
| Hash-only storage    | Raw OTP never stored anywhere; only SHA-256 hash on-chain |
| Single-use OTP       | Chaincode marks OTP as `used=true` after first verify |
| Expiry (5 min)       | Chaincode rejects OTPs past their `expiresAt` timestamp |
| Rate limiting        | Max 5 OTP requests per user per 15 minutes            |
| Immutable audit log  | Every event written to blockchain; cannot be altered  |
| TLS everywhere       | All Fabric node-to-node comms use mutual TLS          |
| JWT auth             | Protected routes require Bearer token                 |

---

## 📡 API Reference

### POST /api/otp/request
```json
Request:  { "userId": "user123" }
Response: { "success": true, "message": "OTP sent", "expiresIn": 300 }
```

### POST /api/otp/verify
```json
Request:  { "userId": "user123", "otp": "482910" }
Response: { "success": true, "token": "<JWT>", "expiresIn": 86400 }
```

### GET /api/audit/:userId
```json
Headers:  Authorization: Bearer <JWT>
Response: { "success": true, "events": [...], "count": 5 }
```

---

## ⚙️ DevOps Commands

```bash
./devops/scripts/deploy.sh dev        # Start full dev environment
./devops/scripts/deploy.sh prod       # Start production stack
./devops/scripts/deploy.sh fabric     # Start Fabric network only
./devops/scripts/deploy.sh chaincode  # Deploy/upgrade chaincode
./devops/scripts/deploy.sh status     # Check all service health
./devops/scripts/deploy.sh logs       # Tail all logs
./devops/scripts/deploy.sh stop       # Stop all containers
./devops/scripts/deploy.sh clean      # Remove everything (DESTRUCTIVE)
```

---

## 💰 Cost Comparison

| Method             | Cost per 1000 verifications/day | Monthly |
|--------------------|----------------------------------|---------|
| SMS OTP (Twilio)   | $0.07 × 30,000 = $2,100         | $2,100  |
| BlockOTP (this)    | Infrastructure only              | ~$105   |
| **Savings**        | **~$2,000/month (95% less)**     |         |

---

## 📦 Tech Stack

| Layer      | Technology                         |
|------------|------------------------------------|
| Blockchain | Hyperledger Fabric 2.5             |
| Chaincode  | Go 1.21                            |
| Backend    | Node.js 20, Express 4, Fabric SDK  |
| Database   | PostgreSQL 16 (users + sessions)   |
| Cache      | Redis 7 (rate limiting)            |
| Frontend   | React 18, Vite 5                   |
| Proxy      | NGINX (SSL + rate limiting)        |
| Monitoring | Prometheus + Grafana               |
| CI/CD      | GitHub Actions                     |
| Container  | Docker + Docker Compose            |
# hyperledgerotp
