# Makefile for Hyperledger Fabric OTP Project
# Usage: make <target>

.PHONY: help clean clean-containers clean-images clean-volumes clean-networks clean-fabric clean-all fresh-start down stop status

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m

# Project paths
FABRIC_PATH := /home/vishnu/Downloads/blockchain-otp-complete/blockchain-otp/devops/fabric-samples/test-network
DOCKER_COMPOSE_FILE := docker-compose.yml

help:
	@echo "$(BLUE)Available Make Commands:$(NC)"
	@echo "$(GREEN)make help$(NC)            - Show this help message"
	@echo "$(GREEN)make status$(NC)          - Show current Docker status"
	@echo "$(GREEN)make stop$(NC)            - Stop all containers"
	@echo "$(GREEN)make down$(NC)             - Stop and remove containers"
	@echo "$(GREEN)make clean-containers$(NC) - Remove all containers"
	@echo "$(GREEN)make clean-images$(NC)     - Remove all Docker images"
	@echo "$(GREEN)make clean-volumes$(NC)    - Remove all Docker volumes"
	@echo "$(GREEN)make clean-networks$(NC)   - Remove custom Docker networks"
	@echo "$(GREEN)make clean-fabric$(NC)     - Remove Fabric artifacts"
	@echo "$(GREEN)make clean-all$(NC)        - Clean everything"
	@echo "$(GREEN)make fresh-start$(NC)      - Complete fresh start"
	@echo "$(GREEN)make prune$(NC)            - Docker system prune"
	@echo "$(GREEN)make logs$(NC)             - Show container logs"
	@echo "$(GREEN)make ps$(NC)               - Show running containers"

status:
	@echo "$(BLUE)=== Docker Status ===$(NC)"
	@echo "$(YELLOW)Containers:$(NC)"
	@docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || echo "No containers"
	@echo "\n$(YELLOW)Images:$(NC)"
	@docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | head -10 || echo "No images"
	@echo "\n$(YELLOW)Volumes:$(NC)"
	@docker volume ls || echo "No volumes"
	@echo "\n$(YELLOW)Networks:$(NC)"
	@docker network ls | grep -v "bridge\|host\|none" || echo "No custom networks"

stop:
	@echo "$(YELLOW)Stopping all containers...$(NC)"
	@docker stop $(shell docker ps -q) 2>/dev/null || echo "No running containers"
	@echo "$(GREEN)All containers stopped$(NC)"

down:
	@echo "$(YELLOW)Stopping and removing containers...$(NC)"
	@cd $(FABRIC_PATH) && docker-compose down 2>/dev/null || true
	@docker-compose down 2>/dev/null || true
	@echo "$(GREEN)Containers removed$(NC)"

clean-containers:
	@echo "$(RED)Removing all containers...$(NC)"
	@docker stop $(shell docker ps -aq) 2>/dev/null || true
	@docker rm $(shell docker ps -aq) 2>/dev/null || true
	@echo "$(GREEN)All containers removed$(NC)"

clean-images:
	@echo "$(RED)Removing all Docker images...$(NC)"
	@docker rmi $(shell docker images -q) 2>/dev/null || true
	@echo "$(GREEN)All images removed$(NC)"

clean-volumes:
	@echo "$(RED)Removing all Docker volumes...$(NC)"
	@docker volume rm $(shell docker volume ls -q) 2>/dev/null || true
	@echo "$(GREEN)All volumes removed$(NC)"

clean-networks:
	@echo "$(RED)Removing custom Docker networks...$(NC)"
	@docker network prune -f
	@docker network rm $(shell docker network ls -q | grep -v "bridge\|host\|none") 2>/dev/null || true
	@echo "$(GREEN)Custom networks removed$(NC)"

clean-fabric:
	@echo "$(RED)Cleaning Fabric artifacts...$(NC)"
	@cd $(FABRIC_PATH) && rm -rf channel-artifacts/* organizations/* system-genesis-block/* crypto-config/* 2>/dev/null || true
	@rm -rf wallet/ 2>/dev/null || true
	@echo "$(GREEN)Fabric artifacts cleaned$(NC)"

clean-all: clean-containers clean-images clean-volumes clean-networks
	@echo "$(GREEN)Complete Docker cleanup finished$(NC)"

prune:
	@echo "$(YELLOW)Pruning Docker system...$(NC)"
	@docker system prune -f
	@echo "$(GREEN)System pruned$(NC)"

prune-all:
	@echo "$(RED)Pruning everything including volumes...$(NC)"
	@docker system prune -a --volumes -f
	@echo "$(GREEN)Complete system prune finished$(NC)"

fresh-start: stop clean-all clean-fabric prune-all
	@echo "$(GREEN)Fresh start ready$(NC)"
	@echo "Next steps:"
	@echo "1. cd $(FABRIC_PATH)"
	@echo "2. ./network.sh up"
	@echo "3. ./network.sh createChannel -c otpchannel"

logs:
	@echo "$(BLUE)Showing container logs...$(NC)"
	@docker-compose logs --tail=50 || echo "No docker-compose.yml found"
	@docker logs --tail=50 $(shell docker ps -q) 2>/dev/null || echo "No containers running"

ps:
	@echo "$(BLUE)Running containers:$(NC)"
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

restart: down
	@echo "$(YELLOW)Restarting containers...$(NC)"
	@cd $(FABRIC_PATH) && docker-compose up -d
	@echo "$(GREEN)Containers restarted$(NC)"

