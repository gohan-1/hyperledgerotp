#!/usr/bin/env bash
# ============================================================
#  deploy.sh — Full deployment script for BlockOTP
#  Usage:
#    ./deploy.sh dev       → Start local dev environment
#    ./deploy.sh prod      → Deploy production stack
#    ./deploy.sh fabric    → Set up Fabric network only
#    ./deploy.sh chaincode → Deploy/upgrade chaincode
#    ./deploy.sh stop      → Stop all containers
#    ./deploy.sh clean     → Stop + remove all volumes (DESTRUCTIVE)
#    ./deploy.sh status    → Show running containers + health
#    ./deploy.sh logs      → Tail logs from all services
# ============================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo $PROJECT_ROOT
DOCKER_DIR="$PROJECT_ROOT/docker"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"

CHANNEL_NAME="otpchannel"
CHAINCODE_NAME="otp-contract"
CHAINCODE_VERSION="1.0"
CHAINCODE_SEQUENCE="1"
FABRIC_VERSION="2.5"
CA_VERSION="1.5"

# Colors for output
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

log()    { echo -e "${CYAN}[BlockOTP]${NC} $*"; }
ok()     { echo -e "${GREEN}[  OK  ]${NC} $*"; }
warn()   { echo -e "${YELLOW}[ WARN ]${NC} $*"; }
err()    { echo -e "${RED}[ ERR  ]${NC} $*"; exit 1; }

# ─────────────────────────────────────────────────────────────
# PREREQUISITE CHECK
# ─────────────────────────────────────────────────────────────

