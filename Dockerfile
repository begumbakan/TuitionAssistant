# One image per service: docker build --build-arg PKG=api|mcp|agent .
FROM node:22-slim AS build
ARG PKG
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages/${PKG}/package.json packages/${PKG}/
RUN npm ci --workspace packages/${PKG} --include-workspace-root
COPY packages/${PKG} packages/${PKG}
RUN if [ "$PKG" = "mcp" ]; then npm run build-index --workspace packages/mcp; fi && npm run build --workspace packages/${PKG}

FROM node:22-slim
ARG PKG
ENV NODE_ENV=production PKG=${PKG}
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/${PKG} packages/${PKG}
COPY db db
WORKDIR /app/packages/${PKG}
CMD ["node", "dist/server.js"]
