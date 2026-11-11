FROM node:24-bookworm-slim AS browser-bundler
WORKDIR /build
COPY frontend/vanilla/ ./frontend/vanilla/
COPY scripts/bundle_browser.mjs ./scripts/bundle_browser.mjs
RUN npm install --no-save --no-package-lock --ignore-scripts --no-audit --no-fund rollup@4.52.5 \
    && node scripts/bundle_browser.mjs

FROM python:3.14-slim AS assets
WORKDIR /build
COPY frontend/vanilla/ ./frontend/vanilla/
COPY services/backend/app/ ./services/backend/app/
COPY scripts/build_native_assets.py ./scripts/build_native_assets.py
COPY --from=browser-bundler /build/bundle-output/ ./bundle-output/
RUN pip install --no-cache-dir rjsmin==1.2.5 rcssmin==1.2.2 \
    && LA_BROWSER_BUNDLES=/build/bundle-output python scripts/build_native_assets.py

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/app
COPY services/backend/requirements.txt ./services/backend/requirements.txt
RUN pip install --no-cache-dir -r services/backend/requirements.txt
COPY services/backend/app/ ./services/backend/app/
COPY services/backend/assets/ ./services/backend/assets/
COPY services/backend/contracts/ ./services/backend/contracts/
COPY services/live-signal/server.py ./services/live-signal/server.py
COPY --from=assets /build/frontend/vanilla/build/ ./frontend/vanilla/build/
COPY scripts/serve.py ./scripts/serve.py
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 APP_ENV=production
EXPOSE 8000
CMD ["python", "scripts/serve.py"]
