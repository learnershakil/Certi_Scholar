FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Rewrites are resolved at build time: the API origin must be known here.
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_DEMO_ACCOUNTS=
ENV API_URL=$API_URL NEXT_PUBLIC_DEMO_ACCOUNTS=$NEXT_PUBLIC_DEMO_ACCOUNTS NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:24-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
