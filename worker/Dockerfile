FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
