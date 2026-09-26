from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr

class Settings(BaseSettings):
    TELEGRAM_BOT_TOKEN: SecretStr
    BOT_SERVICE_SECRET: SecretStr
    INTERNAL_API_URL: str = "http://localhost:3000/api/internal/telegram"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

config = Settings()
