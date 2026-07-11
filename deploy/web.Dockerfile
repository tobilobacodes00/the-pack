# Pack frontend — built to static files, served by nginx which also reverse-proxies the
# engine (/api) and the gateway WS (/ws). Build context: repo root.
#   docker build -f deploy/web.Dockerfile -t pack-web .
FROM node:20-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.33.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
# Same-origin behind nginx: REST at /api, WS at /ws (the WS client resolves /ws → wss://host/ws).
# NOTE: the var name MUST match what the app reads (frontend/src/env.ts → VITE_GATEWAY_URL).
ARG VITE_ENGINE_URL=/api
ARG VITE_GATEWAY_URL=/ws
ENV VITE_ENGINE_URL=$VITE_ENGINE_URL
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN pnpm build

# nginx-unprivileged runs fully as a non-root user (uid 101) and listens on 8080 (a non-root
# can't bind :80). The compose maps host 80 → container 8080. Config + assets go to the same paths.
FROM nginxinc/nginx-unprivileged:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
