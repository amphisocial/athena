'use strict';

/**
 * AthenaBot orchestration backend.
 *
 * This is the layer that sits between the voice platform (Retell / Vapi / Twilio)
 * and the clinic's systems. The voice agent calls these endpoints mid-conversation
 * as "functions" / "tools": check availability, book, run triage, escalate, etc.
 *
 * It also serves the public marketing + live-demo site (../public).
 *
 * No PHI is stored here. Synthetic data only in this starter.
 */

const path = require('path');
const express = require('express');

const triage = require('./triage');
const scheduling = require('./integrations/scheduling');
const ehr = require('./integrations/ehr');

const app = express();
app.use(express.json({ limit: '256kb' }));

// --- Tiny request log (no PHI) ---
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// --- Optional shared-secret guard for the voice webhooks ---
// Set WEBHOOK_SECRET in the environment and have the voice platform send it as
// the x-athenabot-secret header. Left open in the demo so the on-page demo works.
function guard(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next();
  if (req.get('x-athenabot-secret') === secret) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// --- Health / status ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'athenabot-orchestrator', time: new Date().toISOString() });
});

// --- Triage: the core decision the voice agent asks for ---
app.post('/api/run-triage', guard, (req, res) => {
  const intake = (req.body && (req.body.intake || req.body.text || req.body.summary)) || '';
  try {
    const decision = triage.evaluate(intake);
    res.json(decision);
  } catch (err) {
    res.status(500).json({ error: 'triage_failed', detail: err.message });
  }
});

// --- Scheduling ---
app.get('/api/availability', guard, async (req, res) => {
  try {
    const days = Number(req.query.days) || 3;
    res.json(await scheduling.getAvailability({ days }));
  } catch (err) {
    res.status(500).json({ error: 'availability_failed', detail: err.message });
  }
});

app.post('/api/book-appointment', guard, async (req, res) => {
  try {
    res.json(await scheduling.bookAppointment(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: 'booking_failed', detail: err.message });
  }
});

app.post('/api/cancel-appointment', guard, async (req, res) => {
  try {
    res.json(await scheduling.cancelAppointment(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: 'cancel_failed', detail: err.message });
  }
});

// --- Patient lookup (synthetic) ---
app.post('/api/lookup-patient', guard, async (req, res) => {
  try {
    res.json(await ehr.lookupPatientByPhone(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: 'lookup_failed', detail: err.message });
  }
});

// --- Escalation: hand the call to a human with context ---
app.post('/api/escalate', guard, async (req, res) => {
  const { reason, summary, outcome } = req.body || {};
  // In production: trigger a warm transfer, page the on-call queue, or open a ticket.
  console.log(`ESCALATION requested -> outcome=${outcome || 'n/a'} reason=${reason || 'n/a'}`);
  res.json({
    escalated: true,
    queue: outcome === 'EMERGENCY' ? 'priority' : 'standard',
    ticketId: `esc_${Date.now().toString(36)}`,
    note: 'Demo escalation. Wire to your transfer/paging/ticketing system in production.'
  });
});

// --- Serve the product site ---
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`AthenaBot orchestrator listening on :${PORT}`);
});
