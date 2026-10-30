# Learners Area Telegram bot

Python 3.11+ va aiogram 3. Saytning ichki API sida ishlaydi. O'zi foydalanuvchi bazasi yaratmaydi.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
BOT_MODE=polling python bot.py
```

Production: `BOT_MODE=webhook`. Health: `GET /health`.

Login context is stored by the backend in an actor-bound private draft; memory
holds temporary UI/compose state only. Deploy the backend auth-context support
before this client. Phone, channel membership and nonce checks remain mandatory.
Webhook processing waits for the durable update claim; an unavailable backend
returns 503 so Telegram can retry. Already-admitted updates are not replayed after
a crash: repeat the command with a new update ID instead of duplicating side
effects. See `docs/TELEGRAM-AUTH-DURABILITY.md` in the repository.

To'liq qadamlar: `docs/TELEGRAM-BOT-SETUP.md`.
