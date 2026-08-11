# Deploy Boardsy to EC2 (athenabot.ai)

Boardsy takes over the **root domain** and runs from the same place the old
homepage did: path `/opt/apps/athena`, PM2 instance name **`athenabot`**. The
old flashcards subdomain app is untouched.

## 0. One-time: push this repo to GitHub

Locally, from this folder:

```bash
git init            # if not already a repo
git add .
git commit -m "Boardsy — athenabot.ai homepage + sandbox board"
git branch -M main
git remote add origin git@github.com:amphisocial/athena.git   # keep the same repo
git push -u origin main
```

## 1. Pull onto EC2

```bash
cd /opt/apps/athena
git fetch origin
git reset --hard origin/main      # replace the old homepage with Boardsy
npm ci --omit=dev                 # or: npm install --omit=dev
```

If `/opt/apps/athena` is not yet a clone of this repo:

```bash
sudo mv /opt/apps/athena /opt/apps/athena.bak.$(date +%s)   # keep a backup
sudo git clone git@github.com:amphisocial/athena.git /opt/apps/athena
sudo chown -R ubuntu:ubuntu /opt/apps/athena
cd /opt/apps/athena && npm ci --omit=dev
```

## 2. Environment

```bash
cp .env.example .env
nano .env
```

Recommended production values:

```bash
PORT=3000
SITE_ORIGIN=https://athenabot.ai,https://www.athenabot.ai
# Point Plans "Start trial / Sign in" at the full logged-in product.
# If it stays on the subdomain for now:
APP_BASE_URL=https://flashcards.athenabot.ai
# ...or once the full app is consolidated onto the root:
# APP_BASE_URL=https://athenabot.ai
# SMTP is optional; set it to email Founding-30 applications.
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-key
CONTACT_TO_EMAIL=anu@threadwire.ai
CONTACT_FROM_EMAIL=hello@athenabot.ai
```

## 3. PM2 — same instance name (`athenabot`)

```bash
cd /opt/apps/athena
pm2 restart athenabot || pm2 start deploy/ecosystem.config.js
pm2 save
pm2 logs athenabot --lines 30      # expect: "Boardsy listening on port 3000"
```

## 4. Nginx — point the root domain at it

The old homepage's Nginx server block already sends `athenabot.ai` to
`127.0.0.1:3000`, so if you kept `PORT=3000` there's nothing to change. If you
need to (re)install it:

```bash
sudo cp deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot.ai
sudo ln -sf /etc/nginx/sites-available/athenabot.ai /etc/nginx/sites-enabled/athenabot.ai
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d athenabot.ai -d www.athenabot.ai   # if not already on HTTPS
```

## 5. Verify

```bash
curl -s https://athenabot.ai/api/health      # {"ok":true,"service":"boardsy"}
```

Then open:
- `https://athenabot.ai/` — the homepage; the hero should cycle gravity ⇄ parabola.
- `https://athenabot.ai/board` — the picker; choose Math/Science → a template → live board.
- `https://athenabot.ai/board?subject=science&template=newton` — jumps straight to free fall.

## Routine updates

```bash
cd /opt/apps/athena && git pull && npm ci --omit=dev && pm2 restart athenabot
```

## Rollback

```bash
cd /opt/apps/athena && git reset --hard <previous-commit> && npm ci --omit=dev && pm2 restart athenabot
```
