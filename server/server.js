/*
 * Boardsy
 * Simple Express app for AI-generated flashcards, quizzes, and slide study sets.
 * Stores users, sessions, usage, study sets and share invites in data/store.json.
 * (The store.json key "quizlets" is retained for backward compatibility with existing data.)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Stripe = require('stripe');
const { emailOnRoster } = require('./team');

// A student can see a teacher's shared content if they're on the team roster
// OR were invited under the older per-study-set model. Whiteboard access was
// originally granted purely by the latter, so a roster-only check locks out
// everyone who already had access before rosters existed.
// True when this person is somebody's student — on a team roster, or invited
// under the older per-study-set model. Students are on the free plan, so
// plan alone can't tell us whether to show them shared content.
function isSomeonesStudent(store, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  const onRoster = store.users.some((u) => (u.teamRoster || [])
    .some((entry) => String(entry.email || '').trim().toLowerCase() === target));
  if (onRoster) return true;
  return store.quizlets.some((set) => (set.invitedEmails || [])
    .map((e) => String(e || '').trim().toLowerCase()).includes(target));
}

// Everyone on a teacher's roster, used to notify a team when something new
// is shared with them.
function rosterEmailsFor(store, teacherId) {
  const teacher = store.users.find((u) => u.id === teacherId);
  if (!teacher) return [];
  return (teacher.teamRoster || []).map((e) => e.email).filter(Boolean);
}

function teacherDisplayName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

// Fire-and-forget so a teacher flipping "Share" isn't left waiting on up to
// 30 SMTP round-trips. Failures are logged, never surfaced as a failed share.
function notifyTeamOfShare({ store, owner, title, url, kind }) {
  const recipients = rosterEmailsFor(store, owner.id);
  if (!recipients.length) return;
  const who = teacherDisplayName(owner);
  const subject = `${who} shared a ${kind} with you`;
  const text = `${who} shared "${title}" with you on Boardsy.\n\nOpen it here: ${url}`;
  const html = `<p><strong>${who}</strong> shared "${title}" with you on Boardsy.</p><p><a href="${url}">Open it here</a></p>`;
  recipients.forEach((to) => {
    Promise.resolve()
      .then(() => sendMail({ to, subject, text, html }))
      .catch((error) => console.warn('Share notification failed for', to, error.message));
  });
}

function canViewTeachersContent(store, teacherId, email) {
  if (emailOnRoster(store, teacherId, email)) return true;
  const target = String(email || '').trim().toLowerCase();
  return store.quizlets.some((set) => set.ownerId === teacherId
    && (set.invitedEmails || []).map((e) => String(e || '').trim().toLowerCase()).includes(target));
}
const { sendMail } = require('./mailer');

// Notify the admin when someone applies to be a founding teacher. The
// application is also persisted (founder_applications table) so it isn't lost
// if SMTP is down — email is best-effort.
function notifyFounderApplication({ name, email }) {
  const to = (process.env.ADMIN_EMAIL || '').trim();
  if (!to) return Promise.resolve({ sent: false, reason: 'no ADMIN_EMAIL' });
  const who = name ? `${name} (${email})` : email;
  const subject = `New Founding-30 application: ${who}`;
  const text = `A new founding-teacher application came in.\n\nName: ${name || '(not given)'}\nEmail: ${email}\n\nReview and reach out to set up their onboarding.`;
  const html = `<p>A new founding-teacher application came in.</p>
    <ul><li><strong>Name:</strong> ${name || '(not given)'}</li>
    <li><strong>Email:</strong> ${email}</li></ul>
    <p>Review and reach out to set up their onboarding.</p>`;
  return sendMail({ to, subject, text, html })
    .catch((e) => { console.warn('Founder-application email failed:', e.message); return { sent: false }; });
}

// Notify the admin when a founding member qualifies for the $25 gift card so
// they can coordinate sending a code.
function notifyAdminOfReward({ founderEmail, referredEmail }) {
  const to = (process.env.ADMIN_EMAIL || '').trim();
  if (!to) return Promise.resolve({ sent: false, reason: 'no ADMIN_EMAIL' });
  const subject = `$25 gift-card owed: founding member referral (${founderEmail})`;
  const text = `Founding member ${founderEmail} referred ${referredEmail}, who became a paid/founding member.\n\nThey qualify for the $25 Amazon gift card. Coordinate sending a code.`;
  const html = `<p>Founding member <strong>${founderEmail}</strong> referred <strong>${referredEmail}</strong>, who became a paid/founding member.</p>
    <p>They qualify for the <strong>$25 Amazon gift card</strong>. Coordinate sending a code.</p>`;
  return sendMail({ to, subject, text, html })
    .catch((e) => { console.warn('Reward notification email failed:', e.message); return { sent: false }; });
}

// Send a webinar seat confirmation to a public sign-up, with the join link and
// the scheduled time. Best-effort — never blocks the signup response.
function sendWebinarSignupEmail({ to, title, scheduledAt, joinUrl, live }) {
  const when = (() => { const d = new Date(scheduledAt); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }); })();
  const subject = live ? `You're in: "${title}" is live now` : `Your seat is reserved: "${title}"`;
  const whenLine = when ? (live ? `It's live right now.` : `Scheduled for ${when}.`) : '';
  const text = `Your seat for "${title}" on Boardsy is confirmed.\n\n${whenLine}\n\nJoin here when it starts: ${joinUrl}\n\nSee you there!`;
  const html = `<p>Your seat for <strong>"${title}"</strong> on Boardsy is confirmed.</p>
    ${whenLine ? `<p>${whenLine}</p>` : ''}
    <p><a href="${joinUrl}">Join the session</a> when it starts.</p>
    <p style="color:#5a6b85;font-size:13px">If the button doesn't work, paste this link into your browser:<br>${joinUrl}</p>`;
  return sendMail({ to, subject, text, html })
    .catch((e) => { console.warn('Webinar signup email failed:', e.message); return { sent: false }; });
}

// Send a referral invitation email on behalf of a member.
function sendReferralInvite({ fromName, toEmail, link }) {
  const subject = `${fromName} invited you to Boardsy`;
  const text = `${fromName} thinks you'd like Boardsy — the AI whiteboard that turns your explanation into a live simulation.\n\nGet started: ${link}`;
  const html = `<p><strong>${fromName}</strong> thinks you'd like Boardsy — the AI whiteboard that turns your explanation into a live simulation.</p><p><a href="${link}">Get started</a></p>`;
  return sendMail({ to: toEmail, subject, text, html })
    .catch((e) => { console.warn('Referral invite email failed:', e.message); return { sent: false }; });
}

// Load .env when present. Under systemd this is redundant (EnvironmentFile=
// already injects it), but pm2 and plain `node server/server.js` need this
// to pick up secrets/config from .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = Number(process.env.PORT || 3004);
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'athena_flashcards_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-session-secret';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

const PLAN_LIMITS = {
  // whiteboard      = can create & share boards (static share links)
  // whiteboardLive  = can go live / take questions / collaborate in real time
  // maxBoards       = how many boards the teacher can keep
  free:    { label: 'Free',    setsPerDay: 5,  shareSeats: 0,  whiteboard: true,  whiteboardLive: false, maxBoards: 1 },
  starter: { label: 'Pro',     setsPerDay: 10, shareSeats: 0,  whiteboard: true,  whiteboardLive: false, maxBoards: 50 },
  team:    { label: 'Teams',   setsPerDay: 20, shareSeats: 30, whiteboard: true,  whiteboardLive: true,  maxBoards: 200 }
};

// Plans a user may self-serve trial without paying. 7 days each, one trial
// per plan per account (tracked via user.trialsUsed so it can't be restarted
// by re-selecting the same plan).
const TRIAL_LENGTH_DAYS = 7;
const TRIALABLE_PLANS = ['starter', 'team'];

const STRIPE_PRICE_TO_PLAN = Object.fromEntries(
  [
    [process.env.STRIPE_PRICE_STARTER, 'starter'],
    [process.env.STRIPE_PRICE_TEAM, 'team']
  ].filter(([priceId]) => Boolean(priceId))
);

// Persistence now lives in Postgres (server/db.js). The db module keeps the
// exact same synchronous readStore/writeStore contract the app was written
// against — it serves an in-memory snapshot for reads and flushes changes to
// Postgres in the background — so the ~40 call sites below are unchanged.
const db = require('./db');

// The public "Learning" catalog (Massachusetts topics by grade & subject).
// Its own typed table, seeded from curriculum-data.js after db.init().
const curriculum = require('./curriculum');

// ensureStore is now a no-op kept for the few places that call it; the DB
// schema is created by db.init() at boot.
function ensureStore() { /* schema created in db.init() */ }

function readStore() {
  return db.readStore();
}

