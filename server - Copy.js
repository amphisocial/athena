require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const app = express();

// ---- basic config from environment ----
const PORT = process.env.PORT || 3000;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL || 'anu@threadwire.ai';
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;
const SITE_ORIGIN = process.env.SITE_ORIGIN || '*'; // e.g. https://athenabot.ai

// ---- required SMTP env vars ----
const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `Missing required environment variables: ${missing.join(', ')}.\n` +
    'Copy .env.example to .env and fill in your SMTP credentials before starting the server.'
  );
  process.exit(1);
}

// ---- mail transport ----
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// verify connection once at boot so misconfiguration fails loudly, not silently on first submit
transporter.verify((err) => {
  if (err) {
    console.error('SMTP connection failed:', err.message);
  } else {
    console.log('SMTP connection verified — ready to send mail.');
  }
});

// ---- middleware ----
app.use(cors({ origin: SITE_ORIGIN }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// throttle the contact endpoint to blunt spam / abuse
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
});

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- contact form endpoint ----
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // honeypot: real users never fill this hidden field in
    if (body.company_website) {
      return res.json({ ok: true }); // pretend success, drop silently
    }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const company = (body.company || '').trim();
    const projectType = (body.project_type || '').trim();
    const budget = (body.budget || '').trim();
    const message = (body.message || '').trim();

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Name, email, and message are required.' });
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ ok: false, error: 'Message is too long.' });
    }

    const subject = `New project inquiry — ${name}${company ? ` (${company})` : ''}`;

    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company || '—'}`,
      `Project type: ${projectType || '—'}`,
      `Budget: ${budget || '—'}`,
      '',
      'Message:',
      message,
    ].join('\n');

    const html = `
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td>${escapeHtml(name)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Email</td><td>${escapeHtml(email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Company</td><td>${escapeHtml(company) || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Project type</td><td>${escapeHtml(projectType) || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Budget</td><td>${escapeHtml(budget) || '—'}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:14px;white-space:pre-wrap;margin-top:16px;">${escapeHtml(message)}</p>
    `;

    await transporter.sendMail({
      from: `"AthenaBot Website" <${CONTACT_FROM}>`,
      to: CONTACT_TO,
      replyTo: email,
      subject,
      text,
      html,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to send contact email:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please try again shortly.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`AthenaBot server listening on port ${PORT}`);
});
