FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY worker/package*.json ./
RUN npm ci
COPY worker/src ./src
COPY worker/test ./test
COPY worker/dev ./dev
COPY wordpress /wordpress
RUN npm run check && npm test && npm prune --omit=dev

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
