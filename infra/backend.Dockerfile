FROM node:20-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/*
COPY ide-backend/package.json ./package.json
RUN npm install
COPY ide-backend/ ./

EXPOSE 8080
CMD ["npm", "run", "dev"]
