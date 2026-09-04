FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM postgres:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache nodejs npm
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER postgres
CMD ["node", "dist/main.js"]