function writeStore(store) {
  db.writeStore(store);
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const iterations = 310000;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, iterationText, salt, expected] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2_sha256') return false;
    const actual = crypto.pbkdf2Sync(password, salt, Number(iterationText), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  parts.push('Path=/');
  if (options.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/`);
}

// ---- Free trial helpers -------------------------------------------------
// A trial is stored directly on the user record:
//   trialPlan       - 'starter' | 'team' | null
//   trialStartedAt  - ISO date the trial began
//   trialEndsAt     - ISO date the trial expires (start + 7 days)
//   trialsUsed      - array of plan ids already trialed, e.g. ['starter']
// Trial status is derived on read rather than by a background job, so it's
// always correct even if the server was offline when a trial should have
// expired. If a user's trial has lapsed, downgradeExpiredTrial() flips them
// back to plan:'free' and clears the active trial fields (trialsUsed keeps
// the record so they can't restart the same trial).
function isTrialActive(user) {
  return Boolean(user.trialPlan && user.trialEndsAt && new Date(user.trialEndsAt) > new Date());
}

function trialDaysRemaining(user) {
  if (!isTrialActive(user)) return 0;
  const msLeft = new Date(user.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
}

// Call this before reading a user's plan anywhere that matters (billing
// gates, whiteboard access, sharing). Mutates + persists if a trial just
// lapsed. Returns the (possibly updated) user.
function downgradeExpiredTrial(user) {
  if (!user.trialPlan) return user;
  if (isTrialActive(user)) return user;
  const store = readStore();
  const fresh = store.users.find((candidate) => candidate.id === user.id);
  if (!fresh || !fresh.trialPlan) return fresh || user;
  if (isTrialActive(fresh)) return fresh;
  if (fresh.subscriptionStatus !== 'active' && fresh.plan === fresh.trialPlan) {
    fresh.plan = 'free';
    fresh.subscriptionStatus = 'free';
  }
  fresh.trialPlan = null;
  fresh.trialStartedAt = null;
  fresh.trialEndsAt = null;
  fresh.updatedAt = nowIso();
  writeStore(store);
  return fresh;
}

// Admin-granted complimentary licenses (e.g. "3 free months of Teams") carry a
// compEndsAt. When it lapses, drop the user back to free. Called alongside the
// trial check before plan-sensitive reads.
function downgradeExpiredComp(user) {
  if (!user || user.subscriptionStatus !== 'comp' || !user.compEndsAt) return user;
  if (new Date(user.compEndsAt) > new Date()) return user;
  const store = readStore();
  const fresh = store.users.find((c) => c.id === user.id);
  if (!fresh || fresh.subscriptionStatus !== 'comp') return fresh || user;
  if (new Date(fresh.compEndsAt) > new Date()) return fresh;
  fresh.plan = 'free';
  fresh.subscriptionStatus = 'free';
  fresh.compEndsAt = null;
  fresh.compGrantedBy = null;
  fresh.updatedAt = nowIso();
  writeStore(store);
  return fresh;
}

function publicUser(user) {
  if (!user) return null;
  user = downgradeExpiredTrial(user);
  user = downgradeExpiredComp(user);
  const role = membership.role(user);              // admin | founder | member
  const privileged = membership.isPrivileged(user.email);
  const effPlan = membership.effectivePlan(user);  // privileged -> 'team'
  const plan = user.plan || 'free';
  const trialActive = isTrialActive(user);
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
    plan,
    // effectivePlan is what actually gates features; plan is what they pay for.
    effectivePlan: effPlan,
    role,
    isAdmin: role === 'admin',
    isFounder: role === 'founder',
    planLabel: role === 'admin' ? 'Admin' : role === 'founder' ? 'Founder Teacher' : (PLAN_LIMITS[plan]?.label || 'Free'),
    subscriptionStatus: user.subscriptionStatus || 'free',
    limits: membership.effectiveLimits(user),
    trial: {
      active: trialActive,
      plan: trialActive ? user.trialPlan : null,
      daysRemaining: trialDaysRemaining(user),
      endsAt: trialActive ? user.trialEndsAt : null,
      trialsUsed: user.trialsUsed || [],
      availableTrials: TRIALABLE_PLANS.filter((p) => !(user.trialsUsed || []).includes(p) && !trialActive)
    }
  };
}

// Same lookup as getCurrentUser but from a raw Cookie header string rather
// than an Express req. Used by the whiteboard WebSocket: the browser sends
// the session cookie automatically on the ws:// upgrade request (same
// origin), so the raw HTTP upgrade request's headers.cookie is all that's
// needed — no token ever has to touch a URL or client-side JS.
function getUserFromCookieHeader(cookieHeader) {
  const token = Object.fromEntries(
    String(cookieHeader || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  )[COOKIE_NAME];
  if (!token) return null;
  const store = readStore();
  const session = store.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const user = store.users.find((candidate) => candidate.id === session.userId) || null;
  return user ? downgradeExpiredTrial(user) : null;
}

function getCurrentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const store = readStore();
  const session = store.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const user = store.users.find((candidate) => candidate.id === session.userId) || null;
  return user ? downgradeExpiredTrial(user) : null;
}

function requireUser(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  req.user = user;
  next();
}

function createSession(res, userId) {
  const store = readStore();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  store.sessions = store.sessions.filter((session) => new Date(session.expiresAt) > new Date());
  store.sessions.push({ token, userId, createdAt: nowIso(), expiresAt });
  writeStore(store);
  setCookie(res, COOKIE_NAME, token, {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: NODE_ENV === 'production'
  });
}

function getDailyUsage(userId) {
  const store = readStore();
  const today = todayKey();
  return store.quizlets.filter((quizlet) => quizlet.ownerId === userId && todayKey(new Date(quizlet.createdAt)) === today).length;
}

function canCreateSet(user) {
  const plan = membership.effectivePlan(user);
  const limit = PLAN_LIMITS[plan]?.setsPerDay || PLAN_LIMITS.free.setsPerDay;
  const used = getDailyUsage(user.id);
  return { ok: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

// Sharing model: a study set (or whiteboard, see board.js) is visible to
// someone other than its owner when BOTH are true — the item is marked
// `shared: true`, and the requester's email is on the owner's team roster
// (server/team.js). This replaced the original per-item invitedEmails list;
// `invitedEmails` is still checked as a fallback so study sets shared under
// the old model before this change keep working without a data migration.
function userCanReadQuizlet(user, quizlet, store) {
  if (!user || !quizlet) return false;
  if (quizlet.ownerId === user.id) return true;
  if (quizlet.shared && store && emailOnRoster(store, quizlet.ownerId, user.email)) return true;
  return (quizlet.invitedEmails || []).map(normalizeEmail).includes(normalizeEmail(user.email));
}

// Roles/access + referrals/rewards. Layered on top of PLAN_LIMITS so admins
// and founders (from .env) get full access without billing.
const { attachMembership } = require('./membership');
const membership = attachMembership(db, {
  PLAN_LIMITS,
  // notifyAdminOfReward is wired after the mailer is defined below.
  notifyAdminOfReward: (info) => notifyAdminOfReward(info)
});

function userHasWhiteboardAccess(user) {
  return membership.hasWhiteboard(user);
}

// Live collaboration (go-live, questions, real-time viewers) is Teams-only.
function userHasLiveAccess(user) {
  return Boolean(membership.effectiveLimits(user).whiteboardLive);
}

function compactText(text, maxLength = 16000) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- Optional stock photography for slide decks -----------------------
// Set PEXELS_API_KEY (preferred, generous free tier) or UNSPLASH_ACCESS_KEY
// in .env to have slides fetch a real, relevant photo per slide. If neither
// is set, slides still render at full quality using a designed gradient +
// icon treatment instead of a photo — no external calls are made.
const imageCache = new Map();

async function fetchStockImage(query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key) return null;
  if (imageCache.has(key)) return imageCache.get(key);

  let result = null;
  try {
    if (process.env.PEXELS_API_KEY) {
      const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(key)}&per_page=1&orientation=landscape`, {
        headers: { Authorization: process.env.PEXELS_API_KEY }
      });
      const data = await response.json();
      const photo = data.photos?.[0];
      if (photo) {
        result = {
          url: photo.src?.large2x || photo.src?.large || photo.src?.original,
          credit: `Photo by ${photo.photographer} on Pexels`,
          creditUrl: photo.url
        };
      }
    } else if (process.env.UNSPLASH_ACCESS_KEY) {
      const response = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(key)}&per_page=1&orientation=landscape`, {
        headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
      });
      const data = await response.json();
      const photo = data.results?.[0];
      if (photo) {
        result = {
          url: photo.urls?.regular,
          credit: `Photo by ${photo.user?.name || 'Unsplash'} on Unsplash`,
          creditUrl: photo.links?.html
        };
      }
    }
  } catch (error) {
    console.warn('Stock image fetch failed:', error.message);
  }
  imageCache.set(key, result);
  return result;
}

async function attachSlideImages(cards) {
  if (!process.env.PEXELS_API_KEY && !process.env.UNSPLASH_ACCESS_KEY) return;
  const candidates = cards.filter((card) => card.type === 'slide' && card.imageQuery && card.layout !== 'quote' && card.layout !== 'chart');
  const batchSize = 4;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async (card) => {
      const image = await fetchStockImage(card.imageQuery);
      if (image) {
        card.imageUrl = image.url;
        card.imageCredit = image.credit;
        card.imageCreditUrl = image.creditUrl;
      }
    }));
  }
}

// ---- Configurable prompts & "skills" -----------------------------------
// The actual generation prompts live as plain text files under
// server/prompts/, not hardcoded in this file, so they can be tuned on the
// server (house style, structural conventions, etc.) without a code change
// or redeploy. Files are read fresh on every generation call.
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const SKILLS_DIR = path.join(PROMPTS_DIR, 'skills');

function readTextFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function renderTemplate(template, vars) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => (vars[key] ?? ''));
}

function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();
}

function loadSkills(envVar, defaultList) {
  const names = String(process.env[envVar] || defaultList).split(',').map((name) => name.trim()).filter(Boolean);
  return names
    .map((name) => readTextFile(path.join(SKILLS_DIR, `${name}.md`)).trim())
    .filter(Boolean)
    .join('\n\n');
}

function loadSecretSauce() {
  return stripComments(readTextFile(path.join(SKILLS_DIR, 'secret-sauce.md')));
}

function safeJsonFromText(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch { /* continue */ }
    }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch { /* continue */ }
    }
    throw new Error('The AI response was not valid JSON.');
  }
}

const SLIDE_LAYOUTS = new Set(['title', 'agenda', 'content', 'stat', 'chart', 'quote', 'section', 'closing']);

function cleanCard(card, index, format) {
  const front = String(card.front || card.term || card.question || card.title || `Card ${index + 1}`).trim();
  const back = String(card.back || card.answer || card.definition || card.body || '').trim();
  const choices = Array.isArray(card.choices) ? card.choices.map((choice) => String(choice).trim()).filter(Boolean).slice(0, 5) : [];
  let type;
  if (card.type === 'slide' || format === 'slides') {
    type = 'slide';
  } else if (choices.length >= 2 || format === 'quiz') {
    type = 'quiz';
  } else {
    type = 'flashcard';
  }
  const normalized = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const answerIndex = type === 'quiz'
    ? choices.findIndex((choice) => normalized(choice) === normalized(back))
    : -1;

  const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
  const base = {
    id: id('card'),
    front: front.slice(0, 500),
    back: back.slice(0, type === 'slide' ? 2400 : 1200) || 'Review the source material and add your answer here.',
    type,
    choices: type === 'slide' ? [] : choices,
    answerIndex,
    explanation: String(card.explanation || '').trim().slice(0, 1200),
    passage: type === 'quiz' ? String(card.passage || '').trim().slice(0, 1400) : '',
    domain: type === 'quiz' ? String(card.domain || '').trim().slice(0, 60) : '',
    difficulty: type === 'quiz' && DIFFICULTIES.has(String(card.difficulty || '').toLowerCase()) ? String(card.difficulty).toLowerCase() : ''
  };

  if (type !== 'slide') return base;

  const layout = SLIDE_LAYOUTS.has(card.layout) ? card.layout : (index === 0 ? 'title' : 'content');
  const stat = card.stat && (card.stat.value || card.stat.label)
    ? { value: String(card.stat.value || '').trim().slice(0, 24), label: String(card.stat.label || '').trim().slice(0, 140) }
    : null;
  const quote = card.quote && (typeof card.quote === 'string' ? card.quote : card.quote.text)
    ? {
        text: String(typeof card.quote === 'string' ? card.quote : card.quote.text || '').trim().slice(0, 320),
        attribution: String((card.quote && card.quote.attribution) || '').trim().slice(0, 120)
      }
    : null;
  const chart = card.chart && Array.isArray(card.chart.series) && card.chart.series.length
    ? {
        type: card.chart.type === 'line' ? 'line' : 'bar',
        unit: String(card.chart.unit || '').trim().slice(0, 12),
        series: card.chart.series
          .slice(0, 6)
          .map((point) => ({ label: String(point.label || '').trim().slice(0, 24), value: Number(point.value) }))
          .filter((point) => point.label && Number.isFinite(point.value))
      }
    : null;
  const resolvedLayout = layout === 'chart' && (!chart || chart.series.length < 2) ? 'content' : layout;

  return {
    ...base,
    layout: resolvedLayout,
    kicker: String(card.kicker || '').trim().slice(0, 60),
    stat,
    quote,
    chart: resolvedLayout === 'chart' ? chart : null,
    imageQuery: String(card.imageQuery || '').trim().slice(0, 80),
    imageUrl: null,
    imageCredit: null,
    imageCreditUrl: null
  };
}

async function normalizeGeneratedSet(payload, requestedCount, format) {
  const title = String(payload.title || payload.name || 'AI Study Set').trim().slice(0, 90) || 'AI Study Set';
  const rawCards = Array.isArray(payload.cards) ? payload.cards : [];
  const cards = rawCards
    .slice(0, Math.max(1, Math.min(60, requestedCount)))
    .map((card, index) => cleanCard(card, index, format))
    .filter((card) => card.front && card.back);
  if (!cards.length) throw new Error('No usable cards were generated.');
  if (format === 'slides') await attachSlideImages(cards);
  return { title, cards };
}

function fallbackGenerateCards({ content, cardCount, format, subject, category, grade }) {
  const clean = compactText(content, 12000);
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40)
    .slice(0, Math.max(cardCount * 2, 8));

  const titleParts = [subject, category, grade].filter(Boolean);
  const title = titleParts.length ? `${titleParts.join(' • ')} Study Set` : 'AI Study Set';
  const cards = [];

  if (format === 'slides') {
    const perSlide = 3;
    const topic = [subject, category].filter(Boolean).join(' ') || 'business strategy';
    const numberSentence = sentences.find((sentence) => /\b\d[\d,.]*%?/.test(sentence));
    const numberMatch = numberSentence ? numberSentence.match(/\b\d[\d,.]*%?/) : null;

    for (let index = 0; index < cardCount; index += 1) {
      const isFirst = index === 0;
      const isLast = index === cardCount - 1 && cardCount > 1;
      const isStat = !isFirst && !isLast && numberMatch && index === 1;
      let layout = 'content';
      if (isFirst) layout = 'title';
      else if (isLast) layout = 'closing';
      else if (isStat) layout = 'stat';

      const bullets = [];
      if (layout === 'content') {
        for (let b = 0; b < perSlide; b += 1) {
          const sentence = sentences[(index * perSlide + b) % Math.max(1, sentences.length)];
          if (sentence) bullets.push(sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence);
        }
      }

      const card = {
        id: id('card'),
        front: isFirst ? title : isLast ? 'Key takeaways' : isStat ? 'By the numbers' : `Key points ${index + 1}`,
        back: layout === 'content'
          ? (bullets.join('\n') || 'Add source material to generate stronger slides.')
          : layout === 'title' ? (category || subject || 'A concise, professional overview.') : '',
        type: 'slide',
        layout,
        kicker: isFirst ? (category || 'Overview') : isLast ? 'Summary' : '',
        choices: [],
        answerIndex: -1,
        stat: isStat && numberMatch ? { value: numberMatch[0], label: numberSentence.slice(0, 140) } : null,
        quote: null,
        imageQuery: layout === 'title' ? topic : '',
        imageUrl: null,
        imageCredit: null,
        imageCreditUrl: null,
        explanation: 'Generated locally because no AI provider key was configured or the provider call failed.'
      };
      cards.push(card);
    }
    return { title, cards };
  }

  for (let index = 0; index < cardCount; index += 1) {
    const sentence = sentences[index % Math.max(1, sentences.length)] || clean || 'Add source material to generate stronger flashcards.';
    const short = sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
    const front = format === 'quiz'
      ? `What is the key idea behind: “${short}”?`
      : `Explain this key idea: ${short}`;
    const back = sentence;
    const quizChoices = format === 'quiz'
      ? [
          'The statement captures the main point from the source.',
          'The statement is unrelated to the source.',
          'The statement is a minor formatting note.',
          'The statement is only a date or citation.'
        ]
      : [];
    cards.push({
      id: id('card'),
      front,
      back,
      type: format === 'quiz' ? 'quiz' : 'flashcard',
      choices: quizChoices,
      answerIndex: format === 'quiz' ? 0 : -1,
      explanation: 'Generated locally because no AI provider key was configured or the provider call failed.'
    });
  }
  return { title, cards };
}

function buildGenerationPrompt({ content, cardCount, format, category, grade, subject, notes, difficultySkew }) {
  const isSlides = format === 'slides';
  const isSatPrep = String(category || '').trim().toLowerCase() === 'sat prep';
  const vars = {
    cardCount,
    category: category || 'General learning',
    grade: grade || 'Not specified',
    subject: subject || 'Not specified',
    section: subject || 'Reading and Writing',
    format: format || 'mixed',
    notes: notes || (isSlides ? 'Teach the concept for the stated grade and show every step of the working.' : 'Make it clear, useful, and exam/interview ready.'),
    material: compactText(content, 15000),
    difficultySkew: difficultySkew || 'roughly 30% easy, 40% medium, 30% hard'
  };

  const templateFile = isSatPrep ? 'sat-prep.md' : isSlides ? 'slides.md' : 'study-cards.md';
  const baseTemplate = readTextFile(path.join(PROMPTS_DIR, templateFile));
  let prompt = renderTemplate(baseTemplate, vars);

  if (!isSatPrep) {
    // Slides use only clean-bullet discipline (mece); the deck template already
    // enforces the teaching approach. Study cards keep their structure skill.
    const skills = loadSkills(isSlides ? 'SLIDE_SKILLS' : 'CARD_SKILLS', 'mece-structure');
    if (skills) prompt += `\n\n---\nAdditional style rules to follow:\n${skills}`;
  }

  const secretSauce = loadSecretSauce();
  if (secretSauce) prompt += `\n\n---\nHouse-specific instructions (always follow these, highest priority):\n${secretSauce}`;

  return prompt;
}

async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return strict JSON only. Do not include markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'OpenAI request failed.');
  return payload.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const model = encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-1.5-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Gemini request failed.');
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
}

async function callClaude(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: 'Return strict JSON only. Do not include markdown fences or commentary.',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Anthropic request failed.');
  return (payload.content || []).map((part) => part.text || '').join('\n');
}

// ---- Whiteboard "Ask AI" (vision) --------------------------------------
// Reuses the same provider/keys configured for study-set generation above,
// just with an image attached instead of a text-only prompt. Falls back to
// a clear error (surfaced to the teacher in the board UI) rather than a
// silent local fallback — unlike flashcard generation, there's no sensible
// non-AI substitute for "explain what's on the board".
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Invalid image snapshot.');
  return { mediaType: match[1], base64: match[2] };
}

async function callClaudeVision(instructions, imageDataUrl) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const { mediaType, base64 } = parseDataUrl(imageDataUrl);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: instructions }
        ]
      }]
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Anthropic request failed.');
  return (payload.content || []).map((part) => part.text || '').join('\n').trim();
}

async function callOpenAIVision(instructions, imageDataUrl) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: instructions },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }],
      max_tokens: 500
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'OpenAI request failed.');
  return (payload.choices?.[0]?.message?.content || '').trim();
}

async function callGeminiVision(instructions, imageDataUrl) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const { mediaType, base64 } = parseDataUrl(imageDataUrl);
  const model = encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-1.5-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mediaType, data: base64 } }, { text: instructions }] }],
      generationConfig: { temperature: 0.3 }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Gemini request failed.');
  return (payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '').trim();
}

async function askVisionAI({ instructions, imageDataUrl }) {
  if (!imageDataUrl) throw new Error('No snapshot provided.');
  const provider = resolveProvider();
  if (provider === 'gemini') return callGeminiVision(instructions, imageDataUrl);
  if (provider === 'openai') return callOpenAIVision(instructions, imageDataUrl);
  return callClaudeVision(instructions, imageDataUrl);
}

// The AI provider is controlled by the server operator via .env, never by the
// browser. Set AI_PROVIDER=claude | openai | gemini (aliases: anthropic, google).
// If AI_PROVIDER is unset, the first provider with an API key configured wins.
// Provider-agnostic raw call used by the notes/quiz module - same routing
// as generateWithProvider but returns the raw model text for JSON parsing.
async function callProviderRaw(prompt) {
  const provider = resolveProvider();
  if (provider === 'gemini') return callGemini(prompt);
  if (provider === 'openai') return callOpenAI(prompt);
  return callClaude(prompt);
}

function resolveProvider() {
  const raw = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  const aliases = { anthropic: 'claude', claude: 'claude', openai: 'openai', gpt: 'openai', google: 'gemini', gemini: 'gemini' };
  if (aliases[raw]) return aliases[raw];
  if (raw) console.warn(`[ai] Unknown AI_PROVIDER "${raw}" — falling back to auto-detection.`);
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'claude';
}

async function generateWithProvider(options) {
  const prompt = buildGenerationPrompt(options);
  const provider = resolveProvider();
  const isSatPrep = String(options.category || '').trim().toLowerCase() === 'sat prep';
  try {
    let text;
    if (provider === 'gemini') text = await callGemini(prompt);
    else if (provider === 'openai') text = await callOpenAI(prompt);
    else text = await callClaude(prompt);
    return await normalizeGeneratedSet(safeJsonFromText(text), options.cardCount, options.format);
  } catch (error) {
    console.warn(`${provider} generation failed:`, error.message);
    if (isSatPrep) {
      // SAT-style questions require an actual model call — the generic local
      // fallback (splitting sentences out of pasted text) produces exactly
      // the kind of low-quality output this feature exists to avoid.
      throw new Error('SAT Prep needs a working AI provider to write real practice questions. Check your AI_PROVIDER and API key in .env, then try again.');
    }
    const fallback = fallbackGenerateCards(options);
    if (options.format === 'slides') await attachSlideImages(fallback.cards);
    return fallback;
  }
}

async function extractUploadText(file) {
  if (!file) throw new Error('No file uploaded.');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = file.mimetype || '';
  if (ext === '.pdf' || mime.includes('pdf')) {
    const parsed = await pdfParse(file.buffer);
    return compactText(parsed.text, 50000);
  }
  if (ext === '.docx' || mime.includes('wordprocessingml')) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return compactText(parsed.value, 50000);
  }
  return compactText(file.buffer.toString('utf8'), 50000);
}

function upsertGoogleUser(profile) {
  const store = readStore();
  const email = normalizeEmail(profile.email);
  let user = store.users.find((candidate) => candidate.email === email);
  if (!user) {
    user = {
      id: id('usr'),
      email,
      firstName: profile.given_name || profile.name?.split(' ')[0] || '',
      lastName: profile.family_name || '',
      passwordHash: null,
      provider: 'google',
      plan: 'free',
      subscriptionStatus: 'free',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    store.users.push(user);
  } else {
    user.firstName ||= profile.given_name || '';
    user.lastName ||= profile.family_name || '';
    user.provider = user.provider || 'google';
    user.updatedAt = nowIso();
  }
  writeStore(store);
  return user;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Stripe is not configured.');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).send(`Webhook signature failed: ${error.message}`);
  }

  const store = readStore();
  const updateUserPlan = (userId, patch) => {
    const user = store.users.find((candidate) => candidate.id === userId);
    if (user) Object.assign(user, patch, { updatedAt: nowIso() });
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    if (userId && PLAN_LIMITS[plan]) {
      updateUserPlan(userId, {
        plan,
        subscriptionStatus: 'active',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        trialPlan: null,
        trialStartedAt: null,
        trialEndsAt: null
      });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId || store.users.find((user) => user.stripeCustomerId === subscription.customer)?.id;
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const plan = STRIPE_PRICE_TO_PLAN[priceId] || subscription.metadata?.plan;
    if (userId && PLAN_LIMITS[plan]) {
      updateUserPlan(userId, {
        plan,
        subscriptionStatus: subscription.status,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId || store.users.find((user) => user.stripeSubscriptionId === subscription.id)?.id;
    if (userId) {
      updateUserPlan(userId, { plan: 'free', subscriptionStatus: 'canceled', stripeSubscriptionId: null });
    }
  }

  store.events.push({ id: id('evt'), type: event.type, receivedAt: nowIso() });
  writeStore(store);
  return res.json({ received: true });
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

// ---- Boardsy homepage additions -------------------------------------------
// Runtime config for the no-login sandbox. Everything is same-origin now, so
// the sandbox's sign-in / plans links point at real routes and no external app
// base is needed; kept so /config.js never 404s.
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send('window.BOARDSY_APP_BASE="";\n');
});

// The no-login sandbox: the real board (board.html) running in guest mode —
// board.js detects the /sandbox path, starts a blank local board, skips the
// saved-board fetch and the live socket, and routes Analyze to the rate-limited
// guest endpoint. Save / Share / Go-live are hidden. The real, auth-gated
// collaborative board stays at /board.
app.get('/sandbox', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'board.html'));
});

// Public, no-login shared board: anyone with the link opens a read-only copy
// (board.js detects the /s/ path and loads it via /api/public/board/:token).
app.get('/s/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'board.html'));
});

// QR image for a share link (used in the Share dialog and share emails).
const QRCode = require('qrcode');
app.get('/qr', async (req, res) => {
  const data = String(req.query.d || '').slice(0, 2000);
  if (!data) return res.status(400).send('missing d');
  try {
    const png = await QRCode.toBuffer(data, { type: 'png', width: 320, margin: 1,
      color: { dark: '#0f1e35', light: '#ffffff' } });
    res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
  } catch (e) {
    res.status(500).send('qr error');
  }
});

// Public Founding-30 application from the homepage (no account required).
// The signed-in, account-attached version stays at /api/founder/apply.
const foundingHits = new Map();
app.post('/api/founding/apply', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.company_website) return res.json({ ok: true }); // honeypot
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const hits = (foundingHits.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    if (hits.length >= 8) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    hits.push(now); foundingHits.set(ip, hits);

    const clean = (v) => String(v || '').trim();
    const firstName = clean(b.firstName), lastName = clean(b.lastName), email = clean(b.email);
    const subject = clean(b.subject), grade = clean(b.grade), school = clean(b.school), message = clean(b.message);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!firstName || !email) return res.status(400).json({ ok: false, error: 'Please add your name and school email.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (message.length > 4000) return res.status(400).json({ ok: false, error: 'Message is too long.' });

    const name = `${firstName} ${lastName}`.trim();
    const to = (process.env.ADMIN_EMAIL || '').trim();
    if (to) {
      const details = [
        `Name: ${name}`, `Email: ${email}`, `Subject: ${subject || '—'}`,
        `Grade band: ${grade || '—'}`, `School: ${school || '—'}`, '', `Notes: ${message || '—'}`
      ].join('\n');
      await sendMail({
        to,
        subject: `New Founding-30 application: ${name || email}`,
        text: `A new founding-teacher application came in (homepage form).\n\n${details}`,
        html: `<p>A new founding-teacher application came in (homepage form).</p>
          <ul><li><strong>Name:</strong> ${name || '(not given)'}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Subject:</strong> ${subject || '—'}</li>
          <li><strong>Grade band:</strong> ${grade || '—'}</li>
          <li><strong>School:</strong> ${school || '—'}</li></ul>
          <p style="white-space:pre-wrap">${(message || '').replace(/</g, '&lt;')}</p>`
      }).catch((e) => console.warn('Founding (public) email failed:', e.message));
    } else {
      console.log('[founding] application (no ADMIN_EMAIL set):', name, email, subject, grade, school);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('public founding apply failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again shortly.' });
  }
});
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'boardsy', time: nowIso() });
});

app.get('/api/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ user: null });
  const usage = canCreateSet(user);
  const store = readStore();
  const student = isSomeonesStudent(store, user.email);
  const pub = publicUser(user);
  // canSeeWhiteboard is deliberately separate from limits.whiteboard: a
  // student is on the free plan but still needs the Whiteboard nav link to
  // reach boards their teacher shared with them.
  pub.access = { isStudent: student, canSeeWhiteboard: Boolean(pub.limits.whiteboard) || student };
  return res.json({ user: pub, usage });
});

app.post('/api/auth/register', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!/\d/.test(password)) return res.status(400).json({ error: 'Password must include at least one number.' });

  const store = readStore();
  if (store.users.some((user) => user.email === email)) return res.status(409).json({ error: 'An account already exists for this email.' });
  const user = {
    id: id('usr'),
    email,
    firstName,
    lastName,
    passwordHash: hashPassword(password),
    provider: 'email',
    plan: 'free',
    subscriptionStatus: 'free',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.users.push(user);
  writeStore(store);
  createSession(res, user.id);
  // Sync the memberships table (grants admin/founder from .env if applicable).
  membership.reconcile(user).catch(() => {});
  // If they arrived via a referral link (?ref=email), mark the referral joined.
  const refBy = normalizeEmail(req.body.referredBy || req.query.ref || '');
  if (refBy && refBy !== email) {
    db.query(`UPDATE referrals SET status = 'joined', referred_user_id = $2, joined_at = now()
              WHERE lower(referred_email) = $1 AND status = 'invited'`, [email, user.id]).catch(() => {});
  }
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const store = readStore();
  const user = store.users.find((candidate) => candidate.email === email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  createSession(res, user.id);
  membership.reconcile(user).catch(() => {});
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    const store = readStore();
    store.sessions = store.sessions.filter((session) => session.token !== token);
    writeStore(store);
  }
  clearCookie(res, COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).send('Google OAuth is not configured yet. Use email/password sign up or set Google OAuth environment variables.');
  }
  const state = crypto.createHmac('sha256', SESSION_SECRET).update(crypto.randomBytes(16)).digest('hex');
  setCookie(res, 'athena_google_state', state, { maxAge: 1000 * 60 * 10, secure: NODE_ENV === 'production' });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const expectedState = parseCookies(req).athena_google_state;
    if (!expectedState || expectedState !== req.query.state) throw new Error('Invalid OAuth state.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: req.query.code,
        grant_type: 'authorization_code',
        redirect_uri: `${APP_BASE_URL}/auth/google/callback`
      })
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenPayload.error_description || 'Google token exchange failed.');
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) throw new Error('Could not read Google profile.');
    const user = upsertGoogleUser(profile);
    createSession(res, user.id);
    membership.reconcile(user).catch(() => {});
    res.redirect('/boards?signedIn=google');
  } catch (error) {
    res.redirect(`/?googleError=${encodeURIComponent(error.message)}`);
  }
});

function buildStudySetObject(user, { title, cards, category, subject, grade, topic, topicId, isPublic, format, sourceType, extra }) {
  return {
    id: id('set'),
    ownerId: user.id,
    ownerEmail: user.email,
    title,
    sourceType: sourceType || 'content',
    category: String(category || '').trim(),
    subject: String(subject || '').trim(),
    grade: String(grade || '').trim(),
    topic: String(topic || '').trim(),
    topicId: String(topicId || '').trim(),   // links a set to a curriculum topic (optional)
    public: Boolean(isPublic),
    rating: { sum: 0, count: 0 },
    format,
    invitedEmails: [],
    shared: false,
    cards,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...(extra || {})
  };
}

function saveGeneratedSet(user, options) {
  const store = readStore();
  const studySet = buildStudySetObject(user, options);
  store.quizlets.push(studySet); // store key kept as "quizlets" for backward compatibility with existing data
  writeStore(store);
  // Creating content is the "qualifying" action for a referral (per the
  // product decision — a trial signup counts too). Fire-and-forget.
  membership.onReferredContentCreated(user).catch(() => {});
  return studySet;
}

app.post('/api/extract', requireUser, upload.single('document'), async (req, res) => {
  try {
    const text = await extractUploadText(req.file);
    res.json({ text, characters: text.length, filename: req.file.originalname });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/generate', requireUser, async (req, res) => {
  const usage = canCreateSet(req.user);
  if (!usage.ok) {
    return res.status(429).json({ error: `Daily limit reached for your ${publicUser(req.user).planLabel} plan. Upgrade or try again tomorrow.`, usage });
  }

  const cardCount = Math.max(1, Math.min(60, Number(req.body.cardCount || 10)));
  const format = ['flashcard', 'quiz', 'mixed', 'slides'].includes(req.body.format) ? req.body.format : 'mixed';
  const content = compactText(req.body.content || '', 50000);
  if (content.length < 20) return res.status(400).json({ error: 'Add more source content before generating cards.' });

  try {
    const generated = await generateWithProvider({
      content,
      cardCount,
      format,
      category: req.body.category,
      grade: req.body.grade,
      subject: req.body.subject,
      notes: req.body.notes
    });

    const studySet = saveGeneratedSet(req.user, {
      title: generated.title,
      cards: generated.cards,
      category: req.body.category,
      subject: req.body.subject,
      grade: req.body.grade,
      topic: req.body.topic,
      topicId: req.body.topicId,
      format,
      sourceType: req.body.sourceType
    });
    res.json({ set: studySet, quizlet: studySet, usage: canCreateSet(req.user) });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message || 'Could not generate the study set.' });
  }
});

// ---- Adaptive SAT practice engine ---------------------------------------
// A genuinely stateful, multi-step agent: it generates a diagnostic batch,
// grades the student's real answers server-side, decides how to adjust
// difficulty for the next batch (mirroring the real digital SAT's adaptive
// module structure), and repeats for a fixed number of stages before
// finalizing everything into one saved, reviewable study set.
const SAT_TOTAL_QUESTIONS_DEFAULT = 16;
const SAT_STAGES = 2;

function skewForStage(stage, priorAccuracy) {
  if (stage === 1) return 'roughly 40% easy, 40% medium, 20% hard (this is a diagnostic first stage, keep it broad and welcoming)';
  if (priorAccuracy >= 0.75) return 'roughly 10% easy, 35% medium, 55% hard (the student performed well on the previous stage — raise the challenge, like the real exam would)';
  if (priorAccuracy <= 0.45) return 'roughly 55% easy, 35% medium, 10% hard (the student struggled on the previous stage — rebuild confidence and reinforce fundamentals before increasing difficulty again)';
  return 'roughly 25% easy, 50% medium, 25% hard (balanced, matching solid-but-not-perfect performance)';
}

function gradeStageAnswers(cards, answers) {
  const answerMap = new Map((Array.isArray(answers) ? answers : []).map((a) => [a.cardId, a.selectedIndex]));
  let correct = 0;
  const domainStats = {};
  const graded = cards.map((card) => {
    const raw = answerMap.get(card.id);
    const selectedIndex = raw === undefined || raw === null ? null : Number(raw);
    const isCorrect = selectedIndex !== null && selectedIndex === card.answerIndex;
    if (isCorrect) correct += 1;
    const domain = card.domain || 'General';
    domainStats[domain] ||= { correct: 0, total: 0 };
    domainStats[domain].total += 1;
    if (isCorrect) domainStats[domain].correct += 1;
    return { cardId: card.id, selectedIndex, isCorrect };
  });
  return { correct, total: cards.length, accuracy: cards.length ? correct / cards.length : 0, domainStats, graded };
}

function mergeDomainStats(target, addition) {
  for (const [domain, stats] of Object.entries(addition)) {
    target[domain] ||= { correct: 0, total: 0 };
    target[domain].correct += stats.correct;
    target[domain].total += stats.total;
  }
  return target;
}

app.post('/api/sat/session', requireUser, async (req, res) => {
  const usage = canCreateSet(req.user);
  if (!usage.ok) {
    return res.status(429).json({ error: `Daily limit reached for your ${publicUser(req.user).planLabel} plan. Upgrade or try again tomorrow.`, usage });
  }
  const section = ['Reading and Writing', 'Math'].includes(req.body.section) ? req.body.section : 'Reading and Writing';
  const grade = String(req.body.grade || '').trim();
  const focusNotes = compactText(req.body.focusNotes || '', 2000);
  const totalQuestions = Math.max(4, Math.min(40, Number(req.body.totalQuestions || SAT_TOTAL_QUESTIONS_DEFAULT)));
  const perStage = Math.max(2, Math.round(totalQuestions / SAT_STAGES));

  try {
    const generated = await generateWithProvider({
      content: `Adaptive SAT diagnostic — stage 1 of ${SAT_STAGES} for the ${section} section.${focusNotes ? ` Focus areas requested: ${focusNotes}` : ''}`,
      cardCount: perStage,
      format: 'quiz',
      category: 'SAT prep',
      grade,
      subject: section,
      difficultySkew: skewForStage(1, null)
    });

    const session = {
      id: id('sat'),
      userId: req.user.id,
      section,
      grade,
      focusNotes,
      stage: 1,
      totalStages: SAT_STAGES,
      perStage,
      allCards: [...generated.cards],
      stageCardIds: [generated.cards.map((c) => c.id)],
      domainStats: {},
      overallCorrect: 0,
      overallTotal: 0,
      status: 'in_progress',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const store = readStore();
    store.satSessions.push(session);
    writeStore(store);

    res.json({ sessionId: session.id, stage: 1, totalStages: SAT_STAGES, cards: generated.cards, title: generated.title });
  } catch (error) {
    console.error('SAT session start error:', error);
    res.status(500).json({ error: error.message || 'Could not start the adaptive practice session.' });
  }
});

app.post('/api/sat/session/:id/submit', requireUser, async (req, res) => {
  const store = readStore();
  const session = store.satSessions.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!session) return res.status(404).json({ error: 'Practice session not found.' });
  if (session.status !== 'in_progress') return res.status(400).json({ error: 'This practice session has already finished.' });

  const currentStageCardIds = session.stageCardIds[session.stage - 1] || [];
  const currentStageCards = session.allCards.filter((card) => currentStageCardIds.includes(card.id));
  const stageResult = gradeStageAnswers(currentStageCards, req.body.answers);

  session.overallCorrect += stageResult.correct;
  session.overallTotal += stageResult.total;
  mergeDomainStats(session.domainStats, stageResult.domainStats);
  session.updatedAt = nowIso();

  if (session.stage >= session.totalStages) {
    session.status = 'completed';
    const accuracy = session.overallTotal ? session.overallCorrect / session.overallTotal : 0;
    const studySet = buildStudySetObject(req.user, {
      title: `SAT ${session.section} Adaptive Practice`,
      cards: session.allCards,
      category: 'SAT prep',
      subject: session.section,
      grade: session.grade,
      format: 'quiz',
      sourceType: 'adaptive',
      extra: { adaptive: true, overallAccuracy: accuracy, domainStats: session.domainStats }
    });
    store.quizlets.push(studySet);
    session.finalSetId = studySet.id;
    writeStore(store);
    return res.json({
      done: true,
      stageResult,
      overallAccuracy: accuracy,
      domainStats: session.domainStats,
      set: studySet,
      usage: canCreateSet(req.user)
    });
  }

  try {
    const nextStage = session.stage + 1;
    const skew = skewForStage(nextStage, stageResult.accuracy);
    const generated = await generateWithProvider({
      content: `Adaptive SAT — stage ${nextStage} of ${session.totalStages} for the ${session.section} section. Prior stage accuracy: ${Math.round(stageResult.accuracy * 100)}%.${session.focusNotes ? ` Focus areas requested: ${session.focusNotes}` : ''}`,
      cardCount: session.perStage,
      format: 'quiz',
      category: 'SAT prep',
      grade: session.grade,
      subject: session.section,
      difficultySkew: skew
    });
    session.stage = nextStage;
    session.allCards.push(...generated.cards);
    session.stageCardIds.push(generated.cards.map((c) => c.id));
    writeStore(store);
    res.json({
      done: false,
      stage: nextStage,
      totalStages: session.totalStages,
      cards: generated.cards,
      stageResult,
      runningAccuracy: session.overallTotal ? session.overallCorrect / session.overallTotal : 0,
      domainStats: session.domainStats
    });
  } catch (error) {
    console.error('SAT session next-stage error:', error);
    res.status(500).json({ error: error.message || 'Could not generate the next stage.' });
  }
});

app.get('/api/sat/session/:id', requireUser, (req, res) => {
  const store = readStore();
  const session = store.satSessions.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!session) return res.status(404).json({ error: 'Practice session not found.' });
  res.json({
    session: {
      id: session.id,
      section: session.section,
      stage: session.stage,
      totalStages: session.totalStages,
      status: session.status,
      domainStats: session.domainStats
    }
  });
});

// ---- Guided chat planning agent -----------------------------------------
// A real multi-turn agent (not a scripted form): the client sends the full
// conversation each turn, the model decides whether it has enough context
// to build a good study set or needs to ask another question, and responds
// with a structured decision either way.
function buildCoachPrompt(messages) {
  const transcript = (Array.isArray(messages) ? messages : [])
    .map((m) => `${m.role === 'user' ? 'Student' : 'Coach'}: ${String(m.content || '').trim()}`)
    .join('\n');
  const base = readTextFile(path.join(PROMPTS_DIR, 'coach.md'));
  return renderTemplate(base, { transcript: transcript || '(nothing yet — this is the first message)' });
}

app.post('/api/chat/coach', requireUser, async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-20) : [];
  const provider = resolveProvider();
  try {
    const prompt = buildCoachPrompt(messages);
    let text;
    if (provider === 'gemini') text = await callGemini(prompt);
    else if (provider === 'openai') text = await callOpenAI(prompt);
    else text = await callClaude(prompt);
    const parsed = safeJsonFromText(text);

    if (parsed.ready) {
      return res.json({
        ready: true,
        title: String(parsed.title || '').trim().slice(0, 90),
        category: String(parsed.category || 'General learning').trim(),
        subject: String(parsed.subject || '').trim().slice(0, 80),
        grade: String(parsed.grade || '').trim().slice(0, 60),
        format: ['mixed', 'flashcard', 'quiz', 'slides'].includes(parsed.format) ? parsed.format : 'mixed',
        notes: String(parsed.notes || '').trim().slice(0, 300),
        contentSeed: String(parsed.contentSeed || '').trim().slice(0, 4000)
      });
    }
    res.json({ ready: false, message: String(parsed.message || 'Could you tell me a bit more about what you want to study?').trim().slice(0, 500) });
  } catch (error) {
    console.error('Coach chat error:', error);
    const friendly = /API_KEY is not configured/.test(error.message) ? 'The study coach needs an AI provider configured. Check AI_PROVIDER and your API key in .env.' : error.message;
    res.status(500).json({ error: friendly || 'The study coach is unavailable right now. Try the Paste content tab instead.' });
  }
});

// ---- Document ingestion planning agent -----------------------------------
// Two-step agent for uploaded documents: first it plans (reads the whole
// document, decides how to divide it into sections and which format suits
// each one), then a second step executes that plan section-by-section and
// merges the results into one mixed-format study set. The plan is returned
// to the client for a transparency check before anything is generated.
app.post('/api/generate/plan', requireUser, async (req, res) => {
  const cardCount = Math.max(2, Math.min(60, Number(req.body.cardCount || 10)));
  const content = compactText(req.body.content || '', 50000);
  if (content.length < 40) return res.status(400).json({ error: 'Add more source content before planning.' });

  const vars = {
    cardCount,
    category: req.body.category || 'General learning',
    grade: req.body.grade || 'Not specified',
    subject: req.body.subject || 'Not specified',
    material: compactText(content, 18000)
  };
  const base = readTextFile(path.join(PROMPTS_DIR, 'ingest-plan.md'));
  const prompt = renderTemplate(base, vars);
  const provider = resolveProvider();

  try {
    let text;
    if (provider === 'gemini') text = await callGemini(prompt);
    else if (provider === 'openai') text = await callOpenAI(prompt);
    else text = await callClaude(prompt);
    const parsed = safeJsonFromText(text);

    const ALLOWED_FORMATS = new Set(['flashcard', 'quiz', 'slides']);
    let sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
      .slice(0, 8)
      .map((section) => ({
        title: String(section.title || 'Section').trim().slice(0, 90),
        format: ALLOWED_FORMATS.has(section.format) ? section.format : 'flashcard',
        cardCount: Math.max(1, Math.round(Number(section.cardCount) || 1)),
        content: compactText(section.content || '', 12000)
      }))
      .filter((section) => section.content.length > 10);
    if (!sections.length) throw new Error('Could not identify sections in this document.');

    const sum = sections.reduce((total, section) => total + section.cardCount, 0);
    if (sum !== cardCount) {
      const scale = cardCount / sum;
      let running = 0;
      sections = sections.map((section, index) => {
        const isLast = index === sections.length - 1;
        const scaled = isLast ? Math.max(1, cardCount - running) : Math.max(1, Math.round(section.cardCount * scale));
        running += scaled;
        return { ...section, cardCount: scaled };
      });
    }

    res.json({ reasoning: String(parsed.reasoning || '').trim().slice(0, 300), sections });
  } catch (error) {
    console.error('Ingest plan error:', error);
    const friendly = /API_KEY is not configured/.test(error.message) ? 'Document planning needs an AI provider configured. Check AI_PROVIDER and your API key in .env.' : error.message;
    res.status(500).json({ error: friendly || 'Could not analyze this document.' });
  }
});

app.post('/api/generate/execute-plan', requireUser, async (req, res) => {
  const usage = canCreateSet(req.user);
  if (!usage.ok) {
    return res.status(429).json({ error: `Daily limit reached for your ${publicUser(req.user).planLabel} plan. Upgrade or try again tomorrow.`, usage });
  }
  const sections = Array.isArray(req.body.sections) ? req.body.sections.slice(0, 8) : [];
  if (!sections.length) return res.status(400).json({ error: 'No plan sections provided.' });

  const { category, grade, subject, notes } = req.body;

  try {
    const allCards = [];
    for (const section of sections) {
      const format = ['flashcard', 'quiz', 'slides'].includes(section.format) ? section.format : 'flashcard';
      const sectionCardCount = Math.max(1, Math.min(30, Number(section.cardCount) || 3));
      const sectionContent = compactText(section.content || '', 15000);
      if (sectionContent.length < 10) continue;
      // eslint-disable-next-line no-await-in-loop
      const generated = await generateWithProvider({ content: sectionContent, cardCount: sectionCardCount, format, category, grade, subject, notes });
      allCards.push(...generated.cards);
    }
    if (!allCards.length) throw new Error('No cards could be generated from this plan.');

    const title = String(req.body.title || '').trim() || 'AI Study Set';
    const studySet = saveGeneratedSet(req.user, {
      title,
      cards: allCards,
      category,
      subject,
      grade,
      format: 'mixed',
      sourceType: 'document-plan'
    });
    res.json({ set: studySet, quizlet: studySet, usage: canCreateSet(req.user) });
  } catch (error) {
    console.error('Execute plan error:', error);
    res.status(500).json({ error: error.message || 'Could not generate the study set from this plan.' });
  }
});

// Study set routes. Canonical paths are /api/sets; /api/quizlets is kept as a
// compatibility alias for older cached clients.
const listSets = (req, res) => {
  const store = readStore();
  const my = store.quizlets
    .filter((set) => set.ownerId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shared = store.quizlets
    .filter((set) => set.ownerId !== req.user.id && userCanReadQuizlet(req.user, set, store))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ my, shared });
};

const getSet = (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((candidate) => candidate.id === req.params.id);
  if (!userCanReadQuizlet(req.user, set, store)) return res.status(404).json({ error: 'Study set not found.' });
  res.json({ set, quizlet: set });
};

const deleteSet = (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((candidate) => candidate.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Study set not found.' });
  store.quizlets = store.quizlets.filter((candidate) => candidate.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
};

// Sharing is now a single on/off toggle per item — visible to everyone on
// the owner's team roster once flipped on, rather than picking individual
// emails per set. (The old per-set email-invite endpoint below is kept
// only so any already-shared old data keeps working; new sharing should
// use this toggle.)
const shareToggleSet = (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((candidate) => candidate.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Study set not found.' });
  const seatLimit = membership.effectiveLimits(req.user).shareSeats || 0;
  if (seatLimit < 1) return res.status(403).json({ error: 'Sharing requires the Teams plan.' });
  const wasShared = Boolean(set.shared);
  set.shared = Boolean(req.body.shared);
  set.updatedAt = nowIso();
  writeStore(store);
  if (set.shared && !wasShared) {
    notifyTeamOfShare({
      store,
      owner: req.user,
      title: set.title,
      url: `${APP_BASE_URL}/app?set=${set.id}`,
      kind: set.format === 'slides' ? 'slide deck' : 'study set'
    });
  }
  res.json({ set, quizlet: set });
};

// Legacy per-set email-invite endpoint, kept only for backward compatibility
// with any older client code that still calls it; new UI uses share-toggle.
const shareSet = (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((candidate) => candidate.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Study set not found.' });
  const seatLimit = membership.effectiveLimits(req.user).shareSeats || 0;
  if (seatLimit < 1) return res.status(403).json({ error: 'Sharing requires the Teams plan.' });

  const incoming = Array.isArray(req.body.emails) ? req.body.emails : String(req.body.emails || '').split(/[\s,;]+/);
  const emails = incoming.map(normalizeEmail).filter((email) => email && email.includes('@'));
  const unique = Array.from(new Set([...(set.invitedEmails || []).map(normalizeEmail), ...emails]));
  if (unique.length > seatLimit) return res.status(400).json({ error: `Team sharing is limited to ${seatLimit} invited users.` });
  set.invitedEmails = unique;
  set.updatedAt = nowIso();
  writeStore(store);
  res.json({ set, quizlet: set });
};

// Prepared question banks for in-session activities (polls + team quiz). The
// lesson surface already has the open set's cards on the client, but a live
// whiteboard has none, so a teacher picks from any lesson they can read here:
// their own sets first, then lessons shared with them. Returns only answerable
// questions (a prompt + 2+ choices) with the correct index and explanation —
// the teacher's screen keeps those; the engine strips them before anything
// reaches a student device.
app.get('/api/live/question-banks', requireUser, (req, res) => {
  const store = readStore();
  const readable = store.quizlets.filter((s) => userCanReadQuizlet(req.user, s, store));
  const banks = readable
    .map((s) => {
      const questions = (s.cards || [])
        .filter((c) => c.type !== 'slide' && Array.isArray(c.choices) && c.choices.length >= 2)
        .map((c) => ({
          front: String(c.front || '').slice(0, 600),
          choices: c.choices.map((x) => String(x)).slice(0, 6),
          answerIndex: Number.isInteger(c.answerIndex) ? c.answerIndex : -1,
          explanation: String(c.explanation || '').slice(0, 1200)
        }));
      const owned = s.ownerId === req.user.id;
      return {
        id: s.id, title: s.title || 'Untitled set',
        subject: s.subject || s.category || '', topic: s.topic || '',
        owned, creator: owned ? 'You' : creatorName(store, s.ownerId),
        questions
      };
    })
    .filter((b) => b.questions.length)
    // Your own lessons first, then alphabetical — so the picker is predictable.
    .sort((a, b) => (Number(b.owned) - Number(a.owned)) || a.title.localeCompare(b.title));
  res.json({ banks });
});

app.get(['/api/sets', '/api/quizlets'], requireUser, listSets);
app.get(['/api/sets/:id', '/api/quizlets/:id'], requireUser, getSet);
app.delete(['/api/sets/:id', '/api/quizlets/:id'], requireUser, deleteSet);
app.post(['/api/sets/:id/share-toggle', '/api/quizlets/:id/share-toggle'], requireUser, shareToggleSet);
app.post(['/api/sets/:id/share', '/api/quizlets/:id/share'], requireUser, shareSet);

// Lesson LIVE sessions (Teams / founders / admins). Going live lets students
// join a synced, teacher-driven presentation of the set.
app.post(['/api/sets/:id/go-live', '/api/quizlets/:id/go-live'], requireUser, (req, res) => {
  if (!membership.effectiveLimits(req.user).whiteboardLive) {
    return res.status(403).json({ error: 'Live lesson sessions are on the Teams plan. Start a free 7-day Teams trial to go live.' });
  }
  const store = readStore();
  const set = store.quizlets.find((s) => s.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Lesson not found.' });
  set.isLive = true;
  set.liveStartedAt = nowIso();
  set.updatedAt = nowIso();
  writeStore(store);
  res.json({ set });
});

app.post(['/api/sets/:id/stop-live', '/api/quizlets/:id/stop-live'], requireUser, (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((s) => s.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Lesson not found.' });
  set.isLive = false;
  set.updatedAt = nowIso();
  writeStore(store);
  res.json({ set });
});

// Edit a study set's metadata (subject / grade / topic) and public flag.
app.post(['/api/sets/:id/meta', '/api/quizlets/:id/meta'], requireUser, (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((s) => s.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Study set not found.' });
  if (req.body.subject !== undefined) { const s = String(req.body.subject).toLowerCase(); set.subject = ['math', 'science'].includes(s) ? s : ''; }
  if (req.body.grade !== undefined) set.grade = String(req.body.grade).trim().slice(0, 40);
  if (req.body.topic !== undefined) set.topic = String(req.body.topic).trim().slice(0, 80);
  if (req.body.topicId !== undefined) set.topicId = String(req.body.topicId).trim().slice(0, 120);
  if (req.body.public !== undefined) set.public = Boolean(req.body.public);
  set.updatedAt = nowIso();
  writeStore(store);
  res.json({ set });
});

// ---- Webinars: scheduled live sessions ------------------------------------
// A webinar points at an existing lesson or whiteboard. Starting it flips that
// content to live + public so anyone with the link can join as a student.
// Stored in the JSONB blob under `webinars` (no migration needed).
function webinarBoards() {
  try { return require('./board').readBoardStore().boards || []; } catch (_) { return []; }
}
function webinarJoinUrl(w) { return w.kind === 'whiteboard' ? `/board/${w.refId}` : `/l/${w.refId}`; }
function webinarRunUrl(w) { return w.kind === 'whiteboard' ? `/board/${w.refId}` : `/app?set=${w.refId}`; }
const WEBINAR_CAPACITY = 50;   // max signups per webinar (server compute limit)
const WEBINAR_FMT = { slides: 'Slides', flashcard: 'Flashcards', quiz: 'Quiz', mixed: 'Mixed' };
// How many people are connected to this webinar's live room right now. The
// WebSocket servers are created later in this file; by request time the
// bindings are live, so the closure lookup is safe.
function webinarLiveCount(w) {
  try {
    if (w.kind === 'whiteboard') return (typeof boardWss !== 'undefined' && boardWss.getLiveCount) ? boardWss.getLiveCount(w.refId) : 0;
    return (typeof lessonWss !== 'undefined' && lessonWss.getLiveCount) ? lessonWss.getLiveCount(w.refId) : 0;
  } catch (_) { return 0; }
}
function enrichWebinar(w, store, boards) {
  let title = w.title; let exists = false; let contentLive = false; let formatLabel = '';
  if (w.kind === 'lesson') {
    const s = store.quizlets.find((x) => x.id === w.refId);
    exists = !!s; contentLive = !!(s && s.isLive); if (!title && s) title = s.title;
    formatLabel = s ? (WEBINAR_FMT[s.format] || 'Mixed') : '';
  } else {
    const b = (boards || []).find((x) => x.id === w.refId);
    exists = !!b; contentLive = !!(b && b.isLive); if (!title && b) title = b.title;
    formatLabel = 'Whiteboard';
  }
  const reserved = (w.signups || []).length;          // seats reserved via signup
  const attendingNow = contentLive ? webinarLiveCount(w) : 0;   // people in the room now
  const seatsLeft = Math.max(0, WEBINAR_CAPACITY - reserved);   // seats left to reserve
  const liveSeatsLeft = Math.max(0, WEBINAR_CAPACITY - attendingNow); // seats left to join live
  return { ...w, title: title || 'Untitled webinar', exists, contentLive, formatLabel,
    public: Boolean(w.public),
    capacity: WEBINAR_CAPACITY, reserved, attendingNow, seatsLeft, liveSeatsLeft,
    signupCount: reserved,   // back-compat alias
    joinUrl: webinarJoinUrl(w), runUrl: webinarRunUrl(w) };
}

// A public webinar is "showable" while it is either upcoming or currently
// live. Once it's over (past its time and not live), it drops off the public
// board — completed webinars don't clutter the list.
function webinarShowablePublic(w, store, boards) {
  if (!w.public) return false;
  const e = enrichWebinar(w, store, boards);
  if (!e.exists) return false;
  if (e.contentLive) return true;
  return new Date(w.scheduledAt).getTime() > Date.now();
}

app.get('/api/webinars', requireUser, (req, res) => {
  const store = readStore();
  const boards = webinarBoards();
  const mine = (store.webinars || [])
    .filter((w) => w.ownerId === req.user.id)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    .map((w) => enrichWebinar(w, store, boards));
  res.json({ webinars: mine });
});

// Content the teacher can attach to a webinar (their lessons + whiteboards).
app.get('/api/webinars/options', requireUser, (req, res) => {
  const store = readStore();
  const FMT = { slides: 'Slides', flashcard: 'Flashcards', quiz: 'Quiz', mixed: 'Mixed' };
  const lessons = store.quizlets
    .filter((s) => s.ownerId === req.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((s) => ({ id: s.id, title: s.title || 'Untitled lesson', format: s.format || 'mixed', formatLabel: FMT[s.format] || 'Mixed' }));
  const boards = webinarBoards()
    .filter((b) => b.teacherId === req.user.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((b) => ({ id: b.id, title: b.title || 'Untitled board', format: 'whiteboard', formatLabel: 'Whiteboard' }));
  res.json({ lessons, boards });
});

app.post('/api/webinars', requireUser, (req, res) => {
  if (!membership.effectiveLimits(req.user).whiteboardLive) {
    return res.status(403).json({ error: 'Scheduling webinars is a Teams feature. Start a free Teams trial to schedule live sessions.' });
  }
  const kind = req.body.kind === 'whiteboard' ? 'whiteboard' : 'lesson';
  const refId = String(req.body.refId || '').trim();
  const title = String(req.body.title || '').trim().slice(0, 120);
  const when = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (!refId) return res.status(400).json({ error: 'Pick a lesson or whiteboard for the webinar.' });
  if (!when || isNaN(when.getTime())) return res.status(400).json({ error: 'Pick a date and time.' });
  const store = readStore();
  let owns = false;
  if (kind === 'lesson') owns = store.quizlets.some((s) => s.id === refId && s.ownerId === req.user.id);
  else owns = webinarBoards().some((b) => b.id === refId && b.teacherId === req.user.id);
  if (!owns) return res.status(404).json({ error: 'That content was not found in your library.' });
  const webinar = { id: id('web'), ownerId: req.user.id, title, kind, refId,
    scheduledAt: when.toISOString(), status: 'scheduled',
    public: Boolean(req.body.public), signups: [],
    createdAt: nowIso(), updatedAt: nowIso() };
  store.webinars = store.webinars || [];
  store.webinars.push(webinar);
  writeStore(store);
  res.json({ webinar: enrichWebinar(webinar, store, webinarBoards()) });
});

// ---- Public webinar board: anyone can see upcoming/live public webinars,
// sign up for a topic (capped), or join a live one if seats remain. ----------
app.get('/api/public/webinars', (req, res) => {
  const store = readStore();
  const boards = webinarBoards();
  const list = (store.webinars || [])
    .filter((w) => webinarShowablePublic(w, store, boards))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    .map((w) => {
      const e = enrichWebinar(w, store, boards);
      // Public projection only — never leak the signup roster or owner id.
      return { id: e.id, title: e.title, kind: e.kind, formatLabel: e.formatLabel,
        scheduledAt: e.scheduledAt, live: e.contentLive, joinUrl: e.joinUrl,
        capacity: e.capacity, reserved: e.reserved, attendingNow: e.attendingNow,
        seatsLeft: e.seatsLeft, liveSeatsLeft: e.liveSeatsLeft,
        signupCount: e.reserved };   // back-compat
    });
  res.json({ webinars: list });
});

app.post('/api/public/webinars/:id/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email so we can send you the join link.' });
  const store = readStore();
  const boards = webinarBoards();
  const w = (store.webinars || []).find((x) => x.id === req.params.id);
  if (!w || !webinarShowablePublic(w, store, boards)) return res.status(404).json({ error: 'That webinar is not open for signups.' });
  w.signups = w.signups || [];
  const already = w.signups.some((s) => s.email === email);
  if (!already) {
    if (w.signups.length >= WEBINAR_CAPACITY) return res.status(409).json({ error: 'This webinar is full (50 seats). Try another session.' });
    w.signups.push({ email, at: nowIso() });
    w.updatedAt = nowIso();
    writeStore(store);
  }
  const e = enrichWebinar(w, store, boards);
  const joinAbs = `${APP_BASE_URL}${e.joinUrl}`;
  // Confirmation email (best-effort): sent on first signup, and again if they
  // re-signup while it's live so they have the join link in hand.
  if (!already || e.contentLive) {
    sendWebinarSignupEmail({ to: email, title: e.title, scheduledAt: e.scheduledAt, joinUrl: joinAbs, live: e.contentLive });
  }
  res.json({ ok: true, alreadySignedUp: already, emailed: true,
    reserved: e.reserved, seatsLeft: e.seatsLeft, capacity: e.capacity,
    attendingNow: e.attendingNow, liveSeatsLeft: e.liveSeatsLeft,
    live: e.contentLive, joinUrl: e.joinUrl });
});

app.delete('/api/webinars/:id', requireUser, (req, res) => {
  const store = readStore();
  const w = (store.webinars || []).find((x) => x.id === req.params.id);
  if (!w || w.ownerId !== req.user.id) return res.status(404).json({ error: 'Webinar not found.' });
  store.webinars = (store.webinars || []).filter((x) => x.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});

// Start: flip the referenced content live + public and hand back the run link
// (for the teacher) and the join link (to share with students).
app.post('/api/webinars/:id/start', requireUser, (req, res) => {
  if (!membership.effectiveLimits(req.user).whiteboardLive) {
    return res.status(403).json({ error: 'Live sessions are a Teams feature.' });
  }
  const store = readStore();
  const w = (store.webinars || []).find((x) => x.id === req.params.id);
  if (!w || w.ownerId !== req.user.id) return res.status(404).json({ error: 'Webinar not found.' });

  if (w.kind === 'lesson') {
    const s = store.quizlets.find((x) => x.id === w.refId && x.ownerId === req.user.id);
    if (!s) return res.status(404).json({ error: 'The lesson for this webinar no longer exists.' });
    s.isLive = true; s.public = true; s.liveStartedAt = nowIso(); s.updatedAt = nowIso();
    w.status = 'live'; w.updatedAt = nowIso();
    writeStore(store);
    return res.json({ webinar: w, runUrl: `/app?set=${s.id}`, joinUrl: `/l/${s.id}` });
  }

  const boardMod = require('./board');
  const bstore = boardMod.readBoardStore();
  const b = (bstore.boards || []).find((x) => x.id === w.refId && x.teacherId === req.user.id);
  if (!b) return res.status(404).json({ error: 'The whiteboard for this webinar no longer exists.' });
  bstore.boards.forEach((x) => { if (x.teacherId === req.user.id) x.isLive = false; });
  b.isLive = true; b.shared = true; b.public = true;
  if (!b.publicToken) b.publicToken = id('pub');
  b.updatedAt = nowIso();
  boardMod.writeBoardStore(bstore);
  w.status = 'live'; w.updatedAt = nowIso();
  writeStore(store);
  return res.json({ webinar: w, runUrl: `/board/${b.id}`, joinUrl: `/board/${b.id}` });
});

// Unified Library: the teacher's boards + study sets in one list, each tagged
// with a type so the client can render and filter them together.
app.get('/api/library', requireUser, (req, res) => {  const store = readStore();
  let boards = [];
  try { boards = (require('./board').readBoardStore().boards || []); } catch (_) { boards = []; }
  const boardItems = boards
    .filter((b) => b.teacherId === req.user.id)
    .map((b) => ({
      type: 'whiteboard', id: b.id, title: b.title,
      subject: b.subject || '', grade: b.grade || '', topic: b.topic || '',
      public: Boolean(b.public), shared: Boolean(b.shared),
      rating: b.rating || { sum: 0, count: 0 },
      createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
      openUrl: `/board/${b.id}`
    }));
  const setItems = store.quizlets
    .filter((s) => s.ownerId === req.user.id)
    .map((s) => ({
      type: 'lesson', id: s.id, title: s.title,
      subject: s.subject || s.category || '', grade: s.grade || '', topic: s.topic || '',
      public: Boolean(s.public), shared: Boolean(s.shared), isLive: Boolean(s.isLive),
      rating: s.rating || { sum: 0, count: 0 },
      format: s.format, cardCount: (s.cards || []).length,
      createdAt: s.createdAt, updatedAt: s.updatedAt || s.createdAt,
      openUrl: `/app?set=${s.id}`
    }));
  const items = [...boardItems, ...setItems]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ items });
});

// ===================== Public Lessons directory (Slice 3) =====================
const board = require('./board');
function creatorName(store, userId) {
  const u = store.users.find((x) => x.id === userId);
  return u ? ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.email) : 'A teacher';
}
function ratingSummary(item) {
  const raters = item.raters || {};
  const vals = Object.values(raters);
  const count = vals.length;
  const sum = vals.reduce((n, v) => n + Number(v || 0), 0);
  return { sum, count, avg: count ? sum / count : 0 };
}
function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// Everything a teacher has marked Public, for anyone to browse — no login.
app.get('/api/public/lessons', (req, res) => {
  const store = readStore();
  let boards = [];
  try { boards = board.readBoardStore().boards || []; } catch (_) { boards = []; }
  const boardItems = boards.filter((b) => b.public).map((b) => ({
    type: 'whiteboard', id: b.id, title: b.title,
    subject: b.subject || '', grade: b.grade || '', topic: b.topic || '',
    creator: creatorName(store, b.teacherId), isLive: Boolean(b.isLive),
    createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
    rating: ratingSummary(b),
    openUrl: b.publicToken ? `/s/${b.publicToken}` : `/board/${b.id}`
  }));
  const setItems = store.quizlets.filter((s) => s.public).map((s) => ({
    type: 'lesson', id: s.id, title: s.title,
    subject: s.subject || s.category || '', grade: s.grade || '', topic: s.topic || '',
    creator: creatorName(store, s.ownerId), isLive: Boolean(s.isLive),
    format: s.format, cardCount: (s.cards || []).length,
    createdAt: s.createdAt, updatedAt: s.updatedAt || s.createdAt,
    rating: ratingSummary(s),
    openUrl: `/l/${s.id}`
  }));
  const items = [...boardItems, ...setItems]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 400);
  res.json({ items });
});

// A public study set, for the no-login study viewer at /l/:id.
app.get('/api/public/lesson/:id', (req, res) => {
  const store = readStore();
  // Resolve by share token first (unguessable, like the whiteboard link), then
  // fall back to a public set by id. A lesson opens if it's public, has been
  // shared (link/QR/email), or is live.
  const key = req.params.id;
  const s = store.quizlets.find((x) => (x.shareToken === key || (x.id === key && x.public)) && (x.public || x.shared || x.isLive));
  if (!s) return res.status(404).json({ error: 'This lesson is not available.' });
  res.json({
    set: { id: s.id, title: s.title, cards: s.cards || [], format: s.format,
      subject: s.subject || '', grade: s.grade || '', topic: s.topic || '',
      isLive: Boolean(s.isLive), creator: creatorName(store, s.ownerId), rating: ratingSummary(s) }
  });
});

// Ensure a lesson has an unguessable share token (for QR / link / email).
function ensureLessonToken(set) {
  if (!set.shareToken) set.shareToken = `les${Math.random().toString(16).slice(2, 12)}`;
  return set.shareToken;
}

// Get (or create) the share link for a lesson — owner only.
app.post(['/api/sets/:id/share-link', '/api/quizlets/:id/share-link'], requireUser, (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((s) => s.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Lesson not found.' });
  set.shared = true;
  ensureLessonToken(set);
  writeStore(store);
  res.json({ token: set.shareToken, url: `${APP_BASE_URL}/l/${set.shareToken}` });
});

// Email the lesson link (+ QR) to a class — owner only.
app.post(['/api/sets/:id/share-email', '/api/quizlets/:id/share-email'], requireUser, async (req, res) => {
  const store = readStore();
  const set = store.quizlets.find((s) => s.id === req.params.id);
  if (!set || set.ownerId !== req.user.id) return res.status(404).json({ error: 'Lesson not found.' });
  set.shared = true; ensureLessonToken(set); writeStore(store);

  const emails = String(req.body.emails || '').split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!emails.length) return res.status(400).json({ error: 'Add at least one valid email address.' });
  if (emails.length > 60) return res.status(400).json({ error: 'Please send to at most 60 addresses at a time.' });

  const url = `${APP_BASE_URL}/l/${set.shareToken}`;
  const qr = `${APP_BASE_URL}/qr?d=${encodeURIComponent(url)}`;
  const teacher = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'Your teacher';
  const note = String(req.body.note || '').slice(0, 500);
  const subject = `${teacher} shared a Boardsy lesson: ${set.title}`;
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = `${teacher} shared a lesson with you on Boardsy.\n\n${set.title}\nOpen it: ${url}\n\n${note}\n\nNo login needed — study it, and join live if the teacher goes live.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#0f1e35">
    <p><strong>${esc(teacher)}</strong> shared a lesson with you on Boardsy.</p>
    <p style="font-size:18px;margin:12px 0"><strong>${esc(set.title)}</strong></p>
    <p><a href="${url}" style="background:#2563ff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the lesson</a></p>
    <p style="margin:16px 0"><img src="${qr}" alt="QR code" width="160" height="160" style="border:1px solid #dce6f5;border-radius:10px" /><br><span style="color:#5a6b85;font-size:13px">Scan to open on a phone</span></p>
    ${note ? `<p style="white-space:pre-wrap">${esc(note)}</p>` : ''}</div>`;

  let sent = 0;
  for (const to of emails) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendMail({ to, subject, text, html }).catch(() => ({ sent: false }));
    if (r && r.sent) sent += 1;
  }
  res.json({ ok: true, url, sent, total: emails.length });
});

// Rate a public item 1–5. One rating per IP per item (re-rating updates it).
app.post('/api/public/rate', (req, res) => {
  const type = String(req.body.type || '');
  const stars = Math.max(1, Math.min(5, Math.round(Number(req.body.stars || 0))));
  if (!stars) return res.status(400).json({ error: 'Pick 1 to 5 stars.' });
  const h = ipHash(req);
  if (type === 'whiteboard') {
    let bstore; try { bstore = board.readBoardStore(); } catch (_) { return res.status(500).json({ error: 'Unavailable.' }); }
    const b = (bstore.boards || []).find((x) => x.id === req.body.id && x.public);
    if (!b) return res.status(404).json({ error: 'Not found.' });
    b.raters = b.raters || {}; b.raters[h] = stars;
    b.rating = { sum: Object.values(b.raters).reduce((n, v) => n + v, 0), count: Object.keys(b.raters).length };
    board.writeBoardStore(bstore);
    return res.json({ rating: ratingSummary(b) });
  }
  const store = readStore();
  const s = store.quizlets.find((x) => x.id === req.body.id && x.public);
  if (!s) return res.status(404).json({ error: 'Not found.' });
  s.raters = s.raters || {}; s.raters[h] = stars;
  s.rating = { sum: Object.values(s.raters).reduce((n, v) => n + v, 0), count: Object.keys(s.raters).length };
  writeStore(store);
  res.json({ rating: ratingSummary(s) });
});

// ---- Bookmarks (logged-in teachers) ----
app.post('/api/bookmarks/toggle', requireUser, (req, res) => {
  const type = String(req.body.type || '');
  const itemId = String(req.body.id || '');
  if (!['whiteboard', 'lesson'].includes(type) || !itemId) return res.status(400).json({ error: 'Bad request.' });
  const store = readStore();
  const user = store.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  user.bookmarks = user.bookmarks || [];
  const idx = user.bookmarks.findIndex((b) => b.type === type && b.id === itemId);
  let bookmarked;
  if (idx >= 0) { user.bookmarks.splice(idx, 1); bookmarked = false; }
  else { user.bookmarks.push({ type, id: itemId, at: nowIso() }); bookmarked = true; }
  writeStore(store);
  res.json({ bookmarked });
});

app.get('/api/bookmarks', requireUser, (req, res) => {
  const store = readStore();
  const user = store.users.find((u) => u.id === req.user.id);
  const marks = (user && user.bookmarks) || [];
  let boards = [];
  try { boards = board.readBoardStore().boards || []; } catch (_) { boards = []; }
  const items = marks.map((m) => {
    if (m.type === 'whiteboard') {
      const b = boards.find((x) => x.id === m.id);
      if (!b || !b.public) return null;
      return { type: 'whiteboard', id: b.id, title: b.title, subject: b.subject || '', grade: b.grade || '',
        topic: b.topic || '', public: true, rating: ratingSummary(b), owner: creatorName(store, b.teacherId),
        createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
        openUrl: b.publicToken ? `/s/${b.publicToken}` : `/board/${b.id}`, readOnly: true, bookmarked: true };
    }
    const s = store.quizlets.find((x) => x.id === m.id);
    if (!s || !s.public) return null;
    return { type: 'lesson', id: s.id, title: s.title, subject: s.subject || s.category || '', grade: s.grade || '',
      topic: s.topic || '', public: true, rating: ratingSummary(s), owner: creatorName(store, s.ownerId),
      format: s.format, cardCount: (s.cards || []).length, createdAt: s.createdAt, updatedAt: s.updatedAt || s.createdAt,
      openUrl: `/l/${s.id}`, readOnly: true, bookmarked: true };
  }).filter(Boolean);
  res.json({ items });
});

// ---- Learning: the public curriculum browser ------------------------------
// Grade (5–10) × Subject (math|science) -> every topic, grouped by strand.
// Public on purpose (acquisition + genuinely useful), no auth.
app.get('/api/learning/overview', async (req, res) => {
  try {
    res.json(await curriculum.getOverview(db));
  } catch (e) {
    console.error('learning overview failed:', e.message);
    res.status(500).json({ error: 'Could not load the curriculum.' });
  }
});

app.get('/api/learning/topics', async (req, res) => {
  try {
    const data = await curriculum.getTopics(db, req.query.grade, req.query.subject);
    if (!data.strands.length) {
      return res.status(404).json({ error: 'No topics for that grade and subject.', ...data });
    }
    res.json(data);
  } catch (e) {
    console.error('learning topics failed:', e.message);
    res.status(500).json({ error: 'Could not load topics.' });
  }
});

// One topic + its stored, ready-to-use lesson content (for Start Lesson).
// Content is pre-built and stored in the DB, so no AI call happens here.
app.get('/api/learning/topic-content', async (req, res) => {
  try {
    const t = await curriculum.getTopicContent(db, req.query.id);
    if (!t) return res.status(404).json({ error: 'Topic not found.' });
    res.json(t);
  } catch (e) {
    console.error('topic-content failed:', e.message);
    res.status(500).json({ error: 'Could not load topic content.' });
  }
});

// Which curriculum topics the signed-in teacher already has saved content for,
// grouped by format — powers the Slides / Flashcards / Quiz chips on each topic.
app.get('/api/learning/my-topic-content', requireUser, (req, res) => {
  try {
    const store = readStore();
    const byTopic = {};
    const fmtKey = (f) => (f === 'slides' ? 'slides' : f === 'quiz' ? 'quiz' : f === 'flashcard' ? 'flashcard' : 'mixed');
    (store.quizlets || []).forEach((s) => {
      if (s.ownerId !== req.user.id || !s.topicId) return;
      const bucket = (byTopic[s.topicId] ||= { slides: null, quiz: null, flashcard: null, mixed: null });
      const k = fmtKey(s.format);
      // Keep the most recent per format.
      if (!bucket[k] || String(s.updatedAt || '') > String(bucket[k].updatedAt || '')) {
        bucket[k] = { id: s.id, title: s.title, updatedAt: s.updatedAt || s.createdAt };
      }
    });
    res.json({ topics: byTopic });
  } catch (e) {
    console.error('my-topic-content failed:', e.message);
    res.status(500).json({ error: 'Could not load your topic content.' });
  }
});

// Draft teacher-ready paste-content for an ARBITRARY topic (the "New lesson"
// path, where the teacher can type any topic). This one uses AI. Falls back to
// the structured scaffold if no provider is configured or the call fails.
app.post('/api/lesson/draft-content', requireUser, async (req, res) => {
  const topic = String(req.body.topic || '').trim().slice(0, 200);
  const grade = String(req.body.grade || '').trim().slice(0, 40);
  const subject = String(req.body.subject || '').trim().slice(0, 40);
  if (!topic) return res.status(400).json({ error: 'A topic is required.' });
  const fallback = () => curriculum.scaffoldContent({ grade, subject, title: topic, strand: '', standard: '' });
  try {
    const prompt = `You are a veteran ${subject || 'K-12'} teacher preparing to make slides, a quiz, and flashcards for students. Write practical, accurate, grade-appropriate teacher content for this topic. Be specific (real definitions, real worked examples with numbers, real misconceptions) — not generic filler.

