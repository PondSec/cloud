FROM node:20-bookworm-slim

WORKDIR /app
COPY ide-backend/package.json ./package.json
RUN npm install
COPY ide-backend/ ./

EXPOSE 8080
CMD ["npm", "run", "dev"]
