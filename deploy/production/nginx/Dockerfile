FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=web-build /web/dist /usr/share/nginx/html
COPY deploy/production/nginx/templates /etc/nginx/templates
