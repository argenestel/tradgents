# One image, two processes. API:  docker run IMAGE            Worker: docker run IMAGE pnpm worker
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production
USER node
CMD ["pnpm", "api"]