Topic: ${topic}${grade ? `\nGrade / level: ${grade}` : ''}${subject ? `\nSubject: ${subject}` : ''}

Return classroom-ready Markdown with: Lesson goal; Key ideas (bulleted, specific); Vocabulary (term — definition); Worked examples (2–3 with actual numbers/steps); Common misconceptions (with corrections); Quick checks (3–5 Q&A); Practice (4–6 problems). Keep it concise.`;
    let text = '';
    try { text = String(await callProviderRaw(prompt) || '').trim(); } catch (_) { text = ''; }
    if (text.length < 120) return res.json({ content: fallback(), source: 'scaffold' });
    res.json({ content: text, source: 'ai' });
  } catch (e) {
    res.json({ content: fallback(), source: 'scaffold' });
  }
});

// Admin: upgrade stored curriculum content from scaffold → AI-researched.
// Run once (or in batches) on the server that has an AI key configured.
//   POST /api/admin/curriculum/backfill { limit?, force? }
app.post('/api/admin/curriculum/backfill', requireUser, async (req, res) => {
  if (membership.role(req.user) !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  try {
    const out = await curriculum.backfillContent(db, callProviderRaw, {
      limit: Number(req.body.limit) || 25,
      force: Boolean(req.body.force)
    });
    res.json(out);
  } catch (e) {
    console.error('backfill failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Public pages (no auth).
app.get('/learning', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'learning.html')));
app.get('/live', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'live-webinars.html')));
app.get('/lessons', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'lessons.html')));
app.get('/l/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));

// ============================ SUPERADMIN =================================
// A superadmin (role 'admin') can manage users, licenses, and delete any
// content. Bootstrap the first one with SQL (see /admin page help), then use
// the admin UI to promote others.
function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  if (membership.role(user) !== 'admin') return res.status(403).json({ error: 'Superadmin only.' });
  req.user = user;
  next();
}

const ADMIN_PLANS = ['free', 'starter', 'team'];   // starter = "Pro", team = "Teams"
const ADMIN_ROLES = ['member', 'founder', 'admin']; // founder = "Founding teacher"

function adminUserRow(u, counts) {
  const eff = membership.effectivePlan(u);
  return {
    id: u.id,
    email: u.email,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
    role: membership.role(u),
    envPrivileged: membership.isPrivileged(u.email),   // set via .env, can't be changed here
    plan: u.plan || 'free',
    planLabel: PLAN_LIMITS[u.plan || 'free']?.label || 'Free',
    effectivePlan: eff,
    subscriptionStatus: u.subscriptionStatus || 'free',
    compEndsAt: u.compEndsAt || null,
    trial: isTrialActive(u) ? { plan: u.trialPlan, endsAt: u.trialEndsAt } : null,
    createdAt: u.createdAt || null,
    sets: counts ? counts.sets : undefined,
    boards: counts ? counts.boards : undefined
  };
}

// List / search users.
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const store = readStore();
  let users = store.users || [];
  if (q) {
    users = users.filter((u) =>
      String(u.email || '').toLowerCase().includes(q) ||
      String(u.firstName || '').toLowerCase().includes(q) ||
      String(u.lastName || '').toLowerCase().includes(q));
  }
  users = users.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 200);
  const boards = (() => { try { return require('./board').readBoardStore().boards || []; } catch (_) { return []; } })();
  const rows = users.map((u) => adminUserRow(u, {
    sets: (store.quizlets || []).filter((s) => s.ownerId === u.id).length,
    boards: boards.filter((b) => b.teacherId === u.id).length
  }));
  res.json({ users: rows, total: (store.users || []).length, plans: ADMIN_PLANS, roles: ADMIN_ROLES });
});

function findUserById(store, id) { return (store.users || []).find((u) => u.id === id); }

// Set a user's role: member | founder ("founding teacher") | admin (superadmin).
app.post('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const role = String(req.body.role || '').trim();
  if (!ADMIN_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const store = readStore();
  const u = findUserById(store, req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (membership.isPrivileged(u.email)) return res.status(400).json({ error: 'This user is set via .env and can\'t be changed here.' });
  if (u.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'You can\'t remove your own admin role.' });
  u.appRole = role === 'member' ? null : role;
  u.updatedAt = nowIso();
  writeStore(store);
  try { await membership.reconcile(u); } catch (_) {}
  res.json({ ok: true, user: adminUserRow(u) });
});

// Set a user's license/plan. months>0 grants a complimentary license that
// expires after that many months; months=0 (or free) is permanent until changed.
app.post('/api/admin/users/:id/plan', requireAdmin, async (req, res) => {
  const plan = String(req.body.plan || '').trim();
  const months = Math.max(0, Math.min(60, Number(req.body.months) || 0));
  if (!ADMIN_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });
  const store = readStore();
  const u = findUserById(store, req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (plan === 'free') {
    u.plan = 'free';
    u.subscriptionStatus = 'free';
    u.compEndsAt = null;
    u.compGrantedBy = null;
  } else {
    u.plan = plan;
    if (months > 0) {
      const end = new Date();
      end.setMonth(end.getMonth() + months);
      // Extend from an existing comp end date if it's further out.
      if (u.subscriptionStatus === 'comp' && u.compEndsAt && new Date(u.compEndsAt) > end) { /* keep longer */ }
      else u.compEndsAt = end.toISOString();
      u.subscriptionStatus = 'comp';
      u.compGrantedBy = req.user.email;
    } else {
      // Permanent complimentary access (no end date).
      u.subscriptionStatus = 'comp';
      u.compEndsAt = null;
      u.compGrantedBy = req.user.email;
    }
  }
  // Clear any active trial so it doesn't fight the granted plan.
  u.trialPlan = null; u.trialEndsAt = null; u.trialStartedAt = null;
  u.updatedAt = nowIso();
  writeStore(store);
  try { await membership.reconcile(u); } catch (_) {}
  res.json({ ok: true, user: adminUserRow(u) });
});

// Grant a 7-day trial of a paid plan (admin override — ignores trialsUsed).
app.post('/api/admin/users/:id/trial', requireAdmin, (req, res) => {
  const plan = String(req.body.plan || 'starter').trim();
  if (!TRIALABLE_PLANS.includes(plan)) return res.status(400).json({ error: 'Trials are for Pro or Teams.' });
  const store = readStore();
  const u = findUserById(store, req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const end = new Date(Date.now() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  u.trialPlan = plan;
  u.trialStartedAt = nowIso();
  u.trialEndsAt = end.toISOString();
  u.plan = plan;
  u.subscriptionStatus = 'trialing';
  u.trialsUsed = Array.from(new Set([...(u.trialsUsed || []), plan]));
  u.updatedAt = nowIso();
  writeStore(store);
  res.json({ ok: true, user: adminUserRow(u) });
});

// A user's content (sets + boards), for review/deletion.
app.get('/api/admin/content', requireAdmin, (req, res) => {
  const ownerId = String(req.query.ownerId || '').trim();
  const store = readStore();
  const boards = (() => { try { return require('./board').readBoardStore().boards || []; } catch (_) { return []; } })();
  const sets = (store.quizlets || [])
    .filter((s) => !ownerId || s.ownerId === ownerId)
    .map((s) => ({ id: s.id, title: s.title, format: s.format, ownerId: s.ownerId, ownerEmail: s.ownerEmail, topic: s.topic || '', updatedAt: s.updatedAt || s.createdAt }));
  const bds = boards
    .filter((b) => !ownerId || b.teacherId === ownerId)
    .map((b) => ({ id: b.id, title: b.title || b.name || 'Untitled board', ownerId: b.teacherId, updatedAt: b.updatedAt || b.createdAt }));
  res.json({ sets, boards: bds });
});

// Delete ANY study set (lesson / slides / flashcards / quiz).
app.delete('/api/admin/set/:id', requireAdmin, (req, res) => {
  const store = readStore();
  const before = (store.quizlets || []).length;
  store.quizlets = (store.quizlets || []).filter((s) => s.id !== req.params.id);
  if (store.quizlets.length === before) return res.status(404).json({ error: 'Set not found.' });
  writeStore(store);
  res.json({ ok: true });
});

// Delete ANY whiteboard.
app.delete('/api/admin/board/:id', requireAdmin, (req, res) => {
  try {
    const bmod = require('./board');
    const bstore = bmod.readBoardStore();
    const before = (bstore.boards || []).length;
    bstore.boards = (bstore.boards || []).filter((b) => b.id !== req.params.id);
    if (bstore.boards.length === before) return res.status(404).json({ error: 'Board not found.' });
    bmod.writeBoardStore(bstore);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin page (gated).
app.get('/admin', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || membership.role(user) !== 'admin') return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Optional LiveKit audio for live sessions (teacher broadcast + granted mics).
// No-ops gracefully unless LIVEKIT_* env is set. Publishing is Teams-gated.
const { attachLiveAudioRoutes } = require('./live-audio');
attachLiveAudioRoutes(app, {
  requireUserOptional: (req) => getCurrentUser(req),
  readStore,
  boardStore: () => require('./board').readBoardStore(),
  membership
});
// ============================================================================


app.post('/api/billing/checkout', requireUser, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe is not configured yet.' });
  const plan = String(req.body.plan || '').toLowerCase();
  const priceByPlan = {
    starter: process.env.STRIPE_PRICE_STARTER,
    team: process.env.STRIPE_PRICE_TEAM
  };
  const price = priceByPlan[plan];
  if (!price || !PLAN_LIMITS[plan]) return res.status(400).json({ error: 'Invalid or unconfigured plan.' });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: req.user.email,
    line_items: [{ price, quantity: 1 }],
    success_url: `${APP_BASE_URL}/app?billing=success`,
    cancel_url: `${APP_BASE_URL}/app?billing=cancelled`,
    metadata: { userId: req.user.id, plan },
    subscription_data: { metadata: { userId: req.user.id, plan } },
    allow_promotion_codes: true
  });
  res.json({ url: session.url });
});

// Start a free 7-day trial of Starter or Team, no card required. One trial
// per plan per account, enforced via user.trialsUsed. If the user is already
// mid-trial (of either plan) or already paying, this is rejected rather than
// silently extended/replaced.
app.post('/api/billing/trial', requireUser, (req, res) => {
  const plan = String(req.body.plan || '').toLowerCase();
  if (!TRIALABLE_PLANS.includes(plan)) return res.status(400).json({ error: 'That plan is not eligible for a free trial.' });

  const store = readStore();
  const user = store.users.find((candidate) => candidate.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  if (isTrialActive(user)) return res.status(400).json({ error: `You already have an active ${PLAN_LIMITS[user.trialPlan]?.label || user.trialPlan} trial.` });
  if (user.subscriptionStatus === 'active') return res.status(400).json({ error: 'You already have an active paid plan.' });
  if ((user.trialsUsed || []).includes(plan)) return res.status(400).json({ error: `You've already used your free trial of the ${PLAN_LIMITS[plan].label} plan.` });

  const startedAt = nowIso();
  const endsAt = new Date(Date.now() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  user.plan = plan;
  user.subscriptionStatus = 'trialing';
  user.trialPlan = plan;
  user.trialStartedAt = startedAt;
  user.trialEndsAt = endsAt;
  user.trialsUsed = Array.from(new Set([...(user.trialsUsed || []), plan]));
  user.updatedAt = nowIso();
  writeStore(store);

  res.json({ user: publicUser(user) });
});

