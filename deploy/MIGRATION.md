# Migrating to one EC2 under athenabot.ai

This moves your products off Railway onto a single EC2 box that hosts the
marketing homepage plus every product, each on its own subdomain. RoleFit /
SmartJobs is the worked example; the other apps follow the same five steps.

---

## The architecture (and why)

```
                         athenabot.ai  (Elastic IP)
                                │
                        ┌───────┴────────┐
                        │     nginx      │   ← TLS (Let's Encrypt), routing
                        └───────┬────────┘
        ┌──────────────┬────────┼─────────┬───────────────┐
        │              │        │         │               │
  athenabot.ai   smartjobs.   voice.    plm.        (more.athenabot.ai…)
   (static)      :3001        :3002     :3003
                   │            │         │
                   └──────── one Postgres server ────────┘
                        db: rolefit │ voice │ plm   (separate DBs)
       all node processes supervised by PM2 · auto-restart · boot on reboot
```

**Subdomains, not paths.** RoleFit (and the voice app) use root-absolute paths
— `/api/...`, `/candidate.html`, `/webhook/stripe`. Putting them on
`smartjobs.athenabot.ai` means **zero code changes**; a path prefix like
`athenabot.ai/smartjobs/` would break every absolute path.

**One Postgres, one database per app — not merged.** "Central deployment"
means one Postgres *server*, but each app keeps its **own database** and its own
tables. No schema refactor: every app already reads `DATABASE_URL`, so you just
point each one at its own DB on the shared server. Apps stay fully isolated;
a bad migration in PLM can't touch RoleFit's data.

---

## Step 0 — Provision the EC2

- **Image:** Ubuntu 24.04 LTS (or 22.04).
- **Size:** t3.small (2 GB) runs 3 small apps + Postgres; t3.medium (4 GB) is
  comfortable once traffic grows. Add 20–30 GB disk.
