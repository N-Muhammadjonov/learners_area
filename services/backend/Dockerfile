FROM python:3.14-slim AS assets
WORKDIR /build
COPY frontend/vanilla/ ./frontend/vanilla/
COPY scripts/build_native_assets.py ./scripts/build_native_assets.py
RUN pip install --no-cache-dir rjsmin==1.2.5 rcssmin==1.2.2 && python scripts/build_native_assets.py

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/app
COPY services/backend/requirements.txt ./services/backend/requirements.txt
RUN pip install --no-cache-dir -r services/backend/requirements.txt
COPY services/backend/app/ ./services/backend/app/
COPY services/backend/assets/ ./services/backend/assets/
COPY --from=assets /build/frontend/vanilla/build/ ./frontend/vanilla/build/
COPY scripts/serve.py ./scripts/serve.py
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 APP_ENV=production
EXPOSE 8000
CMD ["python", "scripts/serve.py"]
