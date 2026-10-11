# syntax=docker/dockerfile:1
# The Nebiru application: the web app, built, and the server that serves it and the API.

FROM node:24-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build


FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NEBIRU_STATIC_DIR=/app/dist \
    NEBIRU_DATA_DIR=/data
WORKDIR /app
COPY server/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY server/app ./app
COPY --from=web /build/dist ./dist
COPY docker/app/entrypoint.sh /usr/local/bin/nebiru-entrypoint
RUN chmod +x /usr/local/bin/nebiru-entrypoint

EXPOSE 8787
ENTRYPOINT ["nebiru-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
