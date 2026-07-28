FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PRD_GENIE_DATA_DIR=/data
ENV PRD_GENIE_MODEL_CACHE_DIR=/models
ENV PRD_GENIE_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data /models && chown -R node:node /app /data /models
USER node
EXPOSE 3210
CMD ["npm", "start"]
