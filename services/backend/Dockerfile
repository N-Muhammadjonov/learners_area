FROM node:24-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/vanilla/ ./frontend/vanilla/
RUN ln -s /build/node_modules /build/frontend/vanilla/node_modules && node frontend/vanilla/scripts/build.mjs

FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/app
COPY services/backend/requirements.txt ./services/backend/requirements.txt
RUN pip install --no-cache-dir -r services/backend/requirements.txt
COPY services/backend/app/ ./services/backend/app/
COPY services/backend/assets/ ./services/backend/assets/
COPY src/assets/fonts/ ./src/assets/fonts/
COPY --from=assets /build/frontend/vanilla/build/ ./frontend/vanilla/build/
COPY scripts/serve.py ./scripts/serve.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
ENV HOST=0.0.0.0 PORT=8000 APP_ENV=production NODE_ENV=production
CMD ["python", "scripts/serve.py"]
