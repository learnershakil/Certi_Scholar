FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY seed ./seed
COPY package.json ./
RUN mkdir -p /data/documents && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/server.js"]
