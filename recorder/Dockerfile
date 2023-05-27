FROM node:14-alpine

WORKDIR /app

COPY ./ ./

RUN npm install \
    && npm install -g typescript@4.8.4 \
    && tsc

CMD ["npm", "start"]