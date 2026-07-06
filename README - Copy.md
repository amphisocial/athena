# AthenaBot site + contact form (SMTP backend)

A small Express server that serves the site (`public/index.html`) and a
`POST /api/contact` endpoint that sends the contact form as a real email
via SMTP, using credentials from a `.env` file (nothing hardcoded, nothing
committed).

## 1. Install

```bash
npm install
```

## 2. Configure SMTP

```bash
cp .env.example .env
```

Edit `.env` and fill in real values:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` — from
  whichever mailbox or transactional-email provider you're sending through
  (Google Workspace, Microsoft 365, SendGrid, Postmark, Mailgun, Amazon SES,
  etc). See the comments in `.env.example` for common presets.
- `CONTACT_TO_EMAIL` — defaults to `anu@threadwire.ai`.
- `CONTACT_FROM_EMAIL` — the "from" address on outgoing mail. Many providers
  require this to match the authenticated SMTP user or a verified sending
  domain, or the message will bounce/spam-flag.
- `SITE_ORIGIN` — set to `https://athenabot.ai` in production so only your
  own site can call the API (CORS).

**Never commit `.env`** — it's already listed below for `.gitignore`.

## 3. Run

```bash
npm start        # production
npm run dev       # auto-restarts on file changes
```

On boot, the server verifies the SMTP connection immediately and logs
whether it succeeded — so a bad password or wrong host shows up in your
logs right away, not the first time a customer submits the form.

The site is served at `http://localhost:3000` (or your configured `PORT`),
with the form posting to `/api/contact` on the same origin.

## 4. Deploy (EC2)

If you're deploying this on the same EC2 instance already running
smartjobs/flashcards/plm/voice, see **`deploy/DEPLOY-EC2.md`** for the exact
steps — copying the code over, setting up `.env` on the box, running it
under PM2 so it survives reboots, and adding the Nginx server block +
SSL for the `athenabot.ai` domain. `deploy/ecosystem.config.js` and
`deploy/nginx-athenabot.conf` are ready to use as-is (just double check the
port doesn't collide with your other apps).

For any other Node host (Render, Railway, Fly.io), the general idea is the
same: set the same environment variables from `.env` in that host's
environment settings — don't upload the `.env` file itself.

## What's included

- `server.js` — Express app: serves `public/`, exposes `POST /api/contact`
  and `GET /api/health`, validates input, has a honeypot field for basic
  bot filtering, and rate-limits the contact endpoint (8 requests / 15 min
  per IP).
- `public/index.html` — the AthenaBot site, with the contact form
  submitting via `fetch` (no page reload) and inline success/error states.
- `.env.example` — documents every required variable.

## .gitignore suggestion

```
node_modules/
.env
```
