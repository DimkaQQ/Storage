# SQLite comes from Node's own built-in node:sqlite (22.5+) — no native
# module to compile, so no build toolchain (python3/make/g++) needed here.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY seed ./seed
EXPOSE 8090
CMD ["node", "src/index.js"]