check_prerequisites() {
  log "Checking prerequisites..."
  local missing=()

  command -v docker     >/dev/null 2>&1 || missing+=("docker")
  command -v docker-compose >/dev/null 2>&1 || missing+=("docker-compose")
  command -v node       >/dev/null 2>&1 || missing+=("node (v18+)")
  command -v go         >/dev/null 2>&1 || missing+=("go (v1.21+)")

  if [ ${#missing[@]} -ne 0 ]; then
    err "Missing prerequisites: ${missing[*]}\nPlease install them before running this script."
  fi

  # Check Docker is running
  docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker first."

  # Check Node version
  NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>&1) || \
    err "Node.js v18+ required. Current: $(node -v)"

  ok "All prerequisites satisfied"
}

# ─────────────────────────────────────────────────────────────
# FABRIC BINARIES
# ─────────────────────────────────────────────────────────────

install_fabric_binaries() {
  echo $PROJECT_ROOT
  if [ -d "$PROJECT_ROOT/fabric-samples/bin" ]; then
    ok "Fabric binaries already installed"
    return 0
  fi

  log "Downloading Hyperledger Fabric ${FABRIC_VERSION} binaries..."
  cd "$PROJECT_ROOT"
  curl -sSL https://bit.ly/2ysbOFE | bash -s -- "${FABRIC_VERSION}" "${CA_VERSION}"
  ok "Fabric binaries installed at $PROJECT_ROOT/fabric-samples/bin"
}

export_fabric_bins() {
  export PATH="$PROJECT_ROOT/fabric-samples/bin:$PATH"
  export FABRIC_CFG_PATH="$DOCKER_DIR"
}

# ─────────────────────────────────────────────────────────────
# CRYPTO + CHANNEL ARTIFACTS
# ─────────────────────────────────────────────────────────────

generate_crypto() {
  export_fabric_bins
  log "Generating crypto material..."
  cd "$DOCKER_DIR"

  echo $DOCKER_DIR
  if [ -d "crypto-config" ]; then
    warn "crypto-config already exists — skipping generation"
    return 0
  fi

  # Generate crypto material using cryptogen
  cryptogen generate --config="./crypto-config.yaml" --output="./crypto-config"
    ok "Crypto material generated"

  # Create channel genesis block
  mkdir -p channel-artifacts
  configtxgen -profile TwoOrgsOrdererGenesis -channelID system-channel \
    -outputBlock ./channel-artifacts/genesis.block
  ok "Genesis block created"

  # Create channel transaction
  configtxgen -profile TwoOrgsChannel -outputCreateChannelTx \
    ./channel-artifacts/${CHANNEL_NAME}.tx -channelID ${CHANNEL_NAME}
  ok "Channel transaction created"
}

# ─────────────────────────────────────────────────────────────
# FABRIC NETWORK LIFECYCLE
# ─────────────────────────────────────────────────────────────

start_fabric_network() {
  log "Starting Hyperledger Fabric network..."
  cd "$DOCKER_DIR"

  generate_crypto

  docker-compose up -d \
    ca.otp.com \
    orderer.otp.com \
    peer0.org1.otp.com \
    peer1.org1.otp.com \
    couchdb0 \
    couchdb1

  log "Waiting for Fabric nodes to start (30s)..."
  sleep 30

  # Create and join channel
  log "Creating channel: ${CHANNEL_NAME}"
  docker exec peer0.org1.otp.com peer channel create \
    -o orderer.otp.com:7050 \
    -c ${CHANNEL_NAME} \
    -f /var/hyperledger/configtx/${CHANNEL_NAME}.tx \
    --tls --cafile /var/hyperledger/orderer/tls/ca.crt \
    --outputBlock /var/hyperledger/configtx/${CHANNEL_NAME}.block

  log "Joining peer0 to channel..."
  docker exec peer0.org1.otp.com peer channel join \
    -b /var/hyperledger/configtx/${CHANNEL_NAME}.block

  log "Joining peer1 to channel..."
  docker exec peer1.org1.otp.com peer channel join \
    -b /var/hyperledger/configtx/${CHANNEL_NAME}.block

  ok "Fabric network started and channel created"
}

# ─────────────────────────────────────────────────────────────
# CHAINCODE DEPLOYMENT
# ─────────────────────────────────────────────────────────────

deploy_chaincode() {
  export_fabric_bins
  log "Deploying chaincode: ${CHAINCODE_NAME} v${CHAINCODE_VERSION}"

  CHAINCODE_PATH="$PROJECT_ROOT/chaincode"
  PACKAGE_FILE="/tmp/${CHAINCODE_NAME}.tar.gz"

  # Build the Go chaincode
  log "Building chaincode..."
  cd "$CHAINCODE_PATH"
  go mod tidy
  go build -o /dev/null ./...
  ok "Chaincode builds successfully"

  # Package chaincode
  log "Packaging chaincode..."
  peer lifecycle chaincode package ${PACKAGE_FILE} \
    --path ${CHAINCODE_PATH} \
    --lang golang \
    --label ${CHAINCODE_NAME}_${CHAINCODE_VERSION}
  ok "Chaincode packaged"

  # Install on peer0
  log "Installing on peer0..."
  PEER0_ENV="CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_LOCALMSPID=Org1MSP \
    CORE_PEER_ADDRESS=peer0.org1.otp.com:7051"
  eval env $PEER0_ENV peer lifecycle chaincode install ${PACKAGE_FILE}

  # Install on peer1
  log "Installing on peer1..."
  PEER1_ENV="CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_LOCALMSPID=Org1MSP \
    CORE_PEER_ADDRESS=peer1.org1.otp.com:8051"
  eval env $PEER1_ENV peer lifecycle chaincode install ${PACKAGE_FILE}

  # Get package ID
  PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep "${CHAINCODE_NAME}" | awk '{print $3}' | tr -d ',')
  log "Package ID: ${PACKAGE_ID}"

  # Approve for org
  log "Approving chaincode definition..."
  peer lifecycle chaincode approveformyorg \
    -o orderer.otp.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --version ${CHAINCODE_VERSION} \
    --package-id ${PACKAGE_ID} \
    --sequence ${CHAINCODE_SEQUENCE} \
    --tls --cafile "${DOCKER_DIR}/crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp/tlscacerts/tlsca.otp.com-cert.pem"

  # Commit chaincode definition
  log "Committing chaincode definition..."
  peer lifecycle chaincode commit \
    -o orderer.otp.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --version ${CHAINCODE_VERSION} \
    --sequence ${CHAINCODE_SEQUENCE} \
    --tls --cafile "${DOCKER_DIR}/crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp/tlscacerts/tlsca.otp.com-cert.pem" \
    --peerAddresses peer0.org1.otp.com:7051 \
    --tlsRootCertFiles "${DOCKER_DIR}/crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls/ca.crt"

  ok "Chaincode ${CHAINCODE_NAME} deployed and committed to channel"

  # Quick sanity test
  log "Testing chaincode invocation..."
  peer chaincode invoke \
    -o orderer.otp.com:7050 \
    -C ${CHANNEL_NAME} \
    -n ${CHAINCODE_NAME} \
    --tls --cafile "${DOCKER_DIR}/crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp/tlscacerts/tlsca.otp.com-cert.pem" \
    -c '{"Args":["StoreOTPHash","test_user","abc123hash","9999999999"]}' \
    --peerAddresses peer0.org1.otp.com:7051 \
    --tlsRootCertFiles "${DOCKER_DIR}/crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls/ca.crt"
  ok "Chaincode test invocation successful"
}

