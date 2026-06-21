'use strict';

/**
 * Scheduling adapter (illustrative / mock).
 *
 * Shaped to mirror a real calendar provider (e.g. Cal.com, a practice management
 * system, or an EHR scheduling API). Swap the body of each function for live API
 * calls in production; the orchestration layer and voice agent never change.
 *
 * In production, set SCHEDULING_PROVIDER + SCHEDULING_API_KEY in the environment
 * and replace the mock data below with fetch() calls to the provider.
 */

function pad(n) { return String(n).padStart(2, '0'); }

/** Return the next available slots (mock: next 5 business-hour slots from now). */
async function getAvailability({ days = 3 } = {}) {
  const slots = [];
  const now = new Date();
  let cursor = new Date(now.getTime() + 60 * 60 * 1000); // start 1h out
  while (slots.length < 6) {
    const hour = cursor.getHours();
    const day = cursor.getDay();
    const businessHours = hour >= 9 && hour < 17;
    const weekday = day >= 1 && day <= 5;
    if (businessHours && weekday) {
      slots.push({
        id: `slot_${cursor.getTime()}`,
        start: cursor.toISOString(),
        display: `${cursor.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${pad(((hour + 11) % 12) + 1)}:00 ${hour < 12 ? 'AM' : 'PM'}`
      });
      cursor = new Date(cursor.getTime() + 2 * 60 * 60 * 1000);
    } else {
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    }
    if ((cursor - now) / (1000 * 60 * 60 * 24) > days) break;
  }
  return { provider: process.env.SCHEDULING_PROVIDER || 'mock', slots };
}

/** Book a slot (mock: echoes a confirmation). */
async function bookAppointment({ slotId, patient, reason }) {
  if (!slotId) throw new Error('slotId is required');
  return {
    confirmed: true,
    confirmationId: `apt_${Date.now().toString(36)}`,
    slotId,
    patientRef: patient && patient.ref ? patient.ref : 'unknown',
    reason: reason || 'unspecified',
    provider: process.env.SCHEDULING_PROVIDER || 'mock'
  };
}

/** Cancel an existing appointment (mock). */
async function cancelAppointment({ confirmationId }) {
  if (!confirmationId) throw new Error('confirmationId is required');
  return { cancelled: true, confirmationId };
}

module.exports = { getAvailability, bookAppointment, cancelAppointment };
