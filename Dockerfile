# GYÁRTÁSTERVEZŐ – Docker kép
#
# Két lépés:
#   1. build:   Node.js-sel lefordítja az appot (npm ci + npm run build → dist/)
#   2. futtatás: nginx kiszolgálja a dist/ tartalmát a 80-as porton
# A kész képben nincs Node.js, csak nginx és a statikus fájlok (~2 MB).
#
# Használat (lásd INSTALL.md):
#   docker compose up -d --build                 → http://localhost:8080
#   docker build -t gyartas-tervezo .            (compose nélkül)
#   docker run -d -p 8080:80 gyartas-tervezo
#
# Node.js verzió: --build-arg NODE_VERSION=26 (alap: 22; Vite 8: 20.19+ vagy 22.12+)

ARG NODE_VERSION=22

# ---------- 1. build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Előbb csak a függőségek: ha a kód változik, de a package*.json nem,
# a Docker a telepítést a gyorsítótárból veszi.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- 2. futtatás ----------
FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
