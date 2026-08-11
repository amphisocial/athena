# Boardsy — athenabot.ai

The complete product behind **athenabot.ai**: the AI whiteboard for middle &
high school **Math and Science**, with live 3D physics/math simulations, plus
built-in lessons, flashcards and quizzes. This is the full application —
accounts, saved boards, live collaboration (WebSocket), Stripe billing, and AI
generation — with the **Boardsy** homepage as its landing page.

This repo replaces both the old static homepage *and* the
`flashcards.athenabot.ai` subdomain: everything now runs from one app at
`/opt/apps/athena` under the pm2 name `athenabot`.

## Layout

```
server/            Express app: auth, boards (+WebSocket), study sets, teams,
                   Stripe billing, AI generation, mailer, Postgres (server/db.js)
public/
  index.html       Boardsy homepage (new brand) wired to the real login modal
  home.js          Homepage hero (gravity ⇄ parabola), ticker, 3D demos, Founding-30
  boardsy-home.css Homepage white/blue theme + the auth-dialog styling
  sandbox.html/.js/.css   No-login sandbox board (draw + live sims) at /sandbox
  board.html/.js   The real, auth-gated collaborative board at /board
  common.js        Shared auth/session/topbar engine (unchanged)
  viz3d.js/.css    3D + physics engine (molecules, solids, free-fall, incline…)
  graphdemo.js     Interactive 2D graph engine (parabola, line, sine)
  pricing/library/team/notes/join …   the rest of the product
scripts/           tests + lesson build + one-off migration helpers
deploy/            ecosystem.config.js, nginx-athenabot.conf, CUTOVER-EC2.md
```

## How the homepage relates to the product

- **Enter Boardsy** → `/sandbox`: a fully playable board (draw + live 3D/graph
  simulations) that needs **no account**. You just can't save or bring students
  in live. Sign-in / plan links inside it point at the real product.
- **Sign in** → the product's login modal (`#authDialog`, email/password +
  Google). Once signed in, the nav's "Sign in" becomes "My boards" (`/boards`).
- **/board** is the real collaborative whiteboard (auth required, saves to
  Postgres, live via WebSocket).
- **Pricing / trials** → `/pricing` (Pro $3.99, Teams $9.99, 7-day trial).
- **Founding-30** → a public form (`POST /api/founding/apply`) that emails
  `ADMIN_EMAIL`; no account required.

## Database

Connects via a single `DATABASE_URL` and creates tables with
`CREATE TABLE IF NOT EXISTS`. Point it at the **existing** flashcards database
and every account, board, study set, team and subscription carries over — no
dump, no migration. See `deploy/CUTOVER-EC2.md`.

## Run locally

```bash
npm install
cp .env.example .env         # set DATABASE_URL (a local or the shared Postgres)
npm start                    # http://localhost:3000
```

The app requires Postgres (`DATABASE_URL`) to boot. AI keys, Stripe, Google
OAuth and SMTP are optional locally — features that need them degrade or no-op
without them.

## Deploy / cutover

Full step-by-step (external dashboards, env, nginx+WebSocket, pm2, verification,
retiring the subdomain, rollback) is in **`deploy/CUTOVER-EC2.md`**.