function requirePageUser(req, res, next) {
  if (!getCurrentUser(req)) return res.redirect('/?login=1');
  next();
}

// ---- Membership, referrals, founder applications, admin rewards ----------

// Apply to the Founding-30 program. Requires being signed in (so we have a
// real account to attach). Persists the application and emails the admin.
app.post('/api/founder/apply', requireUser, async (req, res) => {
  const user = req.user;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || String(req.body.name || '').trim();
  try {
    await db.query(
      `INSERT INTO founder_applications (name, email, user_id, notified) VALUES ($1, $2, $3, false)`,
      [name, user.email, user.id]);
    const r = await notifyFounderApplication({ name, email: user.email });
    if (r && r.sent) {
      await db.query(`UPDATE founder_applications SET notified = true WHERE user_id = $1`, [user.id]).catch(() => {});
    }
    res.json({ ok: true, emailed: Boolean(r && r.sent) });
  } catch (e) {
    console.error('founder apply failed:', e.message);
    res.status(500).json({ error: 'Could not submit your application. Please try again.' });
  }
});

// The signed-in user's membership + referral status (drives the pricing page).
app.get('/api/membership', requireUser, async (req, res) => {
  const user = req.user;
  try {
    const summary = await membership.referralSummary(user);
    const seatInfo = (() => {
      // For team plans, report seats used out of the cap.
      if (membership.effectivePlan(user) !== 'team') return null;
      const store = readStore();
      const roster = (store.users.find((u) => u.id === user.id)?.teamRoster) || [];
      return { used: roster.length, cap: PLAN_LIMITS.team.shareSeats };
    })();
    res.json({
      role: membership.role(user),
      isAdmin: membership.isAdmin(user),
      isFounder: membership.isFounder(user),
      plan: user.plan || 'free',
      effectivePlan: membership.effectivePlan(user),
      limits: membership.effectiveLimits(user),
      seats: seatInfo,
      referrals: summary,
      // Founders see the $25 promo; everyone sees the free-month referral.
      promos: {
        freeMonthReferral: true,
        founderGiftCard: membership.isFounder(user)
      }
    });
  } catch (e) {
    console.error('membership fetch failed:', e.message);
    res.status(500).json({ error: 'Could not load membership.' });
  }
});

