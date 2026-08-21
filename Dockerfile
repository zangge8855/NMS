# syntax=docker/dockerfile:1.7

FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm install
COPY client/ ./client/
RUN npm run build --workspace=client

FROM node:22-slim AS server-deps
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace=server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=server-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=server-deps --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node server/ ./server/
COPY --from=client-build --chown=node:node /app/client/dist ./client/dist

RUN mkdir -p /app/data /app/logs \
    && chown -R node:node /app/data /app/logs

VOLUME ["/app/data", "/app/logs"]

EXPOSE 3000
USER node
CMD ["node", "server/index.js"]

