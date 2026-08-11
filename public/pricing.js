/*
 * pricing.js — the in-app account/plan page. Reads /api/membership and renders
 * the user's status, feature access, upgrade path, referral tools, and (for
 * founders/admins) the promo and reward-fulfilment views.
 */
(async () => {
  const C = window.AppCommon;
  const { $, escapeHtml, api, initCommon, checkout, startTrial, setStatus, state } = C;

  await initCommon();
  if (!state.user) { window.location.href = '/?login=1'; return; }

  // Confirmation after applying to the Founding 30 from the homepage.
  if (new URLSearchParams(location.search).get('founding') === 'applied') {
    const banner = document.createElement('div');
    banner.className = 'founding-applied-banner';
    banner.textContent = 'Thanks for applying to the Founding 30 — we\'ve received your application and will be in touch to set up your onboarding.';
    document.querySelector('.pricing-page').prepend(banner);
  }

  const PLAN_NAMES = { free: 'Free', starter: 'Pro', team: 'Teams' };

  // Feature matrix: label -> which effective plans include it.
  const FEATURES = [
    { label: 'AI study sets per day', value: (m) => String(m.limits.setsPerDay) },
    { label: 'Flashcards, quizzes & notes', plans: ['free', 'starter', 'team'] },
    { label: 'Scan a page → notes + quiz', plans: ['free', 'starter', 'team'] },
    { label: 'Create & share boards (link + QR)', plans: ['starter', 'team'] },
    { label: '3D science & physics sims', plans: ['starter', 'team'] },
    { label: 'Live classroom (students join live)', plans: ['team'] },
    { label: 'Real-time collaboration & questions', plans: ['team'] }
  ];

  let membership = null;
  try {
    membership = await api('/api/membership');
  } catch (e) {
    $('#statusCard').innerHTML = `<div class="status-loading">Couldn't load your plan. Please refresh.</div>`;
    return;
  }

  renderStatus(membership);
  renderPlanPicker(membership);
  renderFeatures(membership);
  renderUpgrade(membership);
  renderReferrals(membership);
  renderPromo(membership);
  if (membership.isAdmin) renderAdmin();

  // Plan picker: for free & Pro users, offer a card-free 7-day trial, paid
  // subscribe, and an application to the Founding 30. Founders/admins already
  // have everything, so they don't see it.
  function renderPlanPicker(m) {
    const sec = $('#planPicker');
    if (!sec) return;
    if (m.isAdmin || m.isFounder) { sec.style.display = 'none'; return; }

    const eff = m.effectivePlan;
    const trial = m.trial || {};
    const avail = trial.availableTrials || [];
    const trialActive = Boolean(trial.active);

    const planCard = (plan, name, price, blurb) => {
      if (eff === plan) return '';                 // already have this plan
      const canTrial = avail.includes(plan);
      return `
        <div class="plan-card">
          <div class="plan-head"><h3>${name}</h3><span class="plan-price">$${price}<small>/mo</small></span></div>
          <p>${blurb}</p>
          <div class="plan-actions">
            ${canTrial ? `<button class="btn primary pp-trial" data-plan="${plan}">Start 7-day free trial</button>` : ''}
            <button class="btn ${canTrial ? 'soft' : 'primary'} pp-checkout" data-plan="${plan}">Subscribe $${price}/mo</button>
          </div>
          ${(!canTrial && !trialActive) ? '<p class="plan-note">Your free trial of this plan was already used.</p>' : ''}
        </div>`;
    };

    const pro = planCard('starter', 'Pro', '3.99',
      'Create boards and share a static link (with QR) to your class. Flashcards, quizzes, slides and PDF export. Students never need to pay.');
    const team = planCard('team', 'Teams', '9.99',
      'Everything in Pro, plus the live AI whiteboard, 3D science & physics sims, live classroom where students join and ask questions, and real-time collaboration.');

    const founding = `
      <div class="plan-card founding">
        <div class="plan-head"><h3>Founding 30</h3><span class="plan-price plan-free">Free</span></div>
        <p>We're onboarding 30 founding teachers with full access, no charge, in exchange for feedback. Apply to claim a spot.</p>
        <div class="plan-actions"><button class="btn primary" id="applyFoundingBtn">Apply as a founding teacher</button></div>
        <div class="form-status" id="foundingApplyStatus"></div>
      </div>`;

    const cards = [pro, team, founding].filter(Boolean).join('');
    if (!pro && !team) {
      // On Teams already — just offer founding.
      sec.innerHTML = `<h2>Founding teachers</h2><div class="plan-grid">${founding}</div>`;
    } else {
      sec.innerHTML = `<h2>Choose a plan</h2>
        <p class="plan-lead">Try any paid plan free for 7 days — no card needed. Students you share with never pay.</p>
        <div class="plan-grid">${cards}</div>`;
    }
    sec.style.display = '';

    // These are rendered after initCommon, so wire them here.
    sec.querySelectorAll('.pp-trial').forEach((b) => b.addEventListener('click', () => startTrial(b.dataset.plan)));
    sec.querySelectorAll('.pp-checkout').forEach((b) => b.addEventListener('click', () => checkout(b.dataset.plan)));
    const fb = $('#applyFoundingBtn');
    if (fb) fb.addEventListener('click', async () => {
      fb.disabled = true; const label = fb.textContent; fb.textContent = 'Applying…';
      const st = $('#foundingApplyStatus');
      try {
        await api('/api/founder/apply', { method: 'POST', body: JSON.stringify({}) });
        st.className = 'form-status ok';
        st.textContent = "You're in the queue — we'll email you shortly to set up your onboarding.";
        fb.textContent = 'Applied ✓';
      } catch (e) {
        st.className = 'form-status err'; st.textContent = e.message;
        fb.disabled = false; fb.textContent = label;
      }
    });
  }

  function renderStatus(m) {
    const roleLabel = m.isAdmin ? 'Admin' : m.isFounder ? 'Founding Teacher' : PLAN_NAMES[m.effectivePlan] || 'Free';
    const roleClass = m.isAdmin ? 'admin' : m.isFounder ? 'founder' : m.effectivePlan;
    let sub = '';
    if (m.isAdmin) sub = 'Full access to every feature.';
    else if (m.isFounder) sub = 'Full access as a founding teacher — no subscription needed.';
    else if (m.effectivePlan === 'team') sub = 'You have the full Teams plan.';
    else if (m.effectivePlan === 'starter') sub = 'You have Pro. Upgrade to Teams for the whiteboard.';
    else sub = 'You are on the Free plan.';

    let seats = '';
    if (m.seats) {
      seats = `<div class="seat-meter">
        <span>Team seats</span>
        <strong>${m.seats.used} / ${m.seats.cap}</strong>
      </div>`;
    }

    $('#statusCard').innerHTML = `
      <div class="status-head">
        <span class="plan-pill ${roleClass}">${escapeHtml(roleLabel)}</span>
        <p>${escapeHtml(sub)}</p>
      </div>
      ${seats}
    `;
  }

  function renderFeatures(m) {
    const eff = m.effectivePlan;
    const rows = FEATURES.map((f) => {
      let cell;
      if (f.value) cell = `<span class="feat-val">${escapeHtml(f.value(m))}</span>`;
      else {
        const has = f.plans.includes(eff);
        cell = has ? `<span class="feat-yes">✓ Included</span>` : `<span class="feat-no">— Not on your plan</span>`;
      }
      return `<div class="feat-row"><span>${escapeHtml(f.label)}</span>${cell}</div>`;
    }).join('');
    $('#featureMatrix').innerHTML = rows;
  }

  function renderUpgrade(m) {
    // Superseded by the plan picker above (which offers trial + subscribe for
    // Pro and Teams). Keep the section hidden so there's a single CTA surface.
    const el = $('#upgradeSection');
    if (el) el.style.display = 'none';
    if (true) return;
    // eslint-disable-next-line no-unreachable
    const show = m.effectivePlan === 'starter' && !m.isFounder && !m.isAdmin;
    $('#upgradeSection').style.display = show ? '' : 'none';
    if (show) {
      $('#upgradeTeamsBtn').addEventListener('click', () => checkout('team'));
    }
  }

  function renderReferrals(m) {
    const stats = m.referrals || { invited: 0, qualified: 0, referrals: [] };
    $('#referralStats').innerHTML = `
      <div class="rstat"><strong>${stats.invited}</strong><span>invited</span></div>
      <div class="rstat"><strong>${stats.qualified}</strong><span>qualified</span></div>
      <div class="rstat"><strong>${(m.referrals.rewards || []).filter(r => r.kind==='free_month').length}</strong><span>free months earned</span></div>
    `;
    $('#referralSendBtn').addEventListener('click', sendReferral);
    $('#referralEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReferral(); });
  }

  async function sendReferral() {
    const email = $('#referralEmail').value.trim();
    const statusEl = $('#referralStatus');
    if (!email || !email.includes('@')) { statusEl.textContent = 'Enter a valid email.'; statusEl.className = 'referral-status err'; return; }
    $('#referralSendBtn').disabled = true;
    try {
      const r = await api('/api/referral/invite', { method: 'POST', body: JSON.stringify({ email }) });
      statusEl.textContent = r.emailed
        ? `Invite sent to ${email}.`
        : `Invite recorded for ${email} (email delivery is off — share your link manually).`;
      statusEl.className = 'referral-status ok';
      $('#referralEmail').value = '';
      // Refresh stats.
      try { const m2 = await api('/api/membership'); renderReferrals(m2); } catch (_) {}
    } catch (e) {
      statusEl.textContent = e.message || 'Could not send the invite.';
      statusEl.className = 'referral-status err';
    } finally {
      $('#referralSendBtn').disabled = false;
    }
  }

  function renderPromo(m) {
    if (m.isFounder) {
      $('#promoSection').style.display = '';
      $('#referralBlurb').textContent =
        'Invite another teacher. When they sign up and create their first board or study set, you get a free month — and as a founding teacher, referring a paid or founding member also earns you a $25 Amazon gift card.';
    }
  }

  async function renderAdmin() {
    $('#adminSection').style.display = '';
    const box = $('#adminRewards');
    try {
      const { pending } = await api('/api/admin/rewards');
      if (!pending.length) { box.innerHTML = `<p class="admin-empty">No pending gift-card rewards.</p>`; return; }
      box.innerHTML = pending.map((r) => {
        const detail = r.detail || {};
        return `<div class="admin-reward" data-id="${r.id}">
          <div>
            <strong>${escapeHtml(r.beneficiary_email)}</strong>
            <span>referred ${escapeHtml(detail.referredEmail || '')}</span>
            <span class="admin-date">${new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <button class="btn soft small resolve-btn" data-id="${r.id}">Mark sent</button>
        </div>`;
      }).join('');
      box.querySelectorAll('.resolve-btn').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api(`/api/admin/rewards/${b.dataset.id}/resolve`, { method: 'POST' });
          b.closest('.admin-reward').remove();
          if (!box.querySelector('.admin-reward')) box.innerHTML = `<p class="admin-empty">No pending gift-card rewards.</p>`;
        } catch (_) { b.disabled = false; }
      }));
    } catch (e) {
      box.innerHTML = `<p class="admin-empty">Couldn't load rewards.</p>`;
    }
  }
})();
