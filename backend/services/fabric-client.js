// ============================================================
//  services/fabric-client.js — Hyperledger Fabric SDK wrapper
// ============================================================
'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('path');
const { TextDecoder } = require('node:util');
const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

const channelName = process.env.FABRIC_CHANNEL || 'otpchannel';
const chaincodeName = process.env.FABRIC_CHAINCODE || 'otp';
const mspId = process.env.FABRIC_MSP_ID || 'Org1MSP';
const peerEndpoint = process.env.FABRIC_PEER_ENDPOINT || 'localhost:7051';
const peerHostAlias = peerEndpoint.split(':')[0];

// Base path to org1 crypto material
const cryptoPath = path.resolve(
  path.join(
    __dirname, '..', '..', 'devops', 'fabric-samples', 'test-network',
    'organizations', 'peerOrganizations', 'org1.valtrans.com'
  )
);


// TLS cert for the gRPC channel to the peer
const tlsCertPath = path.join(
  cryptoPath, 'peers', 'peer0.org1.valtrans.com', 'tls', 'ca.crt'
);


// Admin identity — must use Admin (client role), NOT the peer cert
// The peer cert has OU=peer which fails the Writers policy check
const IDENTITY_MSP = path.join(cryptoPath, 'users', 'Admin@org1.valtrans.com', 'msp');
const CERT_PATH = path.join(IDENTITY_MSP, 'signcerts');
const KEY_PATH = path.join(IDENTITY_MSP, 'keystore');


const keyDirectoryPath = envOrDefault(
  'KEY_DIRECTORY_PATH',
  path.resolve(cryptoPath, 'users', 'Admin@org1.valtrans.com', 'msp', 'keystore')
);

// Path to user certificate directory
const certDirectoryPath = envOrDefault(
  'CERT_DIRECTORY_PATH',
  path.resolve(cryptoPath, 'users', 'Admin@org1.valtrans.com', 'msp', 'signcerts')
);

// ── Org2 (same structure, only org2 changes) ──────────────────
const PEER2_ENDPOINT = process.env.FABRIC_PEER_ENDPOINT || 'localhost:9051'
const PEER2_HOST = PEER2_ENDPOINT.split(':')[0];



const cryptoPath_ORG2 = path.resolve(
  path.join(
    __dirname, '..', '..', 'devops', 'fabric-samples', 'test-network',
    'organizations', 'peerOrganizations', 'org2.valtrans.com'
  )
);


const TLS_CERT_PATH_ORG2 = path.join(
  cryptoPath_ORG2, 'peers', 'peer0.org2.valtrans.com', 'tls', 'ca.crt'
);




const utf8Decoder = new TextDecoder();

// ─────────────────────────────────────────────────────────────
// CONNECTION STATE — module-level singletons reused per request
// ─────────────────────────────────────────────────────────────

let gateway = null;
let client = null;
let client2 = null;
let contract = null;

// ─────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────

async function connectToFabric() {
  try {
    displayInputParameters();
    logger.info('Connecting to Hyperledger Fabric network...');

    client = await newGrpcConnection();

    gateway = connect({
      client,
      identity: await newIdentity(),
      signer: await newSigner(),
      hash: hash.sha256,
      // Default timeouts for different gRPC calls
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),  // 5 s
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),  // 15 s
      submitOptions: () => ({ deadline: Date.now() + 5000 }),  // 5 s
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),  // 1 min
    });

    const network = gateway.getNetwork(channelName);
    contract = network.getContract(chaincodeName);

    logger.info(`Fabric connected — channel: ${channelName}, chaincode: ${chaincodeName}`);
    return true;

  } catch (error) {
    logger.error(`Failed to connect to Fabric: ${error.message}`);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// gRPC / IDENTITY HELPERS  (mirrors reference app.js)
// ─────────────────────────────────────────────────────────────

async function newGrpcConnection() {
  const tlsRootCert = await fs.readFile(tlsCertPath);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  const client = new grpc.Client(peerEndpoint, tlsCredentials, {
    'grpc.ssl_target_name_override': peerHostAlias,
  });

  // Wait until the peer is actually reachable before handing the client
  // to the gateway — prevents "Waiting for LB pick" timeouts on first call.
  await new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + 10000); // 10 s
    client.waitForReady(deadline, (err) => {
      if (err) {
        client.close();
        reject(new Error(`Peer not reachable at ${peerEndpoint} (alias: ${peerHostAlias}): ${err.message}`));
      } else {
        resolve();
      }
    });
  });

  return client;
}

async function newIdentity() {
  const certPath = await getFirstDirFileName(certDirectoryPath);
  const credentials = await fs.readFile(certPath);
  return { mspId, credentials };
}

