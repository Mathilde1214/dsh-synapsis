FROM node:22-alpine

WORKDIR /app
COPY server ./server
COPY core ./core
COPY web ./web
COPY package.json ./package.json

ENV SYNAPSIS_DATA=/data
ENV SYNAPSIS_HOST=0.0.0.0
ENV PORT=7788

VOLUME ["/data"]
EXPOSE 7788

CMD ["node", "server/serve.mjs"]