// Send a referral invite. Records the referral and emails the invitee.
app.post('/api/referral/invite', requireUser, async (req, res) => {
  const user = req.user;
  const toEmail = normalizeEmail(req.body.email);
  if (!toEmail || !toEmail.includes('@')) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    await membership.recordReferral(user, toEmail);
    const fromName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    const link = `${APP_BASE_URL}/?login=0&ref=${encodeURIComponent(user.email)}`;
    const r = await sendReferralInvite({ fromName, toEmail, link });
    res.json({ ok: true, emailed: Boolean(r && r.sent) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send the invite.' });
  }
});

// Admin-only: pending gift-card rewards to fulfil.
app.get('/api/admin/rewards', requireUser, async (req, res) => {
  if (!membership.isAdmin(req.user)) return res.status(403).json({ error: 'Admins only.' });
  try {
    const pending = await membership.pendingRewards();
    res.json({ pending });
  } catch (e) {
    res.status(500).json({ error: 'Could not load rewards.' });
  }
});

// Admin-only: mark a reward resolved once the gift card has been sent.
app.post('/api/admin/rewards/:id/resolve', requireUser, async (req, res) => {
  if (!membership.isAdmin(req.user)) return res.status(403).json({ error: 'Admins only.' });
  try {
    await db.query(`UPDATE reward_events SET resolved = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update the reward.' });
  }
});

app.get('/app', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});

app.get('/library', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'library.html'));
});

app.get('/webinars', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'webinars.html'));
});

// In-app pricing / account page (distinct from the marketing #pricing anchor).
app.get('/pricing', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pricing.html'));
});

// ---- Team roster (Teams plan) --------------------------------------------
const { attachTeamRoutes } = require('./team');

attachTeamRoutes(app, {
  requireUser,
  readStore,
  writeStore,
  id,
  nowIso,
  normalizeEmail,
  hashPassword,
  createSession,
  publicUser,
  PLAN_LIMITS,
  effectiveLimits: (user) => membership.effectiveLimits(user),
  sendMail,
  APP_BASE_URL
});

// Public join-link landing page (no session required to view it — the page
// itself decides whether to log the person in or walk them through a quick
// one-field signup, based on what /api/team/join returns).
app.get('/join', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'join.html'));
});

// Team roster management page. (attachTeamRoutes above only mounts the
// /api/team/* API endpoints — this is the actual page route that was
// missing, which is why /team was falling through to the catch-all and
// serving the homepage instead.)
app.get('/team', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'team.html'));
});

// ---- Notes: scan/upload -> notes -> quiz -> tracking (v2.3) ---------------
const { attachNotesRoutes } = require('./notes');

attachNotesRoutes(app, {
  requireUser,
  readStore,
  writeStore,
  id,
  nowIso,
  upload,
  askVisionAI: ({ instructions, imageDataUrl }) => askVisionAI({ instructions, imageDataUrl }),
  callProviderRaw,
  extractUploadText,
  canCreateSet,
  compactText
});

app.get('/notes', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'notes.html'));
});

// ---- Whiteboard (Phase 1+) ------------------------------------------------
// Registered before the catch-all below so /board/:boardId and /boards
// resolve to their pages rather than falling through to index.html.
const { attachBoardRoutes, attachBoardWebSocket, getOrCreateCurrentBoardId } = require('./board');

attachBoardRoutes(app, {
  requireUser,
  publicUser,
  readStore,
  writeStore,
  id,
  nowIso,
  emailOnRoster,
  canViewTeachersContent,
  userHasWhiteboardAccess,
  userHasLiveAccess,
  boardLimitFor: (user) => membership.effectiveLimits(user).maxBoards || 1,
  notifyTeamOfShare,
  APP_BASE_URL,
  askVisionAI: ({ instructions, imageDataUrl }) => askVisionAI({ instructions, imageDataUrl }),
  generateWithProvider,
  saveGeneratedSet,
  canCreateSet,
  sendShareEmail: ({ to, subject, text, html }) => sendMail({ to, subject, text, html }),
  onContentCreated: (user) => { membership.onReferredContentCreated(user).catch(() => {}); }
});

// Board picker: teachers see their saved boards + New/Go Live controls;
// everyone else sees which of their teachers currently have a live, shared
// board they can join. One page, branches client-side on plan/role.
// The old Whiteboard list page is retired — the unified Library replaces it.
app.get('/boards', (req, res) => res.redirect('/library'));

// The "open my current board" entry — lands the teacher on their most recent
// board (creating one if needed). Falls back to the Library if they have no
// whiteboard access.
app.get('/board', requirePageUser, (req, res) => {
  const user = getCurrentUser(req);
  if (!userHasWhiteboardAccess(user)) return res.redirect('/library');
  const currentId = getOrCreateCurrentBoardId(user.id);
  return res.redirect(`/board/${currentId}`);
});

app.get('/board/:boardId', requirePageUser, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'board.html'));
});

// Chalkie-style SEO concept pages. One clean URL per concept teachers search
// for (e.g. /interactive-newtons-laws-simulation). Slugs come from the build
// step (scripts/build-lesson-pages.js -> public/lessons/slugs.json), so the
// single source of truth is that script — add a page there, rebuild, done.
// These are public (no auth) on purpose: they're acquisition landing pages.
let LESSON_SLUGS = [];
try {
  LESSON_SLUGS = require(path.join(PUBLIC_DIR, 'lessons', 'slugs.json'));
} catch (_) {
  LESSON_SLUGS = [];
}
for (const slug of LESSON_SLUGS) {
  app.get(`/${slug}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'lessons', `${slug}.html`));
  });
}

