# Learners Area Telegram bot

Python 3.11+ va aiogram 3. Saytning ichki API sida ishlaydi. O'zi foydalanuvchi bazasi yaratmaydi.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
BOT_MODE=polling python bot.py
```

Production: `BOT_MODE=webhook`. Health: `GET /health`.

To'liq qadamlar: `docs/TELEGRAM-BOT-SETUP.md`.
