ARG NODE_IMAGE=node:22.23.2-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends --yes g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.revision=$GIT_REVISION
ENV NODE_ENV=production
ENV PRD_GENIE_DATA_DIR=/data
ENV PRD_GENIE_MODEL_CACHE_DIR=/models
ENV PRD_GENIE_CONTAINER=1
ENV PRD_GENIE_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/prd-genie-entrypoint
RUN mkdir -p /data /models && chown -R node:node /app /data /models
EXPOSE 3210
ENTRYPOINT ["prd-genie-entrypoint"]
CMD ["node", "dist/server/server/index.js"]
