# Deploy AthenaBot on EC2 with PM2, Nginx, and SSL

These instructions assume you already have an EC2 instance serving the AthenaBot subdomain apps and that Node.js, Nginx, and Certbot are available or can be installed.

The root domain `athenabot.ai` will run as one more Node app behind Nginx.

## 1. SSH into the server

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

## 2. Clone or update the repo

Recommended folder:

```bash
mkdir -p /home/ubuntu/apps
cd /home/ubuntu/apps
```

Fresh clone:

```bash
git clone https://github.com/amphisocial/athena.git athenabot
cd athenabot
```

Existing clone:

```bash
cd /home/ubuntu/apps/athenabot
git pull origin main
```

## 3. Install dependencies

```bash
npm ci --omit=dev
```

If `npm ci` complains because there is no `package-lock.json`, use:

```bash
npm install --omit=dev
```

## 4. Create `.env` on the server

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Use real SMTP values. Example using Google Workspace:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-google-workspace-email
SMTP_PASS=your-google-app-password
CONTACT_TO_EMAIL=anu@threadwire.ai
CONTACT_FROM_EMAIL=your-google-workspace-email
SITE_ORIGIN=https://athenabot.ai,https://www.athenabot.ai
PORT=3000
```

Important: use a Google App Password or a transactional provider key. Do not use a normal mailbox password.

## 5. Start with PM2

Install PM2 if needed:

```bash
sudo npm install -g pm2
```

Start the app:

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

`pm2 startup` prints a command. Run the command it prints so the app restarts after server reboot.

Useful checks:

```bash
pm2 status
pm2 logs athenabot
curl -s http://127.0.0.1:3000/api/health
```

Expected health output:

```json
{"ok":true,"service":"athenabot"}
```

## 6. Configure Nginx

Copy the Nginx config:

```bash
sudo cp deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot.ai
sudo ln -sf /etc/nginx/sites-available/athenabot.ai /etc/nginx/sites-enabled/athenabot.ai
sudo nginx -t
sudo systemctl reload nginx
```

If your `.env` uses a port other than `3000`, edit this line in `/etc/nginx/sites-available/athenabot.ai`:

```nginx
proxy_pass http://127.0.0.1:3000;
```

Then reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. DNS

Make sure both records point to the EC2 public IP:

```text
athenabot.ai      A      YOUR_EC2_IP
www.athenabot.ai  A      YOUR_EC2_IP
```

If DNS is already pointed there because the subdomains are working, this may already be done.

## 8. Enable SSL

```bash
sudo certbot --nginx -d athenabot.ai -d www.athenabot.ai
```

Certbot will add the HTTPS server block and HTTP-to-HTTPS redirect.

## 9. Final verification

```bash
curl -s https://athenabot.ai/api/health
```

Expected:

```json
{"ok":true,"service":"athenabot"}
```

Then open `https://athenabot.ai`, submit the Contact Us form once, and confirm the email arrives at `anu@threadwire.ai`.

If it fails:

```bash
pm2 logs athenabot
sudo tail -n 100 /var/log/nginx/error.log
```

Common causes:

- wrong SMTP password or missing app password
- `CONTACT_FROM_EMAIL` not verified with the SMTP provider
- Nginx proxy port does not match `.env` `PORT`
- EC2 security group missing inbound 80/443

Only ports 80 and 443 should be open to the internet. The Node port, such as 3000, should stay private behind Nginx.
