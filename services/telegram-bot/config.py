from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
        if not self.WEBHOOK_BASE_URL or not self.WEBHOOK_SECRET:
            raise ValueError("webhook mode requires WEBHOOK_BASE_URL and WEBHOOK_SECRET")


config = Settings()
