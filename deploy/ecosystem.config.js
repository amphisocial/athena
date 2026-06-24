// ============================================================
//  AthenaBot — PM2 process manager config
//  Runs every product as its own process on its own port.
//  Keep this file ONLY on the server (it holds secrets) — never commit it.
//
//  Usage:
//    pm2 start ecosystem.config.js
//    pm2 save            # remember the process list
//    pm2 startup         # generate the boot script it prints, then run it
//    pm2 logs smartjobs  # tail one app
//    pm2 restart smartjobs
// ============================================================

module.exports = {
  apps: [
    // ---------- SmartJobs / RoleFit ----------
    {
      name: "smartjobs",
      cwd: "/opt/apps/smartjobs",
      script: "server.js",
      env: {
        PORT: 3001,
        NODE_ENV: "production",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-...",
        OPENAI_MODEL: "gpt-4o",
        DATABASE_URL: "postgresql://rolefit:CHANGE_ME_rolefit@localhost:5432/rolefit",
        PGSSL: "false",                       // local Postgres, no SSL
        FREE_DAILY_LIMIT: "3",
        LIVE_DAILY_LIMIT: "2",
        // ---- Stripe (start in test, flip to live once verified) ----
        STRIPE_MODE: "live",
        STRIPE_LIVE_SECRET_KEY: "sk_live_...",
        STRIPE_LIVE_PRICE_ID: "price_...",          // the LIVE price
        STRIPE_LIVE_WEBHOOK_SECRET: "whsec_...",    // from the smartjobs.athenabot.ai webhook
        STRIPE_TEST_SECRET_KEY: "sk_test_...",
        STRIPE_TEST_PRICE_ID: "price_...",
        STRIPE_TEST_WEBHOOK_SECRET: "whsec_...",
      },
    },

    // ---------- Healthcare Voice AI ----------
    {
      name: "voice",
      cwd: "/opt/apps/voice",
      script: "server/server.js",
      env: {
        PORT: 3002,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://voice:CHANGE_ME_voice@localhost:5432/voice",
        PGSSL: "false",
        // add the voice provider / telephony keys this app needs
      },
    },

    // ---------- Lite-PLM ----------
    {
      name: "plm",
      cwd: "/opt/apps/plm",
      script: "backend/src/server.js",   // adjust to the PLM app's real entry file
      env: {
        PORT: 3003,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://plm:CHANGE_ME_plm@localhost:5432/plm",
        PGSSL: "false",
        // add PLM Stripe tier + API token secrets here
      },
    },
  ],
};
