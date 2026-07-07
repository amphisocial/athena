# AthenaBot website + contact form

This is the production-ready AthenaBot root site for `https://athenabot.ai`.

The site positions AthenaBot as an AI application development and agentic workflow studio, with links to the current product portfolio:

- SmartJobs: `https://smartjobs.athenabot.ai`
- AI Flashcards: `https://flashcards.athenabot.ai`
- Lite‑PLM: `https://plm.athenabot.ai`
- White-label Voice Agent: `https://voice.athenabot.ai`

It includes a real Contact Us form that posts to `POST /api/contact` and sends email to `anu@threadwire.ai` through SMTP.

## Files

```text
package.json
server.js
.env.example
public/index.html
deploy/ecosystem.config.js
deploy/nginx-athenabot.conf
deploy/DEPLOY-EC2.md
.gitignore
```

## Local setup

```bash
npm install
cp .env.example .env
nano .env
npm start
```

Open:

```text
http://localhost:3000
```

Health check:

```bash
curl -s http://localhost:3000/api/health
# {"ok":true,"service":"athenabot"}
```

## Environment variables

Set these in `.env` on the server. Do not commit `.env`.

```bash
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
CONTACT_TO_EMAIL=anu@threadwire.ai
CONTACT_FROM_EMAIL=your-smtp-username
SITE_ORIGIN=https://athenabot.ai,https://www.athenabot.ai
PORT=3000
```

### SMTP notes

For Google Workspace, use:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-google-workspace-email
SMTP_PASS=your-google-app-password
```

Use an App Password, not the normal Google login password.

For SendGrid:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

## Deployment

See `deploy/DEPLOY-EC2.md` for the full EC2 + PM2 + Nginx + Certbot instructions.

## Contact endpoint behavior

`POST /api/contact` accepts:

```json
{
  "name": "Jane Doe",
  "email": "jane@company.com",
  "company": "Company Inc.",
  "project_type": "Custom AI application",
  "timeline": "Next 30 days",
  "budget": "$30k – $75k",
  "message": "We want an AI workflow agent that..."
}
```

The endpoint includes:

- required field validation
- email format validation
- 5,000-character message limit
- honeypot spam field
- rate limit: 8 requests per 15 minutes per IP
- HTML escaping before email rendering
- SMTP verification at boot

## GitHub update note

If replacing an existing repo, copy these files into the repo root and deploy from there.
