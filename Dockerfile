FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

EXPOSE 8080

CMD ["npm", "run", "start", "--", "-p", "8080", "-H", "0.0.0.0"]
