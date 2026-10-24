FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/backend
COPY services/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/backend/ ./
COPY src/assets/fonts/ ./assets/fonts/
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--no-proxy-headers"]
