#!/usr/bin/env bash
# ============================================================
#  fix-fabric-setup.sh
#  Run this from your project root (blockchain-otp/)
#  Fixes: missing crypto-config, missing channel artifacts,
#         missing configtx.yaml, missing crypto-config.yaml
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[fix]${NC} $*"; }
ok()   { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[ERR ]${NC} $*"; exit 1; }

DOCKER_DIR="$(pwd)/devops/docker"
cd "$DOCKER_DIR" || err "Run this script from the blockchain-otp/ project root"

# ─────────────────────────────────────────────────────────────
# STEP 1 — Stop and clean existing broken containers
# ─────────────────────────────────────────────────────────────
log "Stopping any running containers..."
docker-compose down --remove-orphans 2>/dev/null || true
docker rm -f ca.otp.com orderer.otp.com peer0.org1.otp.com peer1.org1.otp.com couchdb0 couchdb1 2>/dev/null || true
ok "Containers cleared"

# ─────────────────────────────────────────────────────────────
# STEP 2 — Download Fabric binaries if not present
# ─────────────────────────────────────────────────────────────
FABRIC_BIN="$(pwd)/../../bin"
if [ ! -f "$FABRIC_BIN/cryptogen" ]; then
  log "Fabric binaries not found. Downloading..."
  cd "$(pwd)/../.."
  curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.7 --docker-no-pull
  cd "$DOCKER_DIR"
  ok "Fabric binaries downloaded"
else
  ok "Fabric binaries found at $FABRIC_BIN"
fi

export PATH="$FABRIC_BIN:$PATH"
export FABRIC_CFG_PATH="$DOCKER_DIR"

# Verify tools are available
command -v cryptogen     >/dev/null 2>&1 || err "cryptogen not found in PATH. Check bin/ directory."
command -v configtxgen   >/dev/null 2>&1 || err "configtxgen not found in PATH."

# ─────────────────────────────────────────────────────────────
# STEP 3 — Write crypto-config.yaml
# ─────────────────────────────────────────────────────────────
log "Writing crypto-config.yaml..."
cat > crypto-config.yaml << 'EOF'
OrdererOrgs:
  - Name: Orderer
    Domain: otp.com
    Specs:
      - Hostname: orderer

PeerOrgs:
  - Name: Org1
    Domain: org1.otp.com
    EnableNodeOUs: true
    Template:
      Count: 2
    Users:
      Count: 1
EOF
ok "crypto-config.yaml written"

# ─────────────────────────────────────────────────────────────
# STEP 4 — Write configtx.yaml
# ─────────────────────────────────────────────────────────────
log "Writing configtx.yaml..."
cat > configtx.yaml << 'EOF'
Organizations:
  - &OrdererOrg
    Name: OrdererMSP
    ID: OrdererMSP
    MSPDir: crypto-config/ordererOrganizations/otp.com/msp
    Policies:
      Readers:
        Type: Signature
        Rule: "OR('OrdererMSP.member')"
      Writers:
        Type: Signature
        Rule: "OR('OrdererMSP.member')"
      Admins:
        Type: Signature
        Rule: "OR('OrdererMSP.admin')"

  - &Org1
    Name: Org1MSP
    ID: Org1MSP
    MSPDir: crypto-config/peerOrganizations/org1.otp.com/msp
    Policies:
      Readers:
        Type: Signature
        Rule: "OR('Org1MSP.admin', 'Org1MSP.peer', 'Org1MSP.client')"
      Writers:
        Type: Signature
        Rule: "OR('Org1MSP.admin', 'Org1MSP.client')"
      Admins:
        Type: Signature
        Rule: "OR('Org1MSP.admin')"
      Endorsement:
        Type: Signature
        Rule: "OR('Org1MSP.peer')"

Capabilities:
  Channel: &ChannelCapabilities
    V2_0: true
  Orderer: &OrdererCapabilities
    V2_0: true
  Application: &ApplicationCapabilities
    V2_5: true

Application: &ApplicationDefaults
  Organizations:
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
    LifecycleEndorsement:
      Type: ImplicitMeta
      Rule: "MAJORITY Endorsement"
    Endorsement:
      Type: ImplicitMeta
      Rule: "MAJORITY Endorsement"
  Capabilities:
    <<: *ApplicationCapabilities

Orderer: &OrdererDefaults
  OrdererType: etcdraft
  Addresses:
    - orderer.otp.com:7050
  EtcdRaft:
    Consenters:
      - Host: orderer.otp.com
        Port: 7050
        ClientTLSCert: crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/tls/server.crt
        ServerTLSCert: crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/tls/server.crt
  BatchTimeout: 2s
  BatchSize:
    MaxMessageCount: 10
    AbsoluteMaxBytes: 99 MB
    PreferredMaxBytes: 512 KB
  Organizations:
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
    BlockValidation:
      Type: ImplicitMeta
      Rule: "ANY Writers"
  Capabilities:
    <<: *OrdererCapabilities

Channel: &ChannelDefaults
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
  Capabilities:
    <<: *ChannelCapabilities

Profiles:
  TwoOrgsOrdererGenesis:
    <<: *ChannelDefaults
    Orderer:
      <<: *OrdererDefaults
      Organizations:
        - *OrdererOrg
    Consortiums:
      SampleConsortium:
        Organizations:
          - *Org1

  TwoOrgsChannel:
    Consortium: SampleConsortium
    <<: *ChannelDefaults
    Application:
      <<: *ApplicationDefaults
      Organizations:
        - *Org1
EOF
ok "configtx.yaml written"

# ─────────────────────────────────────────────────────────────
# STEP 5 — Generate crypto material
# ─────────────────────────────────────────────────────────────
log "Generating crypto material with cryptogen..."
rm -rf crypto-config
cryptogen generate --config=./crypto-config.yaml --output=./crypto-config
ok "Crypto material generated in devops/docker/crypto-config/"

# Verify key files exist
[ -f "crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/tls/server.crt" ] \
  || err "Orderer TLS cert missing after cryptogen!"
[ -f "crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls/server.crt" ] \
  || err "Peer0 TLS cert missing after cryptogen!"
ok "TLS certs verified"

# ─────────────────────────────────────────────────────────────
# STEP 6 — Generate channel artifacts
# ─────────────────────────────────────────────────────────────
log "Creating channel artifacts..."
mkdir -p channel-artifacts

configtxgen -profile TwoOrgsOrdererGenesis \
  -channelID system-channel \
  -outputBlock ./channel-artifacts/genesis.block
ok "Genesis block created"

configtxgen -profile TwoOrgsChannel \
  -outputCreateChannelTx ./channel-artifacts/otp-channel.tx \
  -channelID otp-channel
ok "Channel transaction created"

configtxgen -profile TwoOrgsChannel \
  -outputAnchorPeersUpdate ./channel-artifacts/Org1MSPanchors.tx \
  -channelID otp-channel \
  -asOrg Org1MSP
ok "Anchor peer tx created"

# ─────────────────────────────────────────────────────────────
# STEP 7 — Write corrected docker-compose.yml
# ─────────────────────────────────────────────────────────────
log "Writing corrected docker-compose-fabric.yml (Fabric network only)..."
cat > docker-compose-fabric.yml << 'COMPOSE'
version: '3.8'

networks:
  fabric_net:
    driver: bridge

volumes:
  orderer_data:
  peer0_data:
  peer1_data:

services:

  orderer.otp.com:
    image: hyperledger/fabric-orderer:2.5
    container_name: orderer.otp.com
    environment:
      - FABRIC_LOGGING_SPEC=INFO
      - ORDERER_GENERAL_LISTENADDRESS=0.0.0.0
      - ORDERER_GENERAL_LISTENPORT=7050
      - ORDERER_GENERAL_LOCALMSPID=OrdererMSP
      - ORDERER_GENERAL_LOCALMSPDIR=/var/hyperledger/orderer/msp
      - ORDERER_GENERAL_TLS_ENABLED=true
      - ORDERER_GENERAL_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key
      - ORDERER_GENERAL_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt
      - ORDERER_GENERAL_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
      - ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE=/var/hyperledger/orderer/tls/server.crt
      - ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY=/var/hyperledger/orderer/tls/server.key
      - ORDERER_GENERAL_CLUSTER_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
      - ORDERER_GENERAL_BOOTSTRAPMETHOD=file
      - ORDERER_GENERAL_BOOTSTRAPFILE=/var/hyperledger/orderer/orderer.genesis.block
      - ORDERER_CHANNELPARTICIPATION_ENABLED=true
      - ORDERER_ADMIN_TLS_ENABLED=true
      - ORDERER_ADMIN_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt
      - ORDERER_ADMIN_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key
      - ORDERER_ADMIN_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
      - ORDERER_ADMIN_LISTENADDRESS=0.0.0.0:9443
      - ORDERER_OPERATIONS_LISTENADDRESS=orderer.otp.com:8443
    ports:
      - "7050:7050"
      - "9443:9443"
    volumes:
      - orderer_data:/var/hyperledger/production/orderer
      - ./channel-artifacts/genesis.block:/var/hyperledger/orderer/orderer.genesis.block
      - ./crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp:/var/hyperledger/orderer/msp
      - ./crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/tls:/var/hyperledger/orderer/tls
    networks:
      - fabric_net
    restart: unless-stopped

  couchdb0:
    image: couchdb:3.3
    container_name: couchdb0
    environment:
      - COUCHDB_USER=admin
      - COUCHDB_PASSWORD=adminpw
    ports:
      - "5984:5984"
    networks:
      - fabric_net
    restart: unless-stopped

  couchdb1:
    image: couchdb:3.3
    container_name: couchdb1
    environment:
      - COUCHDB_USER=admin
      - COUCHDB_PASSWORD=adminpw
    ports:
      - "6984:5984"
    networks:
      - fabric_net
    restart: unless-stopped

  peer0.org1.otp.com:
    image: hyperledger/fabric-peer:2.5
    container_name: peer0.org1.otp.com
    environment:
      - CORE_VM_ENDPOINT=unix:///host/var/run/docker.sock
      - CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE=docker_fabric_net
      - FABRIC_LOGGING_SPEC=INFO
      - CORE_PEER_TLS_ENABLED=true
      - CORE_PEER_PROFILE_ENABLED=false
      - CORE_PEER_TLS_CERT_FILE=/etc/hyperledger/fabric/tls/server.crt
      - CORE_PEER_TLS_KEY_FILE=/etc/hyperledger/fabric/tls/server.key
      - CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/tls/ca.crt
      - CORE_PEER_ID=peer0.org1.otp.com
      - CORE_PEER_ADDRESS=peer0.org1.otp.com:7051
      - CORE_PEER_LISTENADDRESS=0.0.0.0:7051
      - CORE_PEER_CHAINCODEADDRESS=peer0.org1.otp.com:7052
      - CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:7052
      - CORE_PEER_GOSSIP_BOOTSTRAP=peer1.org1.otp.com:8051
      - CORE_PEER_GOSSIP_EXTERNALENDPOINT=peer0.org1.otp.com:7051
      - CORE_PEER_GOSSIP_USELEADERELECTION=true
      - CORE_PEER_GOSSIP_ORGLEADER=false
      - CORE_PEER_LOCALMSPID=Org1MSP
      - CORE_LEDGER_STATE_STATEDATABASE=CouchDB
      - CORE_LEDGER_STATE_COUCHDBCONFIG_COUCHDBADDRESS=couchdb0:5984
      - CORE_LEDGER_STATE_COUCHDBCONFIG_USERNAME=admin
      - CORE_LEDGER_STATE_COUCHDBCONFIG_PASSWORD=adminpw
      - CORE_OPERATIONS_LISTENADDRESS=peer0.org1.otp.com:9444
    ports:
      - "7051:7051"
      - "9444:9444"
    volumes:
      - peer0_data:/var/hyperledger/production
      - /var/run/docker.sock:/host/var/run/docker.sock
      - ./crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/msp:/etc/hyperledger/fabric/msp
      - ./crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls:/etc/hyperledger/fabric/tls
    networks:
      - fabric_net
    depends_on:
      - couchdb0
      - orderer.otp.com
    restart: unless-stopped

  peer1.org1.otp.com:
    image: hyperledger/fabric-peer:2.5
    container_name: peer1.org1.otp.com
    environment:
      - CORE_VM_ENDPOINT=unix:///host/var/run/docker.sock
      - CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE=docker_fabric_net
      - FABRIC_LOGGING_SPEC=INFO
      - CORE_PEER_TLS_ENABLED=true
      - CORE_PEER_PROFILE_ENABLED=false
      - CORE_PEER_TLS_CERT_FILE=/etc/hyperledger/fabric/tls/server.crt
      - CORE_PEER_TLS_KEY_FILE=/etc/hyperledger/fabric/tls/server.key
      - CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/tls/ca.crt
      - CORE_PEER_ID=peer1.org1.otp.com
      - CORE_PEER_ADDRESS=peer1.org1.otp.com:8051
      - CORE_PEER_LISTENADDRESS=0.0.0.0:8051
      - CORE_PEER_CHAINCODEADDRESS=peer1.org1.otp.com:8052
      - CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:8052
      - CORE_PEER_GOSSIP_BOOTSTRAP=peer0.org1.otp.com:7051
      - CORE_PEER_GOSSIP_EXTERNALENDPOINT=peer1.org1.otp.com:8051
      - CORE_PEER_GOSSIP_USELEADERELECTION=true
      - CORE_PEER_GOSSIP_ORGLEADER=false
      - CORE_PEER_LOCALMSPID=Org1MSP
      - CORE_LEDGER_STATE_STATEDATABASE=CouchDB
      - CORE_LEDGER_STATE_COUCHDBCONFIG_COUCHDBADDRESS=couchdb1:5984
      - CORE_LEDGER_STATE_COUCHDBCONFIG_USERNAME=admin
      - CORE_LEDGER_STATE_COUCHDBCONFIG_PASSWORD=adminpw
      - CORE_OPERATIONS_LISTENADDRESS=peer1.org1.otp.com:9445
    ports:
      - "8051:8051"
      - "9445:9445"
    volumes:
      - peer1_data:/var/hyperledger/production
      - /var/run/docker.sock:/host/var/run/docker.sock
      - ./crypto-config/peerOrganizations/org1.otp.com/peers/peer1.org1.otp.com/msp:/etc/hyperledger/fabric/msp
      - ./crypto-config/peerOrganizations/org1.otp.com/peers/peer1.org1.otp.com/tls:/etc/hyperledger/fabric/tls
    networks:
      - fabric_net
    depends_on:
      - couchdb1
      - orderer.otp.com
    restart: unless-stopped
COMPOSE
ok "docker-compose-fabric.yml written"

# ─────────────────────────────────────────────────────────────
# STEP 8 — Start Fabric containers
# ─────────────────────────────────────────────────────────────
log "Starting Fabric network..."
docker-compose -f docker-compose-fabric.yml up -d
log "Waiting 20s for nodes to initialize..."
sleep 20

# Verify containers are up
for c in orderer.otp.com peer0.org1.otp.com peer1.org1.otp.com; do
  STATUS=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || echo "false")
  if [ "$STATUS" = "true" ]; then
    ok "Container $c is running"
  else
    warn "Container $c is NOT running — check: docker logs $c"
  fi
