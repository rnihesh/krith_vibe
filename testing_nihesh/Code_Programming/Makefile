# Makefile for SEFS project

.PHONY: dev build test clean install

# Development
dev: install
	@echo "Starting development servers..."
	cd backend && uv run uvicorn app.main:app --reload --port 8484 &
	cd frontend && npm run dev &
	wait

# Production build
build:
	cd frontend && npm run build
	cd frontend && cargo tauri build

# Install dependencies
install:
	cd backend && uv sync
	cd frontend && npm install

# Run tests
test:
	cd backend && uv run pytest
	cd frontend && npm test

# Clean build artifacts
clean:
	rm -rf frontend/dist
	rm -rf frontend/src-tauri/target
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -name "*.pyc" -delete

# Database operations
db-reset:
	rm -f backend/sefs.db
	@echo "Database reset. Will be recreated on next start."

db-backup:
	cp backend/sefs.db backend/sefs.db.bak
	@echo "Database backed up to sefs.db.bak"
