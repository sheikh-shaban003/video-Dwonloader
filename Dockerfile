# Single-container deployment: website + yt-dlp/FFmpeg + AI image API.
# Deploy this repository root on a Docker-capable host for one public URL.
FROM node:24-bookworm-slim AS assets
WORKDIR /src
COPY index.html logo.svg favicon.svg robots.txt ./
COPY css ./css
COPY js ./js
COPY scripts/build-netlify.mjs ./scripts/build-netlify.mjs
RUN node scripts/build-netlify.mjs

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/public
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && python3 -m venv /opt/yt-dlp-venv \
 && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade 'yt-dlp[default]' \
 && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
 && yt-dlp --version \
 && ffmpeg -version | head -n 1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY server/server.js ./server.js
COPY --from=assets /src/public ./public
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
