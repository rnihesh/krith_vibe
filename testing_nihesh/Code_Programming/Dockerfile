FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir uv && uv sync

# Copy application code
COPY backend/app ./app

# Expose port
EXPOSE 8484

# Health check
HEALTHCHECK --interval=30s --timeout=10s \
    CMD curl --fail http://localhost:8484/api/health || exit 1

# Run the server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8484"]
