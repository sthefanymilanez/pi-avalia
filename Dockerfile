FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server.js ./
COPY src ./src
COPY public ./public
COPY migrations ./migrations
COPY scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start"]
