# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Workspace packages' manifests too, so the install covers every importer in the lockfile.
COPY services/server/package.json services/server/
RUN pnpm install --frozen-lockfile
COPY . .

# Switches are compiled into the site. Rebuild to change them; runtime env cannot change the app.
ARG BUILD_PROFILE=internal
ARG VITE_DISABLE_SHARE_LINKS
ARG VITE_DISABLE_LINK_OPEN
ARG VITE_DISABLE_AI_TOOLS
ARG VITE_DISABLE_ONDEVICE
ARG VITE_PRIVATE_BY_DEFAULT
ARG VITE_BRAND_NAME
ARG VITE_LOCALES
RUN node scripts/build-container.mjs

# Hosting configuration changes reuse the compiled app layer.
ARG BASE_PATH=/
ARG FRAME_ANCESTORS=
RUN pnpm self-host:prepare --base "$BASE_PATH" \
    && pnpm headers:self-host --base "$BASE_PATH" --frame-ancestors "$FRAME_ANCESTORS" --out /headers \
    && mkdir -p "/site${BASE_PATH}" && cp -R dist/. "/site${BASE_PATH}"

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY --from=build /site/ /usr/share/nginx/html/
COPY --from=build /headers/docker/default.conf /etc/nginx/conf.d/default.conf
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
