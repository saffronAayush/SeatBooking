FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
USER node
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node package.json ./package.json
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
