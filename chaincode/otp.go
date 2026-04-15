// ============================================================
//  OTP Chaincode — Hyperledger Fabric 2.5
//  Stores and verifies OTP hashes on the blockchain ledger
// ============================================================
package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ─────────────────────────────────────────────────────────────
// DATA STRUCTURES
// ─────────────────────────────────────────────────────────────

// OTPRecord is stored on the blockchain ledger for each OTP request
type OTPRecord struct {
	OTPHash   string `json:"otpHash"`   // SHA-256 hash of OTP+userId+timestamp
	UserID    string `json:"userId"`    // user identifier
	ExpiresAt int64  `json:"expiresAt"` // Unix timestamp expiry
	CreatedAt int64  `json:"createdAt"` // Unix timestamp creation
	Used      bool   `json:"used"`      // true after successful verification
	TxID      string `json:"txId"`      // Fabric transaction ID (auto-set)
}

// AuditEntry records every OTP event for compliance / audit trail
type AuditEntry struct {
	EventType string `json:"eventType"` // "REQUEST" | "VERIFY_SUCCESS" | "VERIFY_FAIL"
	UserID    string `json:"userId"`
	Timestamp int64  `json:"timestamp"`
	TxID      string `json:"txId"`
}

// OTPContract is the chaincode struct — all methods become chaincode functions
type OTPContract struct {
	contractapi.Contract
}

// ─────────────────────────────────────────────────────────────
// CORE FUNCTIONS
// ─────────────────────────────────────────────────────────────

// StoreOTPHash writes a new OTP hash to the ledger.
// Called by the backend API after generating an OTP.
//
// Parameters:
//   - userId     : unique user identifier (e.g. "user_123")
//   - otpHash    : SHA-256(rawOTP + userId + timestamp) — computed server-side
//   - expiryStr  : Unix timestamp string (e.g. "1712345678")
func (c *OTPContract) StoreOTPHash(
	ctx contractapi.TransactionContextInterface,
	userId string,
	otpHash string,
	expiryStr string,
) error {

	if userId == "" || otpHash == "" || expiryStr == "" {
		return fmt.Errorf("userId, otpHash, and expiryStr are all required")
	}

	expiry, err := strconv.ParseInt(expiryStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid expiryStr: %v", err)
	}

	now := time.Now().Unix()
	txID := ctx.GetStub().GetTxID()

	record := OTPRecord{
		OTPHash:   otpHash,
		UserID:    userId,
		ExpiresAt: expiry,
		CreatedAt: now,
		Used:      false,
		TxID:      txID,
	}

	recordBytes, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal OTP record: %v", err)
	}

	// Key format: "OTP_<userId>" — one active OTP per user at a time
	key := fmt.Sprintf("OTP_%s", userId)
	err = ctx.GetStub().PutState(key, recordBytes)
	if err != nil {
		return fmt.Errorf("failed to store OTP record: %v", err)
	}

	// Write audit entry
	return c.writeAudit(ctx, "REQUEST", userId, now)
}

// VerifyOTPHash checks whether the provided hash matches the stored one.
// Returns "true" on success, "false" on failure.
// Marks the OTP as used after a successful match to prevent replay attacks.
//
// Parameters:
//   - userId    : the user whose OTP we're verifying
//   - inputHash : SHA-256(submittedOTP + userId + originalTimestamp) — recomputed server-side
func (c *OTPContract) VerifyOTPHash(
	ctx contractapi.TransactionContextInterface,
	userId string,
	inputHash string,
) (string, error) {

	key := fmt.Sprintf("OTP_%s", userId)
	recordBytes, err := ctx.GetStub().GetState(key)
	if err != nil {
		return "false", fmt.Errorf("failed to read state: %v", err)
	}
	if recordBytes == nil {
		return "false", nil // No OTP found for this user
	}

	var record OTPRecord
	if err := json.Unmarshal(recordBytes, &record); err != nil {
		return "false", fmt.Errorf("failed to unmarshal record: %v", err)
	}

	now := time.Now().Unix()

	// Check: already used?
	if record.Used {
		c.writeAudit(ctx, "VERIFY_FAIL", userId, now)
		return "false", nil
	}

	// Check: expired?
	if now > record.ExpiresAt {
		c.writeAudit(ctx, "VERIFY_FAIL", userId, now)
		return "false", nil
	}

	// Check: hash match?
	if record.OTPHash != inputHash {
		c.writeAudit(ctx, "VERIFY_FAIL", userId, now)
		return "false", nil
	}

	// SUCCESS — mark as used (prevents replay)
	record.Used = true
	updatedBytes, _ := json.Marshal(record)
	ctx.GetStub().PutState(key, updatedBytes)
	c.writeAudit(ctx, "VERIFY_SUCCESS", userId, now)

	return "true", nil
}

