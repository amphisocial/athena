# Deploying to your EC2 box

Assumes the same instance already serving smartjobs / flashcards / plm / voice
— i.e. Node + Nginx already installed, each app on its own port with Nginx
routing subdomains to them. This adds `athenabot.ai` itself as one more app
on that same pattern.

## 1. Get the code onto the box

```bash
# from your local machine
scp -i your-key.pem -r athenabot-server ubuntu@YOUR_EC2_IP:/home/ubuntu/apps/athenabot
```

(or `git clone` your repo there instead, if you're pushing this to GitHub —
either way, `.env` should never be part of the repo/upload; you'll create it
directly on the server in the next step.)

## 2. Install dependencies

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
cd /home/ubuntu/apps/athenabot
npm ci --omit=dev
```

## 3. Create `.env` directly on the server

```bash
cp .env.example .env
nano .env          # fill in real SMTP_HOST / SMTP_USER / SMTP_PASS / etc.
chmod 600 .env      # only the owning user can read it
```

Pick a `PORT` in `.env` that doesn't collide with your other four apps
(e.g. if smartjobs/flashcards/plm/voice already use 3001–3004, use 3000 or
3005 here). Set `SITE_ORIGIN=https://athenabot.ai`.

## 4. Run it under PM2

If you're not already using PM2 for the other apps:

```bash
sudo npm install -g pm2
```

Then, from `/home/ubuntu/apps/athenabot`:

```bash
pm2 start deploy/ecosystem.config.js
pm2 save              # persist the process list
pm2 startup           # prints a systemd command — run the one it gives you,
                       # once, so PM2 (and this app) comes back up on reboot
```

Useful afterwards:

```bash
pm2 status
pm2 logs athenabot
pm2 restart athenabot   # e.g. after editing .env — env is only read at boot
```

## 5. Point Nginx at it

```bash
sudo cp deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot.ai
sudo ln -s /etc/nginx/sites-available/athenabot.ai /etc/nginx/sites-enabled/
sudo nginx -t          # check syntax before reloading
sudo systemctl reload nginx
```

If athenabot.ai's DNS A record isn't already pointed at this EC2 instance's
IP, do that first (or your existing subdomains prove it already is, and you
just need the new server block).

## 6. SSL

```bash
sudo certbot --nginx -d athenabot.ai -d www.athenabot.ai
```

Certbot edits the Nginx config in place to add the 443 block and the
http→https redirect — same as it presumably did for your other subdomains.

## 7. Security group

Only 80/443 need to be open to the internet. The app's internal port
(e.g. 3000) should **not** be open in the EC2 security group — Nginx is the
only thing that should reach it, over localhost.

## 8. Verify

```bash
curl -s https://athenabot.ai/api/health
# {"ok":true}
```

Then submit the real contact form on the live site once, and check
`pm2 logs athenabot` for the "SMTP connection verified" line at boot and
any send errors after that.
