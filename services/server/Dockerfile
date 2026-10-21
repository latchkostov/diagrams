# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/server/package.json services/server/
COPY integrations/confluence-forge/package.json integrations/confluence-forge/
RUN pnpm install --frozen-lockfile
COPY . .

FROM dependencies AS ui
ARG VITE_BRAND_NAME
ARG VITE_LOCALES
ARG VITE_DISABLE_ONDEVICE
ARG FRAME_ANCESTORS=
# The internal profile retains Private by default. No public discovery or cross-origin relay.
ENV VITE_COLLAB=server VITE_COLLAB_SERVER=""
RUN node scripts/build-container.mjs
RUN pnpm headers:self-host --frame-ancestors "$FRAME_ANCESTORS" --out /headers

FROM dependencies AS server
RUN pnpm --filter @livediagrams/server build

FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production LD_STATIC_DIR=/app/site
COPY --from=server /app/services/server/dist/main.js ./main.js
COPY --from=server /app/services/server/package.json ./package.json
COPY --from=ui /app/dist/ ./site/
COPY --from=ui /headers/headers.json ./site/headers.json
USER nonroot:nonroot
EXPOSE 8080
# Deploy with a read-only root; the process needs no writable mounts.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/nodejs/bin/node", "main.js", "--healthcheck"]
CMD ["main.js"]