async function newSigner() {
  const keyPath = await getFirstDirFileName(keyDirectoryPath);
  const privateKeyPem = await fs.readFile(keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

async function getFirstDirFileName(dirPath) {
  const files = await fs.readdir(dirPath);
  const file = files[0];
  if (!file) throw new Error(`No files in directory: ${dirPath}`);
  return path.join(dirPath, file);
}

// ─────────────────────────────────────────────────────────────
// CHAINCODE OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * StoreOTPHash — SUBMIT transaction (blocking, waits for commit)
 */
async function storeOTPHash(userId, otpHash, expiry) {
  ensureConnected();
  try {
    logger.info(`StoreOTPHash -> userId: ${userId}`);

    const resultBytes = await contract.submitTransaction(
      'StoreOTPHash',
      userId,
      otpHash,
      String(expiry)
    );

    const txId = utf8Decoder.decode(resultBytes);
    logger.info(`OTP hash stored on chain — user: ${userId}, txId: ${txId}`);
    return { success: true, txId };

  } catch (error) {
    logger.error(`storeOTPHash failed for ${userId}: ${error.message}`);
    throw new Error(`Blockchain write failed: ${error.message}`);
  }
}

/**
 * VerifyOTPHash — SUBMIT transaction (blocking, waits for commit)
 * Returns true if valid, false if invalid / expired / already used.
 */
async function verifyOTPHash(userId, inputHash) {
  ensureConnected();
  try {
    const resultBytes = await contract.submitTransaction(
      'VerifyOTPHash',
      userId,
      inputHash
    );

    const result = utf8Decoder.decode(resultBytes);
    logger.info(`OTP verification for ${userId}: ${result}`);
    return result === 'true';

  } catch (error) {
    logger.error(`verifyOTPHash failed for ${userId}: ${error.message}`);
    throw new Error(`Blockchain verification failed: ${error.message}`);
  }
}

/**
 * GetAuditTrail — EVALUATE transaction (read-only query)
 * Requires CouchDB as the Fabric state database.
 */
async function getAuditTrail(userId) {
  ensureConnected();
  try {
    const resultBytes = await contract.evaluateTransaction('GetAuditTrail', userId);
    const result = utf8Decoder.decode(resultBytes);
    return JSON.parse(result || '[]');

  } catch (error) {
    logger.error(`getAuditTrail failed for ${userId}: ${error.message}`);
    throw new Error(`Failed to fetch audit trail: ${error.message}`);
  }
}

/**
 * InvalidateOTP — SUBMIT transaction (blocking, waits for commit)
 */
async function invalidateOTP(userId) {
  ensureConnected();
  try {
    await contract.submitTransaction('InvalidateOTP', userId);
    return { success: true };

  } catch (error) {
    logger.error(`invalidateOTP failed for ${userId}: ${error.message}`);
    throw new Error(`Invalidation failed: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// DISCONNECT
// ─────────────────────────────────────────────────────────────

function disconnect() {
  if (gateway) {
    gateway.close();
    gateway = null;
    contract = null;
    logger.info('Fabric gateway closed');
  }
  if (client) {
    client.close();
    client = null;
    logger.info('gRPC client closed');
  }
}

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────

/**
 * computeOTPHash — SHA-256(otp + userId + timestamp)
 * Must match the formula in the chaincode exactly.
 */
function computeOTPHash(otp, userId, timestamp) {
  return crypto
    .createHash('sha256')
    .update(`${otp}${userId}${timestamp}`)
    .digest('hex');
}

/**
 * envOrDefault — returns the env var value or a fallback default.
 */
function envOrDefault(key, defaultValue) {
  return process.env[key] || defaultValue;
}

/**
 * ensureConnected — throws if connectToFabric() has not been called yet.
 */
function ensureConnected() {
  if (!contract) {
    throw new Error('Fabric client not connected. Call connectToFabric() first.');
  }
}

/**
 * displayInputParameters — logs resolved config at startup.
 */
function displayInputParameters() {
  logger.info(`channelName:       ${channelName}`);
  logger.info(`chaincodeName:     ${chaincodeName}`);
  logger.info(`mspId:             ${mspId}`);
  logger.info(`cryptoPath:        ${cryptoPath}`);
  logger.info(`keyDirectoryPath:  ${keyDirectoryPath}`);
  logger.info(`certDirectoryPath: ${certDirectoryPath}`);
  logger.info(`tlsCertPath:       ${tlsCertPath}`);
  logger.info(`peerEndpoint:      ${peerEndpoint}`);
  logger.info(`peerHostAlias:     ${peerHostAlias}`);
}

// Graceful shutdown
process.on('SIGINT', disconnect);
process.on('SIGTERM', disconnect);

module.exports = {
  connectToFabric,
  disconnect,
  storeOTPHash,
  verifyOTPHash,
  getAuditTrail,
  invalidateOTP,
  computeOTPHash,
};
