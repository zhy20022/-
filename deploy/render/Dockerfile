FROM node:22-alpine AS dependencies
WORKDIR /app
COPY server-nest/package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY server-nest/ ./
RUN npm run build

FROM postgres:18-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache nodejs npm python3
ENV BATTLE_WORKER_ROOT=/workspace
ENV CONTENT_DIR=/workspace/data/content
COPY server-nest/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY data/content /workspace/data/content
COPY src /workspace/src
COPY scripts/nest_battle_worker.py /workspace/scripts/nest_battle_worker.py
USER postgres
CMD ["npm", "run", "start:render"]
