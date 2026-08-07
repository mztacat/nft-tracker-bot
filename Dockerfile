FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
COPY prisma ./prisma/

RUN npm install

RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# ---

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
COPY prisma ./prisma/

RUN npm install --omit=dev

RUN npx prisma generate

COPY --from=builder /app/dist ./dist/
COPY scripts ./scripts/

RUN chmod +x scripts/*.sh

ENV NODE_ENV=production

CMD ["sh", "scripts/start.sh", "bot"]
