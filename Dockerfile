FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY frontend/ frontend/
COPY backend/src/ backend/src/
COPY fpk/ICON_256.PNG fpk/ICON_256.PNG
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
# Standalone TCP mode. The backend reserves production mode for the fnOS gateway.
ENV NODE_ENV=development HOST=0.0.0.0 PORT=4180 SHIYIN_DATA_DIR=/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
RUN mkdir /data && chown node:node /data

USER node
EXPOSE 4180
CMD ["node", "--import", "tsx", "backend/src/index.ts"]
