FROM node:20-bookworm-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep \
    && rm -rf /var/lib/apt/lists/*
COPY ide-backend/package.json ./package.json
RUN npm install --omit=optional \
    && npm cache clean --force
COPY ide-backend/ ./

RUN useradd --system --create-home --uid 10001 cloudide \
    && chown -R cloudide:cloudide /app
USER cloudide

EXPOSE 8080
CMD ["npm", "run", "dev"]
