FROM node:24-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/data/focus.sqlite
ENV BOOKS_PATH=/data/books
EXPOSE 8787

CMD ["npm", "start"]
