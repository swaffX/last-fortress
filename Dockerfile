# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w packages/client

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/client/dist ./packages/client/dist
RUN npm ci --omit=dev -w packages/server -w packages/shared && npm cache clean --force
EXPOSE 8080
USER node
CMD ["npx", "tsx", "packages/server/src/index.ts"]
