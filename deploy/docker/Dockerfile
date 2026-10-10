# syntax=docker/dockerfile:1
#
# One image per product. The framework pack is baked in at build time:
#   docker build -f deploy/docker/Dockerfile --build-arg PRODUCT=align -t align-app .
#
# The image runs either half of the product. The API is the default; the
# background worker is the same image with a different command, which is what
# compose.yaml does. They share the data volume and must not be given separate
# ones: it is one SQLite file.

# ── build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
ARG PRODUCT=align
ENV PRODUCT=${PRODUCT}

# better-sqlite3 13 carries a ready-made driver for Alpine (musl) in its
# package, and pnpm is told never to compile it (package.json). The toolchain
# is here for argon2, which compiles itself when it has no ready-made driver
# for this Node. The build stage carries it; the runtime stage only receives
# the finished .node binaries.
RUN apk add --no-cache python3 make g++ \
 && corepack enable
WORKDIR /src

# Install with the lockfile first so dependency layers cache well.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @offset/api build \
 && PRODUCT=${PRODUCT} pnpm --filter @offset/web build \
 && pnpm prune --prod

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ARG PRODUCT=align
ARG APP_VERSION=0.1.0
# HOST=0.0.0.0 here is not the same decision as exposing a machine. A container
# has its own network, and binding to loopback inside it would mean the
# published port reaches nothing at all. The isolation comes from compose, which
# publishes to 127.0.0.1 on the host. TLS is either served here, when
# TLS_CERT_FILE and TLS_KEY_FILE are set, or at a reverse proxy in front.
# ALLOW_INSECURE_NETWORK says that out loud rather than letting it be assumed.
#
# OFFSET_VERSION is the version the application reports. Not APP_VERSION: .env
# uses that name to choose the image tag, compose passes .env into the
# container, and it overrode this - so an updated container still reported its
# old version and the updater rolled every update back.
ENV NODE_ENV=production \
    PRODUCT=${PRODUCT} \
    APP_VERSION=${APP_VERSION} \
    OFFSET_VERSION=${APP_VERSION} \
    PORT=8080 \
    HOST=0.0.0.0 \
    ALLOW_INSECURE_NETWORK=true

# dumb-init reaps zombies and forwards signals so shutdown is clean.
RUN apk add --no-cache dumb-init tzdata \
 && addgroup -g 10001 -S offset \
 && adduser -u 10001 -S offset -G offset

WORKDIR /app

# The workspace shape has to survive into the image.
#
# pnpm does not copy a package's dependencies into its own node_modules; it
# links them to a store two directories up. So apps/api/node_modules/fastify is
# a symlink to ../../node_modules/.pnpm/fastify@.../node_modules/fastify, and
# that link is only valid while the two folders keep their relative positions.
# Flattening this to /app/dist with /app/node_modules alongside it looks tidier
# and fails at the first import.
#
# Everything the application resolves for itself is relative to dist, so the
# assets move with it: public one level up, pack two.
COPY --from=build --chown=offset:offset /src/node_modules ./node_modules
COPY --from=build --chown=offset:offset /src/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=offset:offset /src/apps/api/dist ./apps/api/dist
COPY --from=build --chown=offset:offset /src/dist/web/${PRODUCT} ./apps/api/public
COPY --from=build --chown=offset:offset /src/packs/${PRODUCT} ./apps/api/pack

# Everything that has to outlive the container. Mount volumes over all four
# or they die with it, and the first one is the database.
ENV DATABASE_URL=file:/app/data/offset.db \
    BACKUP_DIR=/app/backups \
    LOG_DIR=/app/logs \
    LOG_TO_FILE=true
# /app/updates holds the handoff to the updater container. Created here so a
# fresh named volume mounted over it starts owned by the application user.
RUN mkdir -p /app/data /app/evidence /app/backups /app/logs /app/updates/request /app/updates/status \
 && chown -R offset:offset /app

# The licence has to travel with the product, not just with the installer.
COPY --chown=offset:offset LICENSE /app/LICENSE.txt

USER offset
# The application, not the workspace root. Everything it writes is named by an
# absolute path in the environment above, so the data volumes stay at /app.
WORKDIR /app/apps/api
EXPOSE 8080

LABEL org.opencontainers.image.title="Offset GRC (${PRODUCT})" \
      org.opencontainers.image.description="Free to use, closed source." \
      org.opencontainers.image.vendor="Offset Security" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/offsetsecurity/offset-irtiqa" \
      org.opencontainers.image.licenses="LicenseRef-Offset-Community-Edition"

# Only meaningful for the API. The worker listens on nothing, so compose
# turns this off for it rather than letting it report itself permanently sick.
#
# HTTPS first, then HTTP: a certificate uploaded on the Settings screen turns
# HTTPS on without the environment saying so. The certificate is not checked:
# it is issued for the name people use, not "localhost" inside the container,
# and this only asks whether the process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const g=(m,f)=>require(m).get({host:'localhost',port:8080,path:'/api/v1/health',rejectUnauthorized:false},r=>r.statusCode===200?process.exit(0):f()).on('error',f);g('https',()=>g('http',()=>process.exit(1)))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

# ── updater ─────────────────────────────────────────────────────────────────
# The container that installs updates. Built with --target updater.
#
# The same image as the application plus the Docker CLI and compose, so the
# signature checking it runs is byte-for-byte the code the application ships.
# It runs as root because it needs the Docker socket, and it is the only
# container given it. It has no web page and listens on nothing.
FROM runtime AS updater
USER root
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29-cli /usr/local/libexec/docker/cli-plugins/docker-compose \
     /usr/local/libexec/docker/cli-plugins/docker-compose
HEALTHCHECK NONE
CMD ["node", "dist/updater/docker.js"]

# ── default ─────────────────────────────────────────────────────────────────
# The last stage is what a plain `docker build` produces, so it is the
# application again. Without this, adding the updater above would silently have
# turned every untargeted build into an updater image.
FROM runtime
# Inherited from runtime already. Said again because a scanner reads the file,
# not the graph: the last USER in the file was the updater's root, and Trivy
# failed every build on it (DS-0002). The updater still runs as root, which it
# must, being the only container given the Docker socket.
USER offset
