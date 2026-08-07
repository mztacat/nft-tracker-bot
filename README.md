# NFT Tracker Telegram Bot

A private Telegram bot for tracking NFT collections and assets, viewing holder/owner information, and receiving customizable alerts — with no trading, no payments, and no wallet signing.

---

## Features

- **Link Parsing** — Paste any OpenSea or Blur link; the bot extracts collection or asset details automatically
- **Collection Tracking** — Track floor price, volume, sales, listings, and holder counts
- **Asset Tracking** — Track individual NFTs, owners, listing status, and sale history
- **Holders & Owners** — View ERC-721 owner history and ERC-1155/collection holder distributions
- **Notification System** — Per-item toggles for 11 collection events and 7 asset events with cooldowns and thresholds
- **Digest Mode** — Grouped hourly summaries instead of individual alerts
- **Access Management** — Owner/Admin/User/Denied roles with manual approval
- **Group & Channel Support** — Approved groups and channels receive alerts
- **Docker Deployment** — One-command deploy to any Ubuntu VPS

---

## MVP Scope

- ✅ Link parsing (OpenSea collection + asset links, contract addresses)
- ✅ Collection and asset summaries with inline buttons
- ✅ Track / untrack / list tracked items
- ✅ Notification settings with per-event toggles
- ✅ Background market worker (every 60s) and asset worker (every 2m)
- ✅ Holder worker (every 30m)
- ✅ Alert engine with cooldown, daily cap, deduplication
- ✅ Access system: request → admin approval → approved user
- ✅ Admin commands: approve, deny, broadcast, admin management
- ✅ Group/channel approval
- ✅ Mock NFT data provider (no API keys needed for dev)
- ✅ Reservoir provider (production)
- ✅ Docker Compose with bot + worker + db + redis
- ✅ Deploy and backup scripts
- ❌ No payments, no trading, no wallet signing, no custody

---

## Tech Stack

- **Runtime:** Node.js 22 LTS + TypeScript
- **Bot Framework:** grammY
- **ORM:** Prisma
- **Database:** PostgreSQL 16
- **Cache/Queue:** Redis 7 (via ioredis)
- **Jobs:** node-cron
- **Containers:** Docker + Docker Compose

---

## Local Setup

### Prerequisites

- Node.js 22+
- pnpm or npm
- Docker + Docker Compose
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1. Clone the repo

```bash
git clone https://github.com/yourorg/nft-tracker-bot.git
cd nft-tracker-bot
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | Telegram bot token from BotFather |
| `OWNER_ID` | ✅ | Your Telegram user ID (get from @userinfobot) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `RESERVOIR_API_KEY` | Optional | Get free key at [reservoir.tools](https://reservoir.tools) |
| `OPENSEA_API_KEY` | Optional | OpenSea API key |

### 3. Run with Docker Compose (recommended)

```bash
docker compose up -d
```

This starts:
- `bot` — Telegram bot with long polling
- `worker` — background market/holder/alert worker
- `db` — PostgreSQL 16
- `redis` — Redis 7

Database migrations run automatically on first start.

### 4. Run locally without Docker

```bash
npm install
npx prisma migrate deploy
npm run build
npm start          # bot process
npm run start:worker  # worker process (separate terminal)
```

---

## Environment Variables

```env
BOT_TOKEN=                    # Telegram bot token
OWNER_ID=                     # Your Telegram user ID
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=postgresql://nftbot:password@localhost:5432/nftbot
REDIS_URL=redis://localhost:6379

# Optional NFT data providers
RESERVOIR_API_KEY=
SIMPLEHASH_API_KEY=
ALCHEMY_API_KEY=
OPENSEA_API_KEY=

# Tracking limits
MAX_TRACKED_COLLECTIONS=10
MAX_TRACKED_ASSETS=20
MAX_TRACKED_WALLETS=5

# Alert settings
ALERT_COOLDOWN_MINUTES=30
DEFAULT_DIGEST_MODE=instant
```

If no provider API keys are set, the bot uses a **mock provider** with fake data — useful for local testing without API keys.

---

## Deploying to Ubuntu VPS

### First-time setup

```bash
# On the VPS
apt update && apt install -y docker.io docker-compose-plugin git
mkdir -p /opt/nft-tracker-bot
cd /opt/nft-tracker-bot

