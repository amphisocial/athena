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
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://athenabot.ai,https://www.athenabot.ai';
const allowedOrigins = SITE_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
// Where the full product (auth / billing / save / live) lives. Injected into
// the board page so the Plans CTAs deep-link to real sign-up. Leave unset in
// dev and those CTAs fall back to the Founding-30 contact.
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

// SMTP is OPTIONAL. If it isn't configured, the site still boots and serves;
// Founding-30 / contact submissions are logged so nothing dead-ends in dev.
const smtpReady = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].every((k) => process.env[k]);
let transporter = null;
if (smtpReady) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  transporter.verify((err) => {
    if (err) console.error('SMTP connection failed:', err.message);
    else console.log('SMTP verified — Boardsy mail is ready.');
  });
} else {
  console.warn('SMTP not configured — form submissions will be logged, not emailed. ' +
    'Set SMTP_* in .env to enable email.');
}

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '100kb' }));

// Inject runtime config the client needs (the app base for Plans CTAs).
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(
    `window.BOARDSY_APP_BASE=${JSON.stringify(APP_BASE_URL)};\n`
  );
});

app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again later.' }
});

const escapeHtml = (v = '') => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clean = (v = '') => String(v).trim();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function deliver({ subject, text, html, replyTo }) {
  if (!transporter) {
    console.log('\n--- (email not configured) ---\nSubject:', subject, '\n', text, '\n------------------------------\n');
    return { logged: true };
  }
  await transporter.sendMail({
    from: `"Boardsy" <${CONTACT_FROM}>`, to: CONTACT_TO, replyTo, subject, text, html
  });
  return { sent: true };
}

// ---- Founding-30 application ----
app.post('/api/founder/apply', limiter, async (req, res) => {
  try {
    const b = req.body || {};
    if (b.company_website) return res.json({ ok: true }); // honeypot

    const firstName = clean(b.firstName);
    const lastName = clean(b.lastName);
    const email = clean(b.email);
    const subjectPick = clean(b.subject);
    const grade = clean(b.grade);
    const school = clean(b.school);
    const message = clean(b.message);

    if (!firstName || !email) return res.status(400).json({ ok: false, error: 'Please add your name and school email.' });
    if (!emailOk(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (message.length > 4000) return res.status(400).json({ ok: false, error: 'Message is too long.' });

    const name = `${firstName} ${lastName}`.trim();
    const subject = `Boardsy Founding-30 — ${name}${school ? ` (${school})` : ''}`;
    const lines = [
      'New Founding-30 application', '',
      `Name: ${name}`, `Email: ${email}`, `Subject: ${subjectPick || '—'}`,
      `Grade band: ${grade || '—'}`, `School: ${school || '—'}`, '', 'Notes:', message || '—'
    ];
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f1e35">
      <h2 style="margin:0 0 14px">New Founding-30 application</h2>
      <p><b>Name:</b> ${escapeHtml(name)}<br><b>Email:</b> ${escapeHtml(email)}<br>
      <b>Subject:</b> ${escapeHtml(subjectPick) || '—'}<br><b>Grade band:</b> ${escapeHtml(grade) || '—'}<br>
      <b>School:</b> ${escapeHtml(school) || '—'}</p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p></div>`;

    await deliver({ subject, text: lines.join('\n'), html, replyTo: email });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Founder apply failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again shortly.' });
  }
});

// ---- General contact (kept for parity with the old site) ----
app.post('/api/contact', limiter, async (req, res) => {
  try {
    const b = req.body || {};
    if (b.company_website) return res.json({ ok: true });
    const name = clean(b.name), email = clean(b.email), message = clean(b.message);
    if (!name || !email || !message) return res.status(400).json({ ok: false, error: 'Name, email, and a message are required.' });
    if (!emailOk(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (message.length > 5000) return res.status(400).json({ ok: false, error: 'Message is too long.' });

    const subject = `Boardsy inquiry — ${name}`;
    await deliver({
      subject,
      text: `New Boardsy inquiry\n\nName: ${name}\nEmail: ${email}\n\n${message}`,
      html: `<p><b>${escapeHtml(name)}</b> (${escapeHtml(email)})</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      replyTo: email
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Contact failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong sending your message.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'boardsy' }));

// The board is a client-only sandbox; serve it for /board and any /board/* path.
// Written as middleware so it works on both Express 4 and Express 5, whose
// wildcard route syntax differs (Express 5 rejects bare "*").
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/board' || req.path.startsWith('/board/'))) {
    return res.sendFile(path.join(__dirname, 'public', 'board.html'));
  }
  next();
});

// SEO plumbing.
app.get('/robots.txt', (req, res) => {
  const base = APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /board\n\nSitemap: ${base}/sitemap.xml\n`
  );
});
app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
    `</urlset>\n`
  );
});

// Everything else falls back to the homepage. A path-less app.use() is the
// catch-all in both Express 4 and Express 5 (Express 5 rejects app.get('*')).
app.use((req, res) => {
  if (req.method === 'GET') return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(PORT, () => console.log(`Boardsy listening on port ${PORT}`));
