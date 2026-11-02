# Learners Area Telegram bot

Python 3.11+ va aiogram 3. Saytning ichki API sida ishlaydi. O'zi foydalanuvchi bazasi yaratmaydi.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
BOT_MODE=polling python bot.py
```

Production: `BOT_MODE=webhook`. Health: `GET /health`.

People opens a directory with 10 people per page. Buttons show numbered names
and usernames, for example `1. Nurmuhammad - @uzriw`. The directory API sorts
globally by username, ignoring case, with people without usernames at the end.
Deploy the directory API update together with the bot update to enable this
ordering. Search remains available by typing a name, email, username or Telegram ID.

To'liq qadamlar: `docs/TELEGRAM-BOT-SETUP.md`.

