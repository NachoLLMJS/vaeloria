# VAELORIA game server — serves the built client, REST API and WebSocket
# world on one port. Pair with a postgres service (see docker-compose.yml).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html admin.html gear-preview.html assets-gallery.html portraits.html ./
COPY src ./src
COPY server ./server
COPY headless ./headless
COPY scripts ./scripts
COPY public ./public

# Vite replaces import.meta.env.VITE_* at build time. Railway runtime
# variables are not visible inside Docker build RUN steps unless declared as
# build args/env here, so expose the public client config before npm run build.
ARG VITE_PRIVY_APP_ID
ARG VITE_PRIVY_CLIENT_ID
ARG VITE_SOLANA_RPC_URL
ARG VITE_SOLANA_RPC_WS_URL
ARG VITE_VAELORIA_TOKEN_MINT
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID
ENV VITE_PRIVY_CLIENT_ID=$VITE_PRIVY_CLIENT_ID
ENV VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL
ENV VITE_SOLANA_RPC_WS_URL=$VITE_SOLANA_RPC_WS_URL
ENV VITE_VAELORIA_TOKEN_MINT=$VITE_VAELORIA_TOKEN_MINT

RUN npm run build && cp -a dist/media ./media-build && rm -rf dist/media && npm run build:server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/media-build ./media-build
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/dist/media && chown -R node:node /app/dist/media
EXPOSE 8787
USER node
CMD ["sh", "-c", "mkdir -p /app/dist/media && node -e \"require('fs').cpSync('/app/media-build', '/app/dist/media', { recursive: true, force: true })\" && node dist-server/server.cjs"]