// GetOTPRecord returns the raw OTP record for a user (admin/debug use)
func (c *OTPContract) GetOTPRecord(
	ctx contractapi.TransactionContextInterface,
	userId string,
) (*OTPRecord, error) {

	key := fmt.Sprintf("OTP_%s", userId)
	recordBytes, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if recordBytes == nil {
		return nil, fmt.Errorf("no OTP record found for user: %s", userId)
	}

	var record OTPRecord
	json.Unmarshal(recordBytes, &record)
	return &record, nil
}

// GetAuditTrail returns the full audit history for a user using CouchDB rich queries
func (c *OTPContract) GetAuditTrail(
	ctx contractapi.TransactionContextInterface,
	userId string,
) (string, error) {

	queryString := fmt.Sprintf(`{
		"selector": {
			"userId": "%s"
		},
		"sort": [{"timestamp": "desc"}],
		"limit": 50
	}`, userId)

	iterator, err := ctx.GetStub().GetQueryResult(queryString)
	if err != nil {
		return "", fmt.Errorf("CouchDB query failed: %v", err)
	}
	defer iterator.Close()

	var entries []AuditEntry
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			continue
		}
		var entry AuditEntry
		json.Unmarshal(result.Value, &entry)
		entries = append(entries, entry)
	}

	resultBytes, _ := json.Marshal(entries)
	return string(resultBytes), nil
}

// InvalidateOTP manually marks an OTP as used (admin action — e.g. user reported suspicion)
func (c *OTPContract) InvalidateOTP(
	ctx contractapi.TransactionContextInterface,
	userId string,
) error {

	key := fmt.Sprintf("OTP_%s", userId)
	recordBytes, _ := ctx.GetStub().GetState(key)
	if recordBytes == nil {
		return fmt.Errorf("no OTP found for user: %s", userId)
	}

	var record OTPRecord
	json.Unmarshal(recordBytes, &record)
	record.Used = true
	updatedBytes, _ := json.Marshal(record)
	return ctx.GetStub().PutState(key, updatedBytes)
}

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

// writeAudit stores an audit entry to the ledger
func (c *OTPContract) writeAudit(
	ctx contractapi.TransactionContextInterface,
	eventType string,
	userId string,
	timestamp int64,
) error {
	entry := AuditEntry{
		EventType: eventType,
		UserID:    userId,
		Timestamp: timestamp,
		TxID:      ctx.GetStub().GetTxID(),
	}
	entryBytes, _ := json.Marshal(entry)
	// Audit key: "AUDIT_<userId>_<txID>" — unique per event
	key := fmt.Sprintf("AUDIT_%s_%s", userId, ctx.GetStub().GetTxID())
	return ctx.GetStub().PutState(key, entryBytes)
}

// HashOTP is a utility exposed for testing — mirrors what the backend does
// In production the backend hashes before calling chaincode
func HashOTP(otp, userId, timestamp string) string {
	data := fmt.Sprintf("%s%s%s", otp, userId, timestamp)
	hash := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", hash)
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

func main() {
	chaincode, err := contractapi.NewChaincode(&OTPContract{})
	if err != nil {
		fmt.Printf("Error creating OTP chaincode: %v\n", err)
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting OTP chaincode: %v\n", err)
	}
}
