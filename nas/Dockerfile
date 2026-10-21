FROM node:24-trixie-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node nas/download-catalog.mjs
RUN npm run build:nas

FROM node:24-trixie-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 CATALOG_BIN=/app/bin/tuneweave
COPY nas/runtime/package.json nas/runtime/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund \
    && mkdir -p /data && chown node:node /data
COPY --from=build /app/out/nas ./out/nas
COPY nas/*.mjs ./nas/
COPY nas/ca-bundle.crt ./nas/ca-bundle.crt
COPY --from=build /app/nas/bin/tuneweave ./bin/tuneweave
COPY nas/licenses ./licenses/
RUN chmod +x ./bin/tuneweave
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "nas/server.mjs"]
