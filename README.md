# AthenaBot

A white-label healthcare voice-AI **orchestration layer** plus a polished product
site. This is the layer that sits between a voice platform (Retell / Vapi / Twilio)
and a clinic's systems: it runs the triage decision tree, books appointments,
collects intake, and escalates to humans — all things the voice agent calls as
"functions" mid-conversation. The site at `/public` is the customer-facing showcase
and includes a **live triage demo** that calls the real backend.

```
athenabot/
├── public/index.html              # product site + live triage demo
├── server/
│   ├── server.js                  # Express app: serves site + /api webhooks
│   ├── triage.js                  # decision engine (safety-first)
│   ├── config/triage-rules.json   # the clinician-reviewable decision tree
│   └── integrations/
│       ├── scheduling.js          # Cal.com-shaped adapter (mock)
│       └── ehr.js                 # FHIR-shaped adapter (mock)
├── deploy/
│   ├── nginx-athenabot.conf
│   └── athenabot.service
├── .env.example
└── package.json
```

## API endpoints (what the voice agent calls)

| Method | Path                      | Purpose                                   |
|--------|---------------------------|-------------------------------------------|
| GET    | `/api/health`             | liveness check                            |
| POST   | `/api/run-triage`         | `{ "intake": "..." }` → routing decision  |
| GET    | `/api/availability`       | next open appointment slots               |
| POST   | `/api/book-appointment`   | book a slot                               |
| POST   | `/api/cancel-appointment` | cancel by confirmation id                 |
| POST   | `/api/lookup-patient`     | synthetic FHIR patient lookup by phone    |
| POST   | `/api/escalate`           | hand the call to a human with context     |

---

## Run locally

```bash
npm install
npm start          # http://localhost:8080
```

---

## Deploy to athenabot.ai on EC2 (step by step)

Assumes Ubuntu 22.04/24.04 on EC2 and that you own `athenabot.ai`.

### 1. Point the domain at the instance
- In the EC2 console, **allocate an Elastic IP** and associate it with your instance (so the IP survives reboots).
- In your domain's DNS (registrar or Route 53), create:
  - `A` record: `athenabot.ai` → your Elastic IP
  - `A` record: `www.athenabot.ai` → your Elastic IP
- In the instance **Security Group**, allow inbound **80** and **443** (and 22 from your IP).

### 2. Install the runtime
```bash
ssh ubuntu@athenabot.ai
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
node -v   # expect v20.x
```

### 3. Put the app on the server
```bash
sudo mkdir -p /opt/athenabot
sudo chown ubuntu:ubuntu /opt/athenabot
# from your laptop, in the unzipped project folder:
#   rsync -avz --exclude node_modules ./ ubuntu@athenabot.ai:/opt/athenabot/
cd /opt/athenabot
npm install --omit=dev
cp .env.example .env      # then edit .env (leave WEBHOOK_SECRET blank for now)
```

### 4. Run it as a service
```bash
sudo cp deploy/athenabot.service /etc/systemd/system/athenabot.service
sudo systemctl daemon-reload
sudo systemctl enable --now athenabot
systemctl status athenabot          # should be "active (running)"
curl -s localhost:8080/api/health   # {"status":"ok",...}
```

### 5. Put nginx in front
```bash
sudo cp deploy/nginx-athenabot.conf /etc/nginx/sites-available/athenabot
sudo ln -sf /etc/nginx/sites-available/athenabot /etc/nginx/sites-enabled/athenabot
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Visit `http://athenabot.ai` — the site should load.

### 6. Add HTTPS (free, auto-renewing)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d athenabot.ai -d www.athenabot.ai
```
Choose "redirect HTTP to HTTPS." Certbot edits the nginx config and sets up renewal.
Visit `https://athenabot.ai` — done.

### Updating later
```bash
cd /opt/athenabot
# rsync new files up, then:
npm install --omit=dev
sudo systemctl restart athenabot
```

---

## Wiring a real voice agent (next step after the demo)

1. Create an agent on **Retell** (recommended: self-serve BAA, ~$0.07/min) or Vapi.
2. Define its tools/functions to POST to your live endpoints, e.g.
   `https://athenabot.ai/api/run-triage`, `/api/availability`, `/api/book-appointment`, `/api/escalate`.
3. Set `WEBHOOK_SECRET` in `.env`, restart the service, and configure the agent to
   send it as the `x-athenabot-secret` header. (This closes the API to the public.)
4. Point a phone number at the agent and call it.

---

## Compliance notes (read before any real patient data)

- This starter uses **synthetic data only**. Do not send real PHI through it as-is.
- AWS will sign a **BAA** and EC2 is HIPAA-eligible — an advantage over general PaaS
  hosts. Execute the AWS BAA, and restrict the instance/security group/logging
  accordingly before any PHI flows.
- A compliant voice deployment needs BAAs across **every** layer that can touch PHI:
  telephony, STT, TTS, the LLM, the voice platform, and this hosting tier.
- The triage tree in `server/config/triage-rules.json` is **illustrative and not
  clinically validated**. It must be reviewed, edited, and signed off by a licensed
  clinician per organization. Keep a human escalation path always available.
- Minimize PHI: never write PHI into prompts, logs, or non-BAA downstream tools;
  enable encryption at rest and in transit; set recording retention to the minimum
  the workflow needs.
