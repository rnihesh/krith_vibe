#!/usr/bin/env zsh
# ZSH configuration and utility functions

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Project directory navigation
sefs() {
    cd ~/projects/sefs || return 1
    echo "${GREEN}Switched to SEFS project${NC}"
}

# Quick database backup
db-backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    cp backend/sefs.db "backups/sefs_${timestamp}.db"
    echo "${GREEN}Database backed up: sefs_${timestamp}.db${NC}"
}

# Kill process on port
killport() {
    local port=${1:?Port number required}
    lsof -ti:$port | xargs kill -9 2>/dev/null
    echo "${RED}Killed processes on port $port${NC}"
}

# Quick git commit
gc() {
    git add -A && git commit -m "${*:?Commit message required}"
}
