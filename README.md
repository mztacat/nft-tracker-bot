# NFT Lookinto — Telegram NFT Tracker Bot (`@nftlook_bot`)

A private Telegram bot for tracking NFT collections and assets, receiving customizable alerts, and analyzing wallet P&L — with no trading, no payments, and no wallet signing.

---

## Features

- **Link Parsing** — Paste any OpenSea or Blur link; the bot extracts collection or asset details automatically
- **Collection Tracking** — Monitor floor price, volume, sales, listings, and holder counts in real time
- **Asset Tracking** — Track individual NFTs: owner, listing status, and sale history
- **Holders & Owners** — View ERC-721 owner history and ERC-1155/collection holder distributions
- **Wallet Tracking** — Track NFT buys, mints, and sells for any wallet address
- **Portfolio View** — Holdings, estimated floor value, and per-collection breakdown for any wallet
- **Trade History & P&L** — Full buy/sell history and FIFO realized/unrealized P&L per wallet × collection
- **Alert System** — Per-item toggles for 11 collection events and 7 asset events with cooldowns, thresholds, and daily caps
- **Whale / Sweep Alerts** — Configurable ETH spend and item-count thresholds; deduplication via atomic DB claims
- **Snooze** — Silence any tracked item for 1 h / 6 h / 1 d / indefinitely; tap the buttons on any alert or use `/snooze`
- **Digest Mode** — Grouped hourly summaries instead of per-event noise
- **Trait Alerts** — Get notified when a specific trait × value listing hits the market
- **Deployer Tracking** — Watch a collection deployer wallet and alert on new contract/token deployments
- **ETH / USD Prices** — All ETH amounts shown alongside live USD equivalents (CoinGecko, 5-min cache)
- **Custom Thresholds** — Set minimum floor % move and minimum ETH for whale alerts per collection
- **Access Management** — Owner / Admin / User / Denied roles with manual approval flow
- **Group & Channel Support** — Approved groups and channels receive alerts and auto-deleting command responses
- **Docker Deployment** — One-command deploy to any Ubuntu VPS

---

## Commands

### General

| Command | Description |
|---|---|
| `/start` | Onboard or re-open the bot |
| `/help` | Full command reference and tips |
| `/menu` | Dashboard with tracked-item counts |
| `/request` | Request access (unapproved users) |

### Tracking

| Command | Description |
|---|---|
| `/link` | Parse an OpenSea/Blur URL, contract address, or `contract:tokenId` |
| `/tracking` | List and manage tracked collections and assets |
| `/notifications` | Toggle per-event notifications and modes (instant / digest / muted) |

### Wallets

| Command | Description |
|---|---|
| `/trackwallet <0x…> [label]` | Track a wallet's NFT activity |
| `/wallets` | List and manage tracked wallets |
| `/portfolio [0x… or label]` | Holdings and estimated value for a wallet |
| `/history <wallet> <collection>` | Buy/sell/transfer history (paginated) |
| `/pnl <wallet> <collection>` | Realized + unrealized P&L, FIFO cost basis |

`wallet` accepts a raw address or a tracked label; `collection` accepts an OpenSea slug, contract address, or tracked label.

### Alerts & Thresholds

| Command | Description |
|---|---|
| `/setthreshold <collection>` | View current floor-change % and whale ETH thresholds |
| `/setthreshold <collection> <pct>` | Set minimum floor % move for floor alerts (0 < pct ≤ 100) |
| `/setthreshold <collection> whale <ETH>` | Set minimum ETH spend for whale alerts |
| `/snooze` *(reply to an alert)* | Show duration picker for that collection |
| `/snooze <duration>` *(reply to an alert)* | Immediately snooze that collection (`1h`, `6h`, `1d`, `off`) |
| `/snooze <collection> [duration]` | Snooze or check snooze status by collection name |
| `/traitalert <collection> <Trait>=<Value>` | Alert when that trait × value is listed |
| `/traitalert <collection> off` | Disable trait alert for that collection |
| `/trackdeployer <contract/slug/URL>` | Watch a deployer wallet for new contract/token deployments |

### Admin / Owner

| Command | Role | Description |
|---|---|---|
| `/access` | Admin | Dashboard: pending / approved / admin counts + controls |
| `/requests` | Admin | List pending access requests with approve/deny buttons |
| `/approve <user_id>` | Admin | Approve a user |
| `/deny <user_id>` | Admin | Deny a user |
| `/approvegroup <chat_id>` | Admin | Approve a group or channel (numeric ID or `t.me/c/…` link) |
| `/denygroup <chat_id>` | Admin | Revoke group/channel approval |
| `/broadcast <message>` | Admin | Send message to all approved chats/users |
| `/addadmin <user_id>` | Owner | Promote a user to admin |
| `/removeadmin <user_id>` | Owner | Demote an admin |
| `/admins` | Admin | List current admins |
| `/status` | Owner | Bot health and runtime status |