// SEO plumbing for the acquisition pages. Generated rather than committed so
// the slug list and the domain can never drift out of sync. App pages
// (/app, /board, /library, ...) are behind auth and already carry noindex.
function siteBase(req) {
  const configured = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/robots.txt', (req, res) => {
  const base = siteBase(req);
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /app',
      'Disallow: /board',
      'Disallow: /boards',
      'Disallow: /library',
      'Disallow: /notes',
      'Disallow: /team',
      'Disallow: /join',
      'Disallow: /api/',
      '',
      `Sitemap: ${base}/sitemap.xml`,
      ''
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['', '/learning', '/lessons', ...LESSON_SLUGS.map((s) => `/${s}`)];
  const body = urls
    .map((u) => {
      // The homepage is the priority entry; concept pages sit just below it.
      const priority = u === '' ? '1.0' : '0.8';
      return `  <url>\n    <loc>${base}${u || '/'}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join('\n');
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// A plain http.Server wraps the Express app so the whiteboard's WebSocket
// endpoint (/ws/board) can share the same port via an HTTP upgrade, rather
// than needing a second port/process.
const http = require('http');
const httpServer = http.createServer(app);

const boardWss = attachBoardWebSocket(httpServer, {
  getUserFromCookieHeader,
  readStore,
  writeStore,
  emailOnRoster,
  canViewTeachersContent,
  userHasWhiteboardAccess,
  askVisionAI: ({ instructions, imageDataUrl }) => askVisionAI({ instructions, imageDataUrl })
});

// Live LESSON sessions (synced slides/quiz/flashcards, quiz aggregates,
// questions, reactions) — students may be anonymous when the lesson is public.
const { attachLessonWebSocket } = require('./lesson-live');
const lessonWss = attachLessonWebSocket(httpServer, { getUserFromCookieHeader, readStore, writeStore, emailOnRoster, nowIso });

// Single upgrade router. Both WebSocketServers run in noServer mode, so exactly
// one 'upgrade' listener lives on the HTTP server and dispatches by path. This
// replaces the old per-server { server, path } wiring where each server added
// its own listener and destroyed the other's freshly-upgraded sockets — the
// cause of the persistent "Reconnecting…" badge. Unknown paths are closed so
// stray upgrade requests don't leak sockets.
httpServer.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { socket.destroy(); return; }

  const target = pathname === '/ws/board' ? boardWss
    : pathname === '/ws/lesson' ? lessonWss
      : null;
  if (!target) { socket.destroy(); return; }

  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

// Boot: initialize Postgres (create schema + warm the in-memory snapshot)
// BEFORE we start accepting requests, so the first request sees real data.
db.init()
  .then(() => curriculum.ensureAndSeed(db))
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Boardsy running on ${PORT} (Postgres-backed)`);
    });
  })
  .catch((err) => {
    console.error('FATAL: could not initialize the database:', err.message);
    console.error('Check DATABASE_URL in .env and that Postgres is reachable.');
    process.exit(1);
  });

// Flush pending writes on shutdown so nothing in flight is lost.
function gracefulExit() {
  db.drain().finally(() => process.exit(0));
}
process.on('SIGTERM', gracefulExit);
process.on('SIGINT', gracefulExit);
