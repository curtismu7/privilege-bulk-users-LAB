# Two stages: the first builds the web UI, the final image carries the server and the built UI only.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
# The image holds no tenant value and no secret, and no .env (.dockerignore). Real is off unless the owner's .env, passed in by compose at run time, says PRIVILEGE_BULK_MODE=real,
# and (see the end of this file) Real is refused outside the compose file's loopback publish.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts -w web --include-workspace-root=false && npm cache clean --force
COPY web web
COPY docs docs
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7817 PBU_DATA_DIR=/data
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
# The diagrams are diagram-studio/1 data files, validated when the server starts: the image must carry them.
COPY server/diagrams server/diagrams
COPY --from=web /app/web/dist web/dist
# The data dir holds the audit history only (a mode 600 file of summaries: no secret, no person's address): mode 700, owned by the non-root user.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 7817
VOLUME /data
# Inside the container the server must listen on all interfaces, so PBU_BIND is set here on purpose. A bare `docker run -p 7817:7817` of this
# image therefore publishes on every interface: that is acceptable only because it stays in Mock. The image does NOT set PBU_CONTAINER, the
# marker that lets Real accept a wide bind, so a bare run refuses Real. docker-compose.yml sets PBU_CONTAINER=1 together with a 127.0.0.1-only
# publish: that pair is the only way Real runs in Docker. Do not move the marker into the image.
ENV PBU_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