---

## Alert Types

### Collection alerts
`FLOOR_CHANGE` · `SALE` · `WHALE_BUY` · `LISTING` · `OWNER_CHANGE` · `DIGEST`

### Asset alerts
`OWNER_CHANGE` · `LISTING` · `SALE` · `WALLET_ACTIVITY` · and others configurable via `/notifications`

### Whale / Sweep logic
A transaction qualifies as a whale alert only when the total ETH spend meets the configured `minEth` threshold (default 5 ETH). If it also involves ≥ `minItems` tokens (default 3) it is labelled a **Sweep**, otherwise a **Whale Buy**. All alerts are deduplicated with an atomic DB claim to prevent duplicates under concurrent workers.

### Snooze
Every alert message includes an inline keyboard:

```
[🕐 1H]  [🕕 6H]  [📅 1D]  [🔕 Mute]
```

Tapping a button silences that collection for the chosen duration. Tap **Mute** to silence indefinitely, or send `/snooze <collection> off` / `/snooze off` (in reply) to resume. Snooze state is stored in the `Settings` table — no schema migration required.

---

## P&L

`/pnl <wallet> <collection>` computes FIFO cost-basis P&L across up to 500 on-chain transfers:

- **Realized gain** — closed positions (buy matched against sell)
- **Unrealized gain** — open positions valued at the current tracked floor
- **Net P&L** — realized + unrealized
- All amounts shown in ETH + live USD equivalent

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS + TypeScript (strict) |
| Bot framework | grammY |
| ORM | Prisma |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 (ioredis) |
| Jobs | node-cron |
| NFT data | CoinGecko (keyless) · Reservoir · OpenSea · Alchemy |
| Containers | Docker + Docker Compose |

---

## Deployment

### Prerequisites

- Docker + Docker Compose
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1. Clone

```bash
git clone https://github.com/mztacat/nft-tracker-bot.git
cd nft-tracker-bot
```

### 2. Configure

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | Telegram bot token |
| `OWNER_ID` | ✅ | Your Telegram user ID (get from @userinfobot) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `RESERVOIR_API_KEY` | Optional | [reservoir.tools](https://reservoir.tools) free key |
| `OPENSEA_API_KEY` | Optional | OpenSea API key |
| `ALCHEMY_API_KEY` | Optional | Alchemy API key |
| `SESSION_SECRET` | ✅ | Random secret for session signing |
| `MAX_TRACKED_COLLECTIONS` | Optional | Default `10` |
| `MAX_TRACKED_ASSETS` | Optional | Default `20` |
| `MAX_TRACKED_WALLETS` | Optional | Default `5` |
| `ALERT_COOLDOWN_MINUTES` | Optional | Default `30` |
| `DEFAULT_DIGEST_MODE` | Optional | `instant` \| `digest` \| `muted` |

### 3. Start

```bash
docker compose up -d
```

This starts four services:

| Service | Role |
|---|---|
| `bot` | Telegram long-polling process |
| `worker` | Background market/holder/whale/alert cron jobs |
| `db` | PostgreSQL 16 |
| `redis` | Redis 7 |

Database migrations run automatically on first start.

### Update

```bash
git pull
docker compose up -d --build
```

---

## Architecture

- **Two processes** — `bot` handles user interactions; `worker` runs background data fetching, whale detection, and alert dispatch.
- **Provider abstraction** — swap NFT data providers by setting API keys; falls back gracefully when keys are absent.
- **Alert engine** — enforces per-type cooldowns, a 100-alerts/chat/day cap, snooze checks, and deduplication before any message is sent. Whale alerts use an atomic conditional DB claim to prevent concurrent duplicates.
- **Auto-delete** — bot responses to commands in group/supergroup chats are automatically deleted after 2 minutes. Alert messages are never auto-deleted.
- **Access control** — every command checks role (Owner > Admin > Approved > Denied). Groups and channels must also be explicitly approved.

---

## Security

- No seed phrases, private keys, or wallet secrets are ever stored.
- All secrets live in `.env` — never committed to git.
- Input validated with Zod.
- Rate limiting: max 20 commands per user per minute.
- Admin commands protected by role middleware.
- Provider API failures are caught and logged; the bot never crashes.

---

## Troubleshooting

### Prisma P1000 — database authentication failed

PostgreSQL only applies `POSTGRES_PASSWORD` when its data volume is first initialized. If the volume already exists with a different password the bot and worker will restart-loop. Fix without losing data:

```bash
sh scripts/fix-db-password.sh
```

This updates the `nftbot` role password inside the running container to match `.env`, then recreates the bot and worker containers.

---

## License

MIT
