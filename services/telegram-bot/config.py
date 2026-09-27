from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from security_policy import owner_id_problem, webhook_secret_problem


class Settings(BaseSettings):
    TELEGRAM_BOT_TOKEN: SecretStr
    BOT_SERVICE_SECRET: SecretStr
    INTERNAL_API_URL: str = "http://localhost:3000/api/internal/telegram"
    TELEGRAM_OWNER_ID: str | None = None
    TELEGRAM_BOT_USERNAME: str | None = None
    PUBLIC_SITE_URL: str = "http://localhost:3000"
    BOT_MODE: str = "polling"
    WEBHOOK_BASE_URL: str | None = None
    WEBHOOK_SECRET: SecretStr | None = None
    WEBHOOK_PATH: str = "/telegram/webhook"
    HOST: str = "0.0.0.0"
    PORT: int = 8080

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("BOT_MODE")
    @classmethod
    def mode_is_explicit(cls, value: str) -> str:
        mode = value.strip().lower()
        if mode not in {"polling", "webhook"}:
            raise ValueError("BOT_MODE must be polling or webhook")
        return mode

    def require_webhook(self) -> None:
        if self.BOT_MODE != "webhook":
            return
        if not self.WEBHOOK_BASE_URL:
            raise ValueError("webhook mode requires WEBHOOK_BASE_URL")
        secret = self.WEBHOOK_SECRET.get_secret_value() if self.WEBHOOK_SECRET else None
        problem = webhook_secret_problem(secret)
        if problem:
            raise ValueError(problem)
        if not self.WEBHOOK_BASE_URL.lower().startswith("https://"):
            raise ValueError("WEBHOOK_BASE_URL must use https in webhook mode")

    def validate_startup(self) -> None:
        """Fail before opening sessions or calling Telegram. Never include secret values."""
        self.require_webhook()
        if not self.INTERNAL_API_URL.lower().startswith(("http://", "https://")):
            raise ValueError("INTERNAL_API_URL must be an http(s) URL")
        if self.BOT_MODE == "webhook":
            owner = owner_id_problem(self.TELEGRAM_OWNER_ID)
            if owner:
                raise ValueError(owner)
            if self.PUBLIC_SITE_URL.lower().startswith("http://"):
                raise ValueError("PUBLIC_SITE_URL must use https in webhook mode")
        elif self.TELEGRAM_OWNER_ID and owner_id_problem(self.TELEGRAM_OWNER_ID):
            raise ValueError("TELEGRAM_OWNER_ID format is invalid")


config = Settings()
