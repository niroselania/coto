FROM node:20-alpine

WORKDIR /app

COPY package.json server.js ./
COPY outputs ./outputs

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
