FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
LABEL org.opencontainers.image.title="simple-kanban" \
      org.opencontainers.image.description="A deliberately boring kanban board: Next.js + SQLite. With a one-command WeKan importer." \
      org.opencontainers.image.source="https://github.com/rouralberto/simple-kanban" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
VOLUME /data
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
