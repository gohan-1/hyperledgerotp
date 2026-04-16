#!/usr/bin/env bash
# ============================================================
#  deploy-chaincode.sh
#  Run AFTER fix-fabric-setup.sh succeeds
#  Packages, installs, approves, and commits the OTP chaincode
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${CYAN}[cc]${NC} $*"; }
ok()  { echo -e "${GREEN}[OK ]${NC} $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

DOCKER_DIR="$(pwd)/devops/docker"
CHAINCODE_DIR="$(pwd)/chaincode"

cd "$DOCKER_DIR" || err "Run from blockchain-otp/ root"

FABRIC_BIN="$(pwd)/../../bin"
export PATH="$FABRIC_BIN:$PATH"
export FABRIC_CFG_PATH="$DOCKER_DIR"

ORDERER_CA="$(pwd)/crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp/tlscacerts/tlsca.otp.com-cert.pem"
PEER0_TLS="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls/ca.crt"
PEER1_TLS="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/peers/peer1.org1.otp.com/tls/ca.crt"
ADMIN_MSP="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/users/Admin@org1.otp.com/msp"

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH="$ADMIN_MSP"

CC_NAME="otp-contract"
CC_VERSION="1.0"
CC_SEQ="1"
CC_LABEL="${CC_NAME}_${CC_VERSION}"
PACKAGE_FILE="/tmp/${CC_NAME}.tar.gz"

# ─── Build Go chaincode ────────────────────────────────────
log "Building Go chaincode..."
cd "$CHAINCODE_DIR"
go mod tidy
go build ./... && ok "Chaincode compiles OK"
cd "$DOCKER_DIR"

# ─── Package ──────────────────────────────────────────────
log "Packaging chaincode..."
peer lifecycle chaincode package "$PACKAGE_FILE" \
  --path "$CHAINCODE_DIR" \
  --lang golang \
  --label "$CC_LABEL"
ok "Packaged: $PACKAGE_FILE"

# ─── Install on peer0 ─────────────────────────────────────
log "Installing on peer0..."
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_TLS"
peer lifecycle chaincode install "$PACKAGE_FILE"
ok "Installed on peer0"

# ─── Install on peer1 ─────────────────────────────────────
log "Installing on peer1..."
export CORE_PEER_ADDRESS=localhost:8051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER1_TLS"
peer lifecycle chaincode install "$PACKAGE_FILE"
ok "Installed on peer1"

# ─── Get Package ID ───────────────────────────────────────
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_TLS"
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled \
  | grep "$CC_LABEL" | head -1 \
  | sed 's/Package ID: //;s/, Label:.*//')
log "Package ID: $PACKAGE_ID"
[ -z "$PACKAGE_ID" ] && err "Could not determine Package ID"

# ─── Approve for Org1 ─────────────────────────────────────
log "Approving chaincode definition for Org1..."
peer lifecycle chaincode approveformyorg \
  -o localhost:7050 \
  --channelID otpchannel \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --package-id "$PACKAGE_ID" \
  --sequence "$CC_SEQ" \
  --tls --cafile "$ORDERER_CA"
ok "Approved"

# ─── Check commit readiness ───────────────────────────────
log "Checking commit readiness..."
peer lifecycle chaincode checkcommitreadiness \
  --channelID otpchannel \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --sequence "$CC_SEQ" \
  --tls --cafile "$ORDERER_CA" \
  --output json

# ─── Commit chaincode ─────────────────────────────────────
log "Committing chaincode to channel..."
peer lifecycle chaincode commit \
  -o localhost:7050 \
  --channelID otpchannel \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --sequence "$CC_SEQ" \
  --tls --cafile "$ORDERER_CA" \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "$PEER0_TLS" \
  --peerAddresses localhost:8051 \
  --tlsRootCertFiles "$PEER1_TLS"
ok "Chaincode committed!"

# ─── Smoke test ───────────────────────────────────────────
log "Running smoke test invoke..."
sleep 5
peer chaincode invoke \
  -o localhost:7050 \
  -C otpchannel \
  -n "$CC_NAME" \
  --tls --cafile "$ORDERER_CA" \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "$PEER0_TLS" \
  -c '{"Args":["StoreOTPHash","test_user","abc123testhash","9999999999"]}' \
  --waitForEvent
ok "Smoke test passed — chaincode is live!"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  OTP chaincode deployed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo "  Channel:   otpchannel"
echo "  Chaincode: $CC_NAME v$CC_VERSION"
echo "  Next: cd backend && npm install && node server.js"
echo ""
