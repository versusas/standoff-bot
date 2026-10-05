FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build-time fallbacks so Next.js can compile route handlers without Railway runtime vars
ENV DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
ENV APP_URL=http://localhost:8080
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start", "--", "-p", "8080", "-H", "0.0.0.0"]
