#!/bin/bash
# Deployment script for SEFS application
set -euo pipefail

APP_NAME="sefs"
DEPLOY_DIR="/opt/$APP_NAME"
BACKUP_DIR="/opt/backups/$APP_NAME"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Starting deployment of $APP_NAME"

# Backup current version
if [ -d "$DEPLOY_DIR" ]; then
    BACKUP="$BACKUP_DIR/$(date '+%Y%m%d_%H%M%S')"
    log "Backing up to $BACKUP"
    mkdir -p "$BACKUP"
    cp -r "$DEPLOY_DIR"/* "$BACKUP/"
fi

# Pull latest code
log "Pulling latest changes..."
cd "$DEPLOY_DIR" && git pull origin main

# Install dependencies
log "Installing Python dependencies..."
cd backend && uv sync

# Run migrations
log "Running database migrations..."
uv run python -m app.migrate

# Restart services
log "Restarting services..."
systemctl restart sefs-backend
systemctl restart sefs-frontend

log "Deployment complete!"