git clone https://github.com/yourorg/nft-tracker-bot.git .
cp .env.example .env
# Edit .env with your values
nano .env

docker compose up -d
```

### Updating from GitHub

```bash
cd /opt/nft-tracker-bot
bash scripts/deploy.sh
```

Or manually:

```bash
git pull origin main
docker compose build
docker compose run --rm bot npx prisma migrate deploy
docker compose up -d
docker system prune -f
```

### Rollback with git tags

```bash
# Tag a release before deploying
git tag v1.0.0
git push origin v1.0.0

# Rollback to a tag
git checkout v1.0.0
docker compose up -d --build

# Return to main when ready
git checkout main
docker compose up -d --build
```

---

## Database Backup

```bash
bash scripts/backup-db.sh
```

Backups are saved to `/opt/backups/nftbot_YYYY-MM-DD_HHMM.sql`. The last 7 days are kept automatically.

### Restore from backup

```bash
docker compose exec -T db psql -U nftbot nftbot < /opt/backups/nftbot_2024-01-01_1200.sql
```

---

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) and create a new bot.
2. Copy the token to `BOT_TOKEN` in `.env`.
3. Get your Telegram user ID from [@userinfobot](https://t.me/userinfobot) and set it as `OWNER_ID`.
4. Start the bot and send `/start`. You will be the owner automatically.

---

## Provider API Setup

### Reservoir (recommended, free tier available)

1. Sign up at [reservoir.tools](https://reservoir.tools)
2. Create an API key
3. Set `RESERVOIR_API_KEY` in `.env`

### OpenSea

1. Sign up at [docs.opensea.io](https://docs.opensea.io)
2. Request an API key
3. Set `OPENSEA_API_KEY` in `.env`

If no provider is configured, the mock provider is used (returns realistic fake data for testing).

---

## Admin Access Instructions

As the owner (matching `OWNER_ID` in `.env`), you have full control:

### Approve a user

```
/approve 123456789
```

Or use the inline buttons when a user sends `/request`.

### Approve a group or channel

Add the bot to the group/channel, then:

```
/approvegroup -100123456789
```

Use the Telegram chat ID (starts with `-100` for groups/channels).

### Manage admins

```
/addadmin 123456789
/removeadmin 123456789
/admins
```

### Broadcast to all approved users

```
/broadcast Your message here
```

---

## Command Reference

| Command | Access | Description |
|---|---|---|
| `/start` | All | Start the bot |
| `/help` | All | Show help |
| `/menu` | Approved | Open main menu |
| `/request` | All | Request access |
| `/link` | Approved | Add NFT/collection link |
| `/tracking` | Approved | View/manage tracked items |
| `/holders` | Approved | View holder/owner info |
| `/notifications` | Approved | Manage notification settings |
| `/access` | Admin | Access panel |
| `/requests` | Admin | Pending requests |
| `/approve <id>` | Admin | Approve user |
| `/deny <id>` | Admin | Deny user |
| `/approvegroup <id>` | Admin | Approve group/channel |
| `/denygroup <id>` | Admin | Deny group/channel |
| `/addadmin <id>` | Owner | Add admin |
| `/removeadmin <id>` | Owner | Remove admin |
| `/admins` | Admin | List admins |
| `/broadcast <msg>` | Admin | Broadcast message |
| `/status` | Owner | Bot status |

---

## Architecture Notes

- **Long polling** is used for Telegram (not webhooks) — simpler and works without a public domain.
- **Two processes**: `bot` (handles user interactions) and `worker` (background data fetching + alerts).
- **Provider abstraction**: swap NFT data providers by setting API keys; falls back to mock if none configured.
- **Alert engine**: enforces per-type cooldowns, daily caps, and deduplication before sending any message.
- **Access control**: every command checks role (Owner > Admin > Approved > Denied). Group/channel must also be approved.

---

## Security

- Never store seed phrases, private keys, or wallet secrets.
- All secrets are in `.env` — never committed to git.
- Validated user input with Zod.
- Rate limiting: max 20 commands per user per minute.
- Admin commands protected by role middleware.
- Provider API failures are caught and logged; the bot never crashes.

---

## License

MIT
