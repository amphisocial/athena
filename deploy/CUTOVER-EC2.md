# Cutover: full product → athenabot.ai (retire the flashcards subdomain)

This makes `/opt/apps/athena` run the **complete product** (accounts, save,
live collaboration, Stripe, AI generation) with the **Boardsy homepage** as its
landing page, reusing the **existing Postgres database**. The old
`flashcards.athenabot.ai` subdomain and its pm2 instance are retired at the end.

Nothing about the process identity changes: same pm2 name `athenabot`, same
path `/opt/apps/athena`.

---

## What this codebase is

It **is** the flashcards app (all of its server code, board, auth, Stripe, AI,
WebSocket collaboration) with three additions:

- `public/index.html` — the Boardsy homepage (new brand/design), wired to the
  product's real login modal (`#authDialog` + `common.js`).
- `public/sandbox.*` — a **no-login** board (draw + live 3D/graph sims, no save,
  no collaborate) served at **`/sandbox`**. The real, auth-gated collaborative
  board stays at **`/board`**.
- `POST /api/founding/apply` — a public Founding-30 form endpoint (the in-app,
  account-attached `/api/founder/apply` is unchanged).

The database is reused as-is: the app connects via `DATABASE_URL` and creates
tables with `CREATE TABLE IF NOT EXISTS`, so pointing at the existing database
carries over every account, board, study set, team and subscription. No dump,
no migration.

---

## Before you touch the server (external dashboards)

Because the domain changes from `flashcards.athenabot.ai` to `athenabot.ai`,
update these first so nothing breaks at flip time:

1. **Google OAuth** (Google Cloud Console → Credentials): add/replace the
   authorized redirect URI with `https://athenabot.ai/auth/google/callback`.
2. **Stripe** (Dashboard → Developers → Webhooks): change the endpoint to
   `https://athenabot.ai/api/billing/webhook`, then copy its **signing secret**
   into `STRIPE_WEBHOOK_SECRET`. Confirm the success/cancel URLs follow
   `APP_BASE_URL` (they do — they're built from it in code).
3. **DNS**: make sure `athenabot.ai` (and `www`) already point at this EC2 box.

---

## 1. Get the code onto EC2 (path and pm2 name unchanged)

If `/opt/apps/athena` is the git repo you deploy from:

```bash
cd /opt/apps/athena
git fetch origin && git reset --hard origin/main
npm ci --omit=dev            # installs pg, stripe, ws, multer, pdf-parse, mammoth, nodemailer…
```

## 2. Environment

```bash
cp .env.example .env
nano .env
```

Fill in, at minimum:

- `APP_BASE_URL=https://athenabot.ai`
- `DATABASE_URL=` the **same** value the flashcards app used (copy it from the
  old app's `.env`, e.g. `/opt/apps/flashcards/.env`)
- `SESSION_SECRET=` a long random value (`openssl rand -hex 32`)
- `ADMIN_EMAIL=anu@threadwire.ai`
- Your existing `ANTHROPIC_API_KEY` / other AI key
- Stripe keys + the **new** `STRIPE_WEBHOOK_SECRET`
- Google OAuth client id/secret
- SMTP settings (optional, for Teams invites + Founding-30 emails)

> Tip: most values can be copied verbatim from the old flashcards `.env`. Only
> `APP_BASE_URL`, `STRIPE_WEBHOOK_SECRET`, and the OAuth redirect (in Google's
> console) actually change for the domain move.

## 3. Nginx (root domain + WebSocket + subdomain redirect)

```bash
# one-time: define the WS upgrade map in the http{} block if not already present
grep -q 'connection_upgrade' /etc/nginx/nginx.conf || \
  sudo sed -i '/http {/a \    map $http_upgrade $connection_upgrade { default upgrade; "" close; }' /etc/nginx/nginx.conf

sudo cp deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot.ai
sudo ln -sf /etc/nginx/sites-available/athenabot.ai /etc/nginx/sites-enabled/athenabot.ai
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d athenabot.ai -d www.athenabot.ai
# and add the cert to the flashcards -> root redirect server if certbot asks
```

## 4. Start it under the existing pm2 name

```bash
cd /opt/apps/athena
pm2 restart athenabot || pm2 start deploy/ecosystem.config.js
pm2 save
pm2 logs athenabot --lines 40      # watch for a clean DB connect and "listening"
```

## 5. Verify

```bash
curl -s https://athenabot.ai/api/health           # {"status":"ok",...}
```

Then in a browser:

- `https://athenabot.ai/` — Boardsy homepage; hero cycles gravity ⇄ parabola.
- Click **Sign in** — the product login modal opens (email/password + Google).
  Log in with an existing account and confirm your boards/sets are all there
  (proves the DB reuse worked).
- **Enter Boardsy** → `/sandbox` — pick a subject/template, play a sim, draw on it.
- `https://athenabot.ai/board` — the real collaborative board loads for a
  signed-in user; open it in two tabs to confirm the live WebSocket sync.
- Do a 1¢ or test-mode Stripe checkout and confirm the webhook fires against
  the new URL (Stripe dashboard → the webhook's recent deliveries).

## 6. Retire the subdomain

Only after the above all pass:

```bash
pm2 delete flashcards        # stop the old subdomain process
pm2 save
```

Leave the `flashcards.athenabot.ai → athenabot.ai` 301 (in the nginx file) in
place so old links keep resolving. You can remove the old app directory once
you're confident: `sudo mv /opt/apps/flashcards /opt/apps/flashcards.retired`.

---

## Rollback

The old app still exists until step 6. To roll back before then: point nginx
`athenabot.ai` back at the old server block / port and `pm2 restart flashcards`.
After step 6: `pm2 start /opt/apps/flashcards.retired/deploy/ecosystem.config.js`.
Because the database was reused (never modified destructively), no data is lost
either way.

## Notes / gotchas

- **Everyone re-logs-in once.** Session cookies were issued for the old host and
  won't carry to the root domain. Expected, harmless.
- **Single pm2 instance.** The live board keeps state in memory and the
  rate-limiters use in-memory maps, so run one instance (the ecosystem file uses
  `fork`, one instance). Don't scale to cluster mode without moving that state out.
- **`/sandbox` needs no login; `/board` does.** If you'd rather the homepage's
  "Enter Boardsy" drop straight into the real board for logged-in users, that's
  already handled for the nav ("Sign in" becomes "My boards" once authenticated);
  the big hero button intentionally stays on the open sandbox so anonymous
  visitors can play in one click.
