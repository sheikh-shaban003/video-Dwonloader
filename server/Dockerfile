FROM node:24-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 \
 && curl --fail --location --retry 3 --retry-delay 2 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && yt-dlp --version \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
