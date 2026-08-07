# Manual Test Checklist

Use this checklist to verify the MVP is working correctly.

## Setup

- [ ] `BOT_TOKEN` set in `.env`
- [ ] `OWNER_ID` set to your Telegram user ID
- [ ] Docker Compose is running: `docker compose up -d`
- [ ] Logs show bot started: `docker compose logs -f bot`

---

## 1. Bot Startup & Access

- [ ] Send `/start` as the owner — receive welcome message (approved automatically)
- [ ] Send `/start` as an unknown user — receive "request access" prompt
- [ ] Send `/request` as unknown user — receive confirmation; owner receives notification
- [ ] Click ✅ Approve in owner chat — user receives approval message
- [ ] Click ❌ Deny in owner chat — user receives denial message
- [ ] Send `/start` as approved user — receive welcome message

---

## 2. Link Parsing & Collection Summary

- [ ] Send `https://opensea.io/collection/azuki` — receive collection summary with:
  - [ ] Floor price
  - [ ] 24h Volume
  - [ ] 24h Sales
  - [ ] Floor change %
  - [ ] Holder count
  - [ ] Total supply
  - [ ] Buttons: Track, Holders, Notifications, Cancel
- [ ] Send unknown collection link — receive data or graceful "unavailable" message
- [ ] Send invalid text — no response (bot ignores it)

---

## 3. Link Parsing & Asset Summary

- [ ] Send `https://opensea.io/assets/ethereum/0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/1234` — receive asset summary with:
  - [ ] Token ID
  - [ ] Owner address (shortened)
  - [ ] Listing status
  - [ ] Last sale price
  - [ ] Floor price
  - [ ] vs Floor (premium/discount)
  - [ ] Rarity rank
  - [ ] Buttons: Track, Holder, Track Owner, Notifications, Cancel
- [ ] Send `0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d:1234` (contract:tokenId) — same result

---

## 4. Tracking

- [ ] Click **Track Collection** button — receive confirmation
- [ ] Click **Track Asset** button — receive confirmation
- [ ] Send `/tracking` — see tracked items listed with status icons
- [ ] Click **Untrack** for a collection — receive confirmation
- [ ] Click **Untrack** for an asset — receive confirmation
- [ ] Track more than `MAX_TRACKED_COLLECTIONS` (default 10) — receive limit error

---

## 5. Holders

- [ ] Click **View Holders** from collection summary — see holder distribution
- [ ] Click **View Holder/Owner** from asset summary — see ERC-721 owner info
- [ ] Send `/holders` — see list of tracked items to choose from

---

## 6. Notification Settings

- [ ] Click **Notification Settings** from summary — see event type list with ✅/❌ toggles
- [ ] Toggle a notification on/off — state persists (check icon changes)
- [ ] Send `/notifications` — see tracked items list to manage

---

## 7. Admin Commands

- [ ] `/access` as admin — see access panel with pending count
- [ ] `/requests` as admin — see pending requests
- [ ] `/approve <user_id>` — user gets approved and notified
- [ ] `/deny <user_id>` — user gets denied and notified
- [ ] `/approvegroup <chat_id>` — group chat gets approved
- [ ] `/addadmin <user_id>` (owner only) — user becomes admin
- [ ] `/removeadmin <user_id>` (owner only) — admin removed
- [ ] `/admins` — list of current admins
- [ ] `/broadcast Hello everyone` — message sent to all approved users
- [ ] `/status` (owner only) — bot version and env

---

## 8. Alert Engine (Background)

- [ ] Wait 1-2 minutes after tracking a collection — verify snapshot is saved in DB:
  ```sql
  SELECT * FROM "CollectionSnapshot" ORDER BY timestamp DESC LIMIT 5;
  ```
- [ ] Check alert history table:
  ```sql
  SELECT * FROM "AlertHistory" ORDER BY "sentAt" DESC LIMIT 5;
  ```
- [ ] If floor changes by threshold (>5%), verify alert message is received

---

## 9. Group/Channel Support

- [ ] Add bot to a test group
- [ ] Run `/approvegroup -100<group_chat_id>` — group gets approved
- [ ] Approved user can use bot commands in the group
- [ ] Unapproved group receives rejection message

---

## 10. Error Handling

- [ ] Invalid link (e.g., `https://opensea.io/invalid/path`) — no crash, no response or gentle error
- [ ] Unknown command — bot ignores it silently
- [ ] Admin command from non-admin — receives access denied message
- [ ] Owner command from non-owner — receives access denied message
- [ ] Rate limit: send 21+ commands quickly — receive rate limit message

---

## 11. Docker & Deployment

- [ ] `docker compose up -d` starts all 4 services (bot, worker, db, redis)
- [ ] `docker compose ps` shows all services as "Up"
- [ ] `docker compose logs bot` shows bot running log
- [ ] `docker compose logs worker` shows worker tick logs every minute
- [ ] `bash scripts/backup-db.sh` creates a backup file in `/opt/backups/`
- [ ] Bot restarts automatically after `docker compose restart bot`
- [ ] Bot restarts automatically after VPS reboot (with `restart: always` in compose)

---

## 12. Security

- [ ] Non-approved user cannot use `/tracking`, `/holders`, `/notifications`
- [ ] Non-admin cannot use `/approve`, `/deny`, `/access`
- [ ] Non-owner cannot use `/addadmin`, `/removeadmin`
- [ ] `.env` file is not committed to git (check `.gitignore`)
- [ ] No secrets visible in Telegram messages or logs
