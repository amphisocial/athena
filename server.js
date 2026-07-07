const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const app = express();

const PORT = process.env.PORT || 3000;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL || 'anu@threadwire.ai';
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://athenabot.ai';
const allowedOrigins = SITE_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    `Missing required environment variables: ${missing.join(', ')}.\n` +
    'Copy .env.example to .env and fill in your SMTP credentials before starting the server.'
  );
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((err) => {
  if (err) {
    console.error('SMTP connection failed:', err.message);
  } else {
    console.log('SMTP connection verified — AthenaBot contact form is ready.');
  }
});

app.use(cors({
  origin(origin, callback) {
    // Allow direct browser navigation, same-origin requests, health checks, and configured origins.
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
});

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(value = '') {
  return String(value).trim();
}

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot field. Real users will never see or fill this.
    if (body.company_website) {
      return res.json({ ok: true });
    }

    const name = clean(body.name);
    const email = clean(body.email);
    const company = clean(body.company);
    const projectType = clean(body.project_type);
    const timeline = clean(body.timeline);
    const budget = clean(body.budget);
    const message = clean(body.message);

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Name, email, and project details are required.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    if (message.length > 5000) {
      return res.status(400).json({ ok: false, error: 'Message is too long. Please keep it under 5,000 characters.' });
    }

    const subject = `AthenaBot inquiry — ${projectType || 'AI application'} — ${name}${company ? ` (${company})` : ''}`;

    const text = [
      'New AthenaBot project inquiry',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company || '—'}`,
      `Project type: ${projectType || '—'}`,
      `Timeline: ${timeline || '—'}`,
      `Budget: ${budget || '—'}`,
      '',
      'Project details:',
      message,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
        <h2 style="margin:0 0 16px;">New AthenaBot project inquiry</h2>
        <table style="border-collapse:collapse;">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Name</td><td>${escapeHtml(name)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Email</td><td>${escapeHtml(email)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Company</td><td>${escapeHtml(company) || '—'}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Project type</td><td>${escapeHtml(projectType) || '—'}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Timeline</td><td>${escapeHtml(timeline) || '—'}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280;">Budget</td><td>${escapeHtml(budget) || '—'}</td></tr>
        </table>
        <h3 style="margin:20px 0 8px;">Project details</h3>
        <p style="white-space:pre-wrap;margin:0;">${escapeHtml(message)}</p>
      </div>
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

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'athenabot' }));

app.listen(PORT, () => {
  console.log(`AthenaBot server listening on port ${PORT}`);
});
