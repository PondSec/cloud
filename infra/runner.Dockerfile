FROM docker:27.5.1-cli

WORKDIR /app
RUN apk add --no-cache nodejs npm python3 make g++ \
    && addgroup -S cloudide \
    && adduser -S -G cloudide -u 10001 cloudide
COPY runner/package.json ./package.json
RUN npm install --omit=optional \
    && npm cache clean --force
COPY runner/ ./
RUN chown -R cloudide:cloudide /app

USER cloudide
EXPOSE 8081
CMD ["npm", "run", "dev"]
