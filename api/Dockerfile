FROM node:14-alpine

WORKDIR /app

COPY ./ ./

RUN npm install \
    && npm install -g typescript \
    && tsc

CMD ["npm", "start"]