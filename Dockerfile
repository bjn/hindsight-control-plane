FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public

ENV PORT=9999 \
    HOSTNAME=0.0.0.0 \
    HINDSIGHT_API_URL=http://hindsight-memory:8888

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:9999/health || exit 1

CMD ["node", "server.js"]
