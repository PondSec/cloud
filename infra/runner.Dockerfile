FROM docker:27.5.1-cli

WORKDIR /app
RUN apk add --no-cache nodejs npm python3 make g++
COPY runner/package.json ./package.json
RUN npm install
COPY runner/ ./

EXPOSE 8081
CMD ["npm", "run", "dev"]
