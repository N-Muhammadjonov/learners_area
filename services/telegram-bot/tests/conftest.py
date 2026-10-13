import os
# Set test env vars BEFORE anything imports config
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-12345")
os.environ.setdefault("BOT_SERVICE_SECRET", "test-secret-67890")
os.environ.setdefault("INTERNAL_API_URL", "http://localhost:3000/api/internal/telegram")
