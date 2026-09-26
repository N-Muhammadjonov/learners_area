import aiohttp
from typing import Optional, Dict, Any
from config import config

class ApiClient:
    def __init__(self):
        self.base_url = config.INTERNAL_API_URL.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {config.BOT_SERVICE_SECRET.get_secret_value()}",
            "Content-Type": "application/json"
        }

    async def get_user(self, telegram_user_id: str) -> Optional[Dict[str, Any]]:
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.get(f"{self.base_url}/users/{telegram_user_id}") as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("user")
                elif response.status == 404:
                    return None
                else:
                    text = await response.text()
                    raise Exception(f"Failed to get user: {response.status} {text}")

    async def confirm_intent(self, token: str, telegram_user_id: str) -> bool:
        async with aiohttp.ClientSession(headers=self.headers) as session:
            payload = {"token": token, "telegramUserId": telegram_user_id}
            async with session.post(f"{self.base_url}/auth/confirm", json=payload) as response:
                if response.status == 200:
                    return True
                return False

api_client = ApiClient()
