'use strict';

/**
 * EHR/EMR adapter (illustrative / mock).
 *
 * Shaped around FHIR R4 resources so it maps cleanly onto real systems
 * (Epic, Cerner/Oracle Health, athenahealth, or the public HAPI FHIR sandbox at
 * https://hapi.fhir.org/baseR4). In production, set EHR_FHIR_BASE_URL and
 * EHR_FHIR_TOKEN and replace the mock with real FHIR queries.
 *
 * PHI NOTE: This adapter is the boundary where Protected Health Information enters
 * your layer. In production it must run on HIPAA-eligible infrastructure under a
 * signed BAA, return only the minimum necessary fields, and never write PHI into
 * prompts, logs, or non-BAA-covered downstream tools.
 */

// Minimal synthetic directory — NO real PHI.
const SYNTHETIC_PATIENTS = [
  { ref: 'Patient/demo-001', phone: '+15555550101', given: 'Jordan', family: 'Avery', dob: '1986-04-12' },
  { ref: 'Patient/demo-002', phone: '+15555550102', given: 'Sam', family: 'Rivera', dob: '1972-11-03' }
];

/** Look up a patient by phone number (mock FHIR search by telecom). */
async function lookupPatientByPhone({ phone }) {
  const base = process.env.EHR_FHIR_BASE_URL;
  if (base) {
    // Production path (left as an exercise; requires a BAA-covered endpoint + token):
    // const res = await fetch(`${base}/Patient?telecom=${encodeURIComponent(phone)}`, {
    //   headers: { Authorization: `Bearer ${process.env.EHR_FHIR_TOKEN}` }
    // });
    // return summarize(await res.json());
  }
  const found = SYNTHETIC_PATIENTS.find((p) => p.phone === phone);
  if (!found) return { found: false, source: 'synthetic' };
  return {
    found: true,
    source: 'synthetic',
    patient: { ref: found.ref, name: `${found.given} ${found.family}`, dob: found.dob }
  };
}

/** Create a lightweight intake record (mock). */
async function recordIntake({ patientRef, summary, outcome }) {
  return {
    written: true,
    recordId: `intake_${Date.now().toString(36)}`,
    patientRef: patientRef || 'unknown',
    outcome: outcome || 'unspecified',
    summaryLength: (summary || '').length
  };
}

module.exports = { lookupPatientByPhone, recordIntake };
