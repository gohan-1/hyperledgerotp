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

const CHANNEL_NAME = process.env.FABRIC_CHANNEL || 'otpchannel';
const CHAINCODE_NAME = process.env.FABRIC_CHAINCODE || 'otp';
const MSP_ID = process.env.FABRIC_MSP_ID || 'Org1MSP';
const PEER_ENDPOINT = process.env.FABRIC_PEER_ENDPOINT || 'localhost:7051';
const PEER_HOST = PEER_ENDPOINT.split(':')[0];
const PEER2_ENDPOINT = process.env.FABRIC_PEER_ENDPOINT || 'localhost:9051'

// Base path to org1 crypto material
const CRYPTO_PATH = path.resolve(
  path.join(
    __dirname, '..', '..', 'devops', 'fabric-samples', 'test-network',
    'organizations', 'peerOrganizations', 'org1.valtrans.com'
  )
);

const CRYPTO_PATH2 = path.resolve(
  path.join(
    __dirname, '..', '..', 'devops', 'fabric-samples', 'test-network',
    'organizations', 'peerOrganizations', 'org2.valtrans.com'
  )
);


// TLS cert for the gRPC channel to the peer
const TLS_CERT_PATH = path.join(
  CRYPTO_PATH, 'peers', 'peer0.org1.valtrans.com', 'tls', 'ca.crt'
);

const TLS_CERT_PATH2 = path.join(
  CRYPTO_PATH, 'peers', 'peer0.org2.valtrans.com', 'tls', 'ca.crt'
);


// Admin identity — must use Admin (client role), NOT the peer cert
// The peer cert has OU=peer which fails the Writers policy check
const IDENTITY_MSP = path.join(CRYPTO_PATH, 'users', 'Admin@org1.valtrans.com', 'msp');
const CERT_PATH = path.join(IDENTITY_MSP, 'signcerts');
const KEY_PATH = path.join(IDENTITY_MSP, 'keystore');

const utf8Decoder = new TextDecoder();

// ─────────────────────────────────────────────────────────────
// CONNECTION STATE — module-level singletons reused per request
// ─────────────────────────────────────────────────────────────

let gateway = null;
let client = null;
let contract = null;

// ─────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────

async function connectToFabric() {
  try {
    logger.info('Connecting to Hyperledger Fabric network...');
    logger.info(`Peer endpoint : ${PEER_ENDPOINT}`);
    logger.info(`TLS cert      : ${TLS_CERT_PATH}`);
    logger.info(`Identity MSP  : ${IDENTITY_MSP}`);

    // 1. Read TLS root cert for the gRPC channel
    const tlsRootCert = await fs.readFile(TLS_CERT_PATH);

    // 2. Create gRPC client pointing at the peer
    client = new grpc.Client(
      PEER_ENDPOINT,
      grpc.credentials.createSsl(tlsRootCert),
      { 'grpc.ssl_target_name_override': PEER_HOST }
    );

    // 3. Read Admin identity certificate
    const certFiles = await fs.readdir(CERT_PATH);
    if (certFiles.length === 0) throw new Error(`No cert files found in: ${CERT_PATH}`);
    const credentials = await fs.readFile(path.join(CERT_PATH, certFiles[0]));

    // 4. Read Admin private key and build signer
    const keyFiles = await fs.readdir(KEY_PATH);
    if (keyFiles.length === 0) throw new Error(`No key files found in: ${KEY_PATH}`);
    const privateKeyPem = await fs.readFile(path.join(KEY_PATH, keyFiles[0]));
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signer = signers.newPrivateKeySigner(privateKey);

    // 5. Connect gateway — official connect() factory (not new Gateway())
    gateway = connect({
      client,
      identity: { mspId: MSP_ID, credentials },
      signer,
      hash: hash.sha256,
    });

    // 6. Get channel and chaincode handle
    const network = gateway.getNetwork(CHANNEL_NAME);


    console.log(network)
    contract = network.getContract(CHAINCODE_NAME);


    console.log(contract)

    logger.info(`Fabric connected — channel: ${CHANNEL_NAME}, chaincode: ${CHAINCODE_NAME}`);
    return true;

  } catch (error) {
    logger.error(`Failed to connect to Fabric: ${error.message}`);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// DISCONNECT — must close both gateway AND gRPC client
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
    logger.info('Fabric gRPC client closed');
  }
}

function ensureConnected() {
  if (!contract) {
    throw new Error('Fabric client not connected. Call connectToFabric() first.');
  }
}

// ─────────────────────────────────────────────────────────────
// CHAINCODE OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * StoreOTPHash — SUBMIT transaction (writes to ledger)
 */
async function storeOTPHash(userId, otpHash, expiry) {
  ensureConnected();
  try {
    console.log(contract)
    console.log('⏳ Submitting StoreOTPHash...');
    console.log('   userId:', userId);
    console.log('   otpHash:', otpHash);
    console.log('   expiry:', String(expiry));

    const resultBytes = await Promise.race([
      contract.submitTransaction('StoreOTPHash', userId, otpHash, String(expiry)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT after 30s')), 30000)
      )
    ]);

    console.log('✅ Raw resultBytes:', resultBytes);
    console.log('✅ Length:', resultBytes?.length);
    const txId = utf8Decoder.decode(resultBytes);
    console.log('✅ txId:', txId);

    logger.info(`OTP hash stored on chain for user: ${userId}`);
    return { success: true, txId };
  } catch (error) {
    console.error('❌ storeOTPHash error:', error.message);
    console.error('❌ Full error:', error);
    logger.error(`storeOTPHash failed for ${userId}: ${error.message}`);
    throw new Error(`Blockchain write failed: ${error.message}`);
  }
}

/**
 * VerifyOTPHash — SUBMIT transaction (marks OTP as used on ledger)
 * Returns true if valid, false if invalid/expired/already-used
 */
async function verifyOTPHash(userId, inputHash) {
  ensureConnected();
  try {
    const resultBytes = await contract.submitTransaction(
      'VerifyOTPHash', userId, inputHash
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
 * GetAuditTrail — EVALUATE transaction (read-only, no ledger write)
 * Requires CouchDB as the Fabric state database
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
 * InvalidateOTP — SUBMIT transaction (admin: revoke active OTP)
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
// UTILITY
// ─────────────────────────────────────────────────────────────

/**
 * computeOTPHash — SHA-256(otp + userId + timestamp)
 * MUST match the formula in the chaincode exactly
 */
function computeOTPHash(otp, userId, timestamp) {
  return crypto
    .createHash('sha256')
    .update(`${otp}${userId}${timestamp}`)
    .digest('hex');
}

module.exports = {
  connectToFabric,
  disconnect,
  storeOTPHash,
  verifyOTPHash,
  getAuditTrail,
  invalidateOTP,
  computeOTPHash,
};