# syntax=docker/dockerfile:1.7

FROM node:22-slim AS client-build
WORKDIR /app
# Install from the lockfile: a lockfile-less `npm install` of this workspace
# trips npm's "Cannot read properties of null (reading 'edgesOut')" bug.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci
COPY client/ ./client/
RUN npm run build --workspace=client

FROM node:22-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
# Workspace deps are hoisted to /app/node_modules; server/node_modules only
# exists when npm has to nest a conflicting version, so make sure the COPY
# in the runtime stage always has a source.
RUN npm ci --omit=dev --workspace=server \
    && mkdir -p server/node_modules

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

