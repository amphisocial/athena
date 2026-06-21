'use strict';

/**
 * AthenaBot triage engine.
 *
 * Loads a config-driven decision tree and evaluates caller intake text against it.
 * Design principles:
 *   - Safety-critical rules (e.g. self-harm) always win, regardless of order.
 *   - Highest-severity match wins among the rest.
 *   - On no confident match, default to a HUMAN, never to "schedule".
 *
 * This is an illustrative scaffold. The rules MUST be reviewed and approved by a
 * licensed clinician before any production use. See server/config/triage-rules.json.
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, 'config', 'triage-rules.json');

function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  return JSON.parse(raw);
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

/**
 * Evaluate a free-text intake description and return a routing decision.
 * @param {string} intakeText  What the caller said / the collected intake summary.
 * @returns {object} decision
 */
function evaluate(intakeText) {
  const config = loadRules();
  const text = normalize(intakeText);
  const matched = [];

  for (const rule of config.rules) {
    const hits = (rule.matchAny || []).filter((kw) => text.includes(normalize(kw)));
    if (hits.length > 0) {
      const outcome = config.outcomes[rule.outcome];
      matched.push({
        ruleId: rule.id,
        outcome: rule.outcome,
        severity: outcome ? outcome.severity : 0,
        safetyCritical: Boolean(rule.safetyCritical),
        rationale: rule.rationale,
        matchedTerms: hits
      });
    }
  }

  let chosen;
  if (matched.length === 0) {
    chosen = {
      ruleId: 'default',
      outcome: config.default.outcome,
      severity: config.outcomes[config.default.outcome].severity,
      safetyCritical: false,
      rationale: config.default.rationale,
      matchedTerms: []
    };
  } else {
    // Safety-critical first, then highest severity.
    matched.sort((a, b) => {
      if (a.safetyCritical !== b.safetyCritical) return a.safetyCritical ? -1 : 1;
      return b.severity - a.severity;
    });
    chosen = matched[0];
  }

  const outcomeMeta = config.outcomes[chosen.outcome];

  return {
    outcome: chosen.outcome,
    label: outcomeMeta.label,
    action: outcomeMeta.action,
    color: outcomeMeta.color,
    severity: outcomeMeta.severity,
    rationale: chosen.rationale,
    matchedTerms: chosen.matchedTerms,
    triggeredRule: chosen.ruleId,
    allMatches: matched,
    meta: {
      version: config.version,
      reviewRequired: config.reviewRequired,
      reviewedBy: config.reviewedBy,
      disclaimer: config.disclaimer
    }
  };
}

module.exports = { evaluate, loadRules };