- **Elastic IP:** allocate one and associate it — so DNS never breaks on reboot.
- **Security group (inbound):** `22` from *your IP only*, `80` from anywhere,
  `443` from anywhere. Outbound: allow all (this is also what lets the app reach
  Stripe/OpenAI — the egress problem you hit on Railway won't exist here).

SSH in, then:

```bash
sudo apt update && sudo apt -y upgrade
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs nginx postgresql postgresql-contrib git
sudo npm i -g pm2
sudo systemctl enable --now postgresql nginx
node -v && nginx -v && psql --version
```

---

## Step 1 — DNS

At your domain registrar (or Route 53) for **athenabot.ai**, point everything at
the Elastic IP. Simplest is a wildcard plus the apex:

| Type | Name            | Value            |
|------|-----------------|------------------|
| A    | `@`             | `<ELASTIC_IP>`   |
| A    | `www`           | `<ELASTIC_IP>`   |
| A    | `*`             | `<ELASTIC_IP>`   |  ← covers smartjobs/voice/plm/anything

(If you'd rather be explicit, replace the `*` row with one A record each for
`smartjobs`, `voice`, `plm`.) Give DNS a few minutes; check with
`dig +short smartjobs.athenabot.ai`.

---

## Step 2 — Postgres (one server, a DB per app)

```bash
# edit the passwords first!
sudo -u postgres psql -f /opt/apps/deploy/postgres-setup.sql
```

That creates `rolefit`, `voice`, `plm` databases + owners. Each app's
`DATABASE_URL` is `postgresql://<user>:<pass>@localhost:5432/<db>`. Local
connections need no SSL, so set `PGSSL=false` for each app.

---

## Step 3 — Deploy RoleFit / SmartJobs (the worked example)

```bash
sudo mkdir -p /opt/apps && sudo chown -R $USER /opt/apps
cd /opt/apps
git clone https://github.com/amphisocial/smartjobs.git smartjobs
cd smartjobs
npm ci --omit=dev          # or: npm install --production
```

RoleFit reads everything from `process.env` and already calls
`app.set("trust proxy", true)`, so behind nginx it builds correct `https://`
Stripe checkout URLs automatically. You provide its environment through PM2 in
the next step (no `.env` file needed, though you can use one if you prefer).

The other two apps clone the same way into `/opt/apps/voice` and `/opt/apps/plm`.

---

## Step 4 — Run everything with PM2

Copy `deploy/ecosystem.config.js` to the server, fill in the real secrets
(OpenAI key, the **live** Stripe keys/price/webhook for SmartJobs, the DB
passwords you set in Step 2), then:

```bash
cd /opt/apps
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup        # prints a command — copy/paste & run it so apps survive reboot
pm2 status
```

Each app now listens on localhost (3001/3002/3003). Test locally before nginx:

```bash
curl -s localhost:3001/healthz     # SmartJobs -> {"ok":true,...,"billing":true,...}
```

---

## Step 5 — nginx + TLS

Put the homepage where nginx expects it and wire the proxy:

```bash
sudo mkdir -p /opt/apps/site
sudo cp /opt/apps/deploy/index.html /opt/apps/site/      # the homepage

sudo cp /opt/apps/deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot
sudo ln -s /etc/nginx/sites-available/athenabot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Now add HTTPS — certbot edits the nginx blocks in place and sets up auto-renew:

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx \
  -d athenabot.ai -d www.athenabot.ai \
  -d smartjobs.athenabot.ai -d voice.athenabot.ai -d plm.athenabot.ai
```

Visit `https://athenabot.ai` (homepage) and `https://smartjobs.athenabot.ai`
(RoleFit). Both should load over TLS.

---

## Step 6 — Repoint Stripe (RoleFit)

The one thing that doesn't move itself: the webhook URL.

1. Stripe → **Live mode** → Developers → Webhooks → your endpoint → **edit URL**
   to `https://smartjobs.athenabot.ai/webhook/stripe`. Editing the URL keeps the
   same signing secret, so `STRIPE_LIVE_WEBHOOK_SECRET` is unchanged.
2. Success/cancel URLs are derived from the request host, so they auto-resolve to
   `https://smartjobs.athenabot.ai/...` — nothing to set.
3. Run one real-card purchase, confirm the member unlocks, then refund yourself.

Because EC2 has normal outbound internet, the `StripeConnectionError` you saw on
Railway should be gone. If checkout still errors, hit
`https://smartjobs.athenabot.ai/api/stripe-ping` — it prints the raw Stripe
response so you can see exactly which credential Stripe is rejecting.

---

## Adding the next product (repeatable recipe)

1. `CREATE USER` + `CREATE DATABASE` (copy a block in `postgres-setup.sql`).
2. `git clone` into `/opt/apps/<name>`, `npm ci`.
3. Add an app block to `ecosystem.config.js` (new name, next port, its env) →
   `pm2 start ... && pm2 save`.
4. Copy a proxy block in the nginx config (new `server_name`, new port) →
   `sudo nginx -t && sudo systemctl reload nginx`.
5. `sudo certbot --nginx -d <name>.athenabot.ai`.
6. Add a tile to the homepage pointing at `https://<name>.athenabot.ai`.

---

## Keep it healthy

- **Backups:** nightly `pg_dump` per database to S3, e.g. a cron running
  `pg_dump rolefit | gzip > /backups/rolefit-$(date +%F).sql.gz` then `aws s3 cp`.
- **Restart on crash / reboot:** handled by `pm2 save` + `pm2 startup`.
- **Logs:** `pm2 logs <app>`; nginx at `/var/log/nginx/`.
- **Updates:** `cd /opt/apps/<app> && git pull && npm ci && pm2 restart <app>`.
- **Postgres still needed before charging:** RoleFit's members/applications/live
  counters fall back to in-memory without `DATABASE_URL`; with the DB wired here,
  they persist across restarts — do this before taking real payments.