done

# ─────────────────────────────────────────────────────────────
# STEP 9 — Create and join channel
# ─────────────────────────────────────────────────────────────
log "Creating channel otp-channel..."

ORDERER_CA="$(pwd)/crypto-config/ordererOrganizations/otp.com/orderers/orderer.otp.com/msp/tlscacerts/tlsca.otp.com-cert.pem"
PEER0_TLS="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/peers/peer0.org1.otp.com/tls/ca.crt"
PEER1_TLS="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/peers/peer1.org1.otp.com/tls/ca.crt"
ADMIN_MSP="$(pwd)/crypto-config/peerOrganizations/org1.otp.com/users/Admin@org1.otp.com/msp"

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH="$ADMIN_MSP"
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_TLS"

peer channel create \
  -o localhost:7050 \
  -c otp-channel \
  -f ./channel-artifacts/otp-channel.tx \
  --tls \
  --cafile "$ORDERER_CA" \
  --outputBlock ./channel-artifacts/otp-channel.block
ok "Channel otp-channel created"

log "Joining peer0..."
peer channel join -b ./channel-artifacts/otp-channel.block
ok "peer0 joined channel"

log "Joining peer1..."
export CORE_PEER_ADDRESS=localhost:8051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER1_TLS"
peer channel join -b ./channel-artifacts/otp-channel.block
ok "peer1 joined channel"

log "Updating anchor peers..."
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_TLS"
peer channel update \
  -o localhost:7050 \
  -c otp-channel \
  -f ./channel-artifacts/Org1MSPanchors.tx \
  --tls \
  --cafile "$ORDERER_CA"
ok "Anchor peers updated"

# ─────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Fabric network is UP and channel is ready!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  Channel:  otp-channel"
echo "  Orderer:  localhost:7050"
echo "  Peer0:    localhost:7051"
echo "  Peer1:    localhost:8051"
echo "  CouchDB0: http://localhost:5984"
echo "  CouchDB1: http://localhost:6984"
echo ""
echo "  Next step: deploy chaincode"
echo "  Run: ./deploy-chaincode.sh"
echo ""
