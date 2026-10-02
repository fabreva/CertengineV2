FROM node:20.16.0

WORKDIR /home/node/app/

COPY ./package*.json ./

ARG NODE_ENV=production
RUN if [ "$NODE_ENV" = "production" ]; then \
      npm ci --omit=dev; \
    else \
      npm ci; \
    fi

COPY . .

RUN chown -R node:node /home/node/app

USER node

CMD ["node", "src/bin/www"]