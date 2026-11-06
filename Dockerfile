FROM node:22-bookworm-slim AS web-build

WORKDIR /workspace/app/web
COPY app/web/package*.json ./
RUN npm ci
COPY app/web/ ./
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV BIND_HOST=0.0.0.0
WORKDIR /workspace/app/server

COPY app/server/package*.json ./
RUN npm ci --omit=dev
COPY app/server/ ./
COPY --from=web-build /workspace/app/web/dist /workspace/app/web/dist

CMD ["node", "server.js"]
