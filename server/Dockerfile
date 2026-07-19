# better-sqlite3 needs a native build — compile it in its own stage (with
# build tools) so the runtime image below stays small and toolchain-free.
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY seed ./seed
EXPOSE 8090
CMD ["node", "src/index.js"]
