# Boardsy — the board that thinks with you

The public site and no-login sandbox board for **athenabot.ai**.

Boardsy is the AI whiteboard for **middle & high school Math and Science**. You
write on the board and live information appears; you drop a stone in real
gravity, bend a parabola with a slider, rotate a molecule — 3D simulations
students can play with. Lessons, flashcards and quizzes are built in.

This repo replaces the old "AI studio" homepage. It is a single, self-contained
Node/Express app: a marketing homepage plus a **fully playable sandbox board**
that needs **no login and no database**. Signing in to save, build lessons, or
go live routes to the full product.

## What's here

```
server.js                     Express: static host + Founding-30 / contact (SMTP optional)
public/
  index.html                  Homepage (hero → Founding 30 → Six lessons → Live classroom → rest)
  home.js                     Hero stage cycler (gravity ⇄ parabola), ticker, 3D demos, Founding-30 form
  board.html / board.js       "Enter Boardsy" sandbox: subject → template → live board, draw-over layer, Plans
  styles.css                  White + blue "graph-paper board" theme
  board.css                   Sandbox layout
  viz3d.js / viz3d.css        3D + physics engine (reused, unchanged): molecules, solids, free-fall, incline…
  graphdemo.js                Interactive 2D graph engine (reused, unchanged): parabola, line, sine
  img/boardsy-logo.svg
deploy/                       PM2 + Nginx for athenabot.ai (see deploy/DEPLOY-EC2.md)
```

## Brand & scope changes

- **AthenaBoard → Boardsy** — "The board that thinks with you." No more "AthenaBoard".
- **Math & Science only** — Geography and History removed everywhere.
- **One click into the board** — the primary CTA is **Enter Boardsy** (`/board`),
  which opens a subject → template picker and drops you straight onto a live,
  fully playable whiteboard. No login needed to play; you just can't save or
  bring students in.
- **New hero** — Boardsy is more than a smart board. The headline rotates through
  the product's real capabilities, and the hero visual **auto-cycles between a
  real gravity (stone-drop) simulation and an interactive parabola graph**, with
  a Pause button so a visitor can stop on either and play with it.
- **Plans on the board** — a Sign in / Plans panel shows **Pro vs Teams**, a
  **7-day free trial**, and **Contact us — Founding 30**.

## Run locally

```bash
npm install
cp .env.example .env      # optional — the site runs without it
npm start                 # http://localhost:3000
```

Health check: `curl -s localhost:3000/api/health` → `{"ok":true,"service":"boardsy"}`

The app boots and serves **with or without SMTP**. Without SMTP, Founding-30 and
contact submissions are logged to the server console instead of emailed — set the
`SMTP_*` values in `.env` to turn on email.

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `PORT` | Node port (default 3000). Nginx proxies to it. |
| `SITE_ORIGIN` | Comma-separated allowed CORS origins. |
| `APP_BASE_URL` | Where the full logged-in product lives. The board's "Start trial / Sign in" links deep-link here. Leave blank in dev and those CTAs fall back to the Founding-30 contact. |
| `SMTP_*`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` | Optional email delivery for form submissions. |

## Deploy

Pull to `/opt/apps/athena` and run under the existing **`athenabot`** PM2 instance
— nothing about the process name or path changes. Full steps in
[`deploy/DEPLOY-EC2.md`](deploy/DEPLOY-EC2.md).