# ─────────────────────────────────────────────────────────────
# APPLICATION STACK
# ─────────────────────────────────────────────────────────────

start_app_stack() {
  log "Starting application stack (PostgreSQL, Redis, Backend, Frontend, NGINX)..."
  cd "$DOCKER_DIR"

  # Verify .env file
  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    warn ".env file not found — copying from .env.example"
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    warn "Please edit .env with your secrets before going to production!"
  fi

  docker-compose up -d postgres redis
  log "Waiting for database (15s)..."
  sleep 15

  docker-compose up -d backend frontend nginx
  ok "Application stack started"
}

# ─────────────────────────────────────────────────────────────
# COMMANDS
# ─────────────────────────────────────────────────────────────

cmd_dev() {
  log "============================================"
  log " Starting BlockOTP — DEVELOPMENT mode"
  log "============================================"
  check_prerequisites
  install_fabric_binaries
  start_fabric_network
  deploy_chaincode
  start_app_stack
  print_urls
}

cmd_prod() {
  log "============================================"
  log " Starting BlockOTP — PRODUCTION mode"
  log "============================================"
  check_prerequisites

  # In prod, we assume Fabric network is already running
  # Only bring up the app stack
  cd "$DOCKER_DIR"
  docker-compose --env-file "$PROJECT_ROOT/.env.production" up -d \
    postgres redis backend frontend nginx prometheus grafana
  ok "Production stack started"
  print_urls
}

cmd_fabric() {
  check_prerequisites
  install_fabric_binaries
  start_fabric_network
}

cmd_chaincode() {
  check_prerequisites
  export_fabric_bins
  deploy_chaincode
}

cmd_stop() {
  log "Stopping all BlockOTP containers..."
  cd "$DOCKER_DIR"
  docker-compose stop
  ok "All containers stopped"
}

cmd_clean() {
  warn "This will DESTROY all containers, volumes, and data!"
  read -p "Type 'yes' to confirm: " confirm
  [ "$confirm" = "yes" ] || { log "Aborted."; exit 0; }

  cd "$DOCKER_DIR"
  docker-compose down -v --remove-orphans
  rm -rf "$DOCKER_DIR/crypto-config" "$DOCKER_DIR/channel-artifacts"
  ok "Clean complete — all data removed"
}

cmd_status() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════${NC}"
  echo -e "${BLUE}  BlockOTP — Container Status${NC}"
  echo -e "${BLUE}═══════════════════════════════════════${NC}"
  docker ps --filter "name=otp" \
    --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""

  # Health checks
  log "Checking service health..."
  curl -sf http://localhost:4000/health && ok "Backend API: healthy" || warn "Backend API: not responding"
  curl -sf http://localhost:3000 >/dev/null && ok "Frontend: healthy" || warn "Frontend: not responding"
}

cmd_logs() {
  cd "$DOCKER_DIR"
  SERVICE=${2:-""}
  if [ -n "$SERVICE" ]; then
    docker-compose logs -f "$SERVICE"
  else
    docker-compose logs -f --tail=50
  fi
}

print_urls() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  BlockOTP is running!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "  ${CYAN}Frontend:${NC}   http://localhost:3000"
  echo -e "  ${CYAN}Backend API:${NC} http://localhost:4000"
  echo -e "  ${CYAN}Grafana:${NC}    http://localhost:3001  (admin/admin123)"
  echo -e "  ${CYAN}CouchDB:${NC}    http://localhost:5984  (admin/adminpw)"
  echo -e "  ${CYAN}Prometheus:${NC} http://localhost:9090"
  echo ""
}

# ─────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────

COMMAND="${1:-help}"

case "$COMMAND" in
  dev)        cmd_dev ;;
  prod)       cmd_prod ;;
  fabric)     cmd_fabric ;;
  chaincode)  cmd_chaincode ;;
  stop)       cmd_stop ;;
  clean)      cmd_clean ;;
  status)     cmd_status ;;
  logs)       cmd_logs "$@" ;;
  *)
    echo ""
    echo -e "${CYAN}BlockOTP Deploy Script${NC}"
    echo ""
    echo "Usage: ./deploy.sh <command>"
    echo ""
    echo "Commands:"
    echo "  dev         Start full dev environment (Fabric + App)"
    echo "  prod        Start production stack"
    echo "  fabric      Set up Fabric network only"
    echo "  chaincode   Deploy/upgrade chaincode"
    echo "  stop        Stop all containers"
    echo "  clean       Remove everything (DESTRUCTIVE)"
    echo "  status      Show container health"
    echo "  logs [svc]  Tail logs (all or specific service)"
    echo ""
    ;;
esac
