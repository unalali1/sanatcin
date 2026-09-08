FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app
COPY worker/package*.json ./
RUN npm ci --omit=dev
COPY worker/src ./src

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
