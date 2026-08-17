/*
 * admin.js — the superadmin console.
 * User & license management + content deletion. The page itself is gated
 * server-side (/admin redirects non-admins), and every API here is requireAdmin.
 */
(() => {
  const C = window.AppCommon;
  const { $, escapeHtml, api } = C;

  const PLAN_LABEL = { free: 'Free', starter: 'Pro', team: 'Teams' };
  const ROLE_LABEL = { member: 'Member', founder: 'Founding teacher', admin: 'Superadmin' };
  let PLANS = ['free', 'starter', 'team'];
  let ROLES = ['member', 'founder', 'admin'];

  function toast(msg, isError) {
    const t = $('#admToast');
    t.textContent = msg; t.className = 'adm-toast show' + (isError ? ' error' : '');
    setTimeout(() => { t.className = 'adm-toast'; }, 2600);
  }

  function fmtDate(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString(); } catch (_) { return ''; } }

  function badges(u) {
    const b = [];
    if (u.role && u.role !== 'member') b.push(`<span class="adm-badge role-${u.role}">${ROLE_LABEL[u.role] || u.role}</span>`);
    b.push(`<span class="adm-badge plan-${u.effectivePlan}">${PLAN_LABEL[u.effectivePlan] || u.effectivePlan}</span>`);
    if (u.subscriptionStatus === 'comp') b.push(`<span class="adm-badge comp">Comp${u.compEndsAt ? ' · ' + fmtDate(u.compEndsAt) : ' · permanent'}</span>`);
    if (u.trial) b.push(`<span class="adm-badge trial">Trial ${PLAN_LABEL[u.trial.plan] || u.trial.plan} · ${fmtDate(u.trial.endsAt)}</span>`);
    if (u.envPrivileged) b.push('<span class="adm-badge env">via .env</span>');
    return b.join('');
  }

  function userRow(u) {
    const locked = u.envPrivileged;
    const planBtns = PLANS.map((p) =>
      `<button class="adm-btn plan-btn${u.plan === p && u.subscriptionStatus !== 'trialing' ? ' on' : ''}" data-plan="${p}"${locked ? ' disabled' : ''}>${PLAN_LABEL[p]}</button>`
    ).join('');
    const roleOpts = ROLES.map((r) => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
    return `<div class="adm-user" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">
      <div class="adm-user-top">
        <div class="adm-user-id">
          <div class="adm-user-name">${escapeHtml(u.name)}</div>
          <div class="adm-user-email">${escapeHtml(u.email)}</div>
          <div class="adm-badges">${badges(u)}</div>
        </div>
        <div class="adm-group">
          <span class="adm-group-label">Content</span>
          <button class="adm-btn content-btn">${u.sets || 0} sets · ${u.boards || 0} boards</button>
        </div>
      </div>
      <div class="adm-actions">
        <div class="adm-group">
          <span class="adm-group-label">Role</span>
          <select class="adm-role-select"${locked ? ' disabled' : ''}>${roleOpts}</select>
        </div>
        <span class="adm-sep"></span>
        <div class="adm-group">
          <span class="adm-group-label">License</span>${planBtns}
          <input class="adm-months" type="number" min="0" max="60" placeholder="mo" title="Free months (0 = permanent) for Pro/Teams" />
        </div>
        <span class="adm-sep"></span>
        <div class="adm-group">
          <span class="adm-group-label">Trial</span>
          <button class="adm-btn trial-btn" data-plan="starter"${locked ? ' disabled' : ''}>7-day Pro</button>
          <button class="adm-btn trial-btn" data-plan="team"${locked ? ' disabled' : ''}>7-day Teams</button>
        </div>
      </div>
    </div>`;
  }

  function bindRow(el) {
    const id = el.dataset.id;
    const monthsInput = el.querySelector('.adm-months');

    el.querySelector('.adm-role-select')?.addEventListener('change', async (e) => {
      const role = e.target.value;
      try { const r = await api(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) });
        replaceRow(el, r.user); toast(`Role set to ${ROLE_LABEL[role]}`);
      } catch (err) { toast(err.message, true); load(currentQuery); }
    });

    el.querySelectorAll('.plan-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan;
      const months = plan === 'free' ? 0 : (Number(monthsInput.value) || 0);
      const label = plan === 'free' ? 'Free' : `${PLAN_LABEL[plan]}${months ? ` for ${months} month(s)` : ' (permanent comp)'}`;
      if (!confirm(`Set ${el.dataset.email} to ${label}?`)) return;
      try { const r = await api(`/api/admin/users/${id}/plan`, { method: 'POST', body: JSON.stringify({ plan, months }) });
        replaceRow(el, r.user); toast(`License updated: ${label}`);
      } catch (err) { toast(err.message, true); }
    }));

    el.querySelectorAll('.trial-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan;
      try { const r = await api(`/api/admin/users/${id}/trial`, { method: 'POST', body: JSON.stringify({ plan }) });
        replaceRow(el, r.user); toast(`7-day ${PLAN_LABEL[plan]} trial started`);
      } catch (err) { toast(err.message, true); }
    }));

    el.querySelector('.content-btn')?.addEventListener('click', () => openContent(el.dataset.id, el.dataset.email));
  }

  function replaceRow(el, u) {
    if (!u) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = userRow(u);
    const fresh = wrap.firstElementChild;
    el.replaceWith(fresh);
    bindRow(fresh);
  }

  // ---- content drawer ----
  async function openContent(ownerId, email) {
    const dlg = $('#contentDialog');
    $('#contentTitle').textContent = `Content · ${email}`;
    $('#contentBody').innerHTML = '<div class="adm-empty">Loading…</div>';
    dlg.showModal();
    try {
      const data = await api(`/api/admin/content?ownerId=${encodeURIComponent(ownerId)}`);
      renderContent(data);
    } catch (e) { $('#contentBody').innerHTML = `<div class="adm-empty">${escapeHtml(e.message)}</div>`; }
  }

  function contentItem(kind, it) {
    const meta = [it.format, it.topic, fmtDate(it.updatedAt)].filter(Boolean).join(' · ');
    return `<div class="adm-content-item" data-kind="${kind}" data-id="${escapeHtml(it.id)}">
      <div><div class="adm-ci-title">${escapeHtml(it.title || 'Untitled')}</div><div class="adm-ci-meta">${escapeHtml(meta)}</div></div>
      <button class="adm-btn danger del-content">Delete</button>
    </div>`;
  }

  function renderContent(data) {
    const sets = data.sets || [], boards = data.boards || [];
    const body = $('#contentBody');
    body.innerHTML = `
      <div class="adm-content-group"><h4>Lessons / sets (${sets.length})</h4>
        ${sets.length ? sets.map((s) => contentItem('set', s)).join('') : '<div class="adm-empty">No sets.</div>'}</div>
      <div class="adm-content-group"><h4>Whiteboards (${boards.length})</h4>
        ${boards.length ? boards.map((b) => contentItem('board', b)).join('') : '<div class="adm-empty">No boards.</div>'}</div>`;
    body.querySelectorAll('.del-content').forEach((btn) => btn.addEventListener('click', async () => {
      const item = btn.closest('.adm-content-item');
      const kind = item.dataset.kind, cid = item.dataset.id;
      if (!confirm(`Permanently delete this ${kind}? This cannot be undone.`)) return;
      try { await api(`/api/admin/${kind}/${cid}`, { method: 'DELETE' }); item.remove(); toast(`${kind === 'set' ? 'Set' : 'Board'} deleted`); }
      catch (e) { toast(e.message, true); }
    }));
  }

  // ---- list ----
  let currentQuery = '';
  async function load(q) {
    currentQuery = q || '';
    const box = $('#admUsers'); const status = $('#admStatus');
    status.hidden = true;
    box.innerHTML = '<div class="adm-status">Loading users…</div>';
    try {
      const data = await api(`/api/admin/users?q=${encodeURIComponent(currentQuery)}`);
      PLANS = data.plans || PLANS; ROLES = data.roles || ROLES;
      $('#admTotal').textContent = `${data.total} users total`;
      if (!data.users.length) { box.innerHTML = '<div class="adm-status">No users match.</div>'; return; }
      box.innerHTML = data.users.map(userRow).join('');
      box.querySelectorAll('.adm-user').forEach(bindRow);
    } catch (e) {
      box.innerHTML = '';
      status.hidden = false; status.className = 'adm-status error';
      status.textContent = e.message || 'Could not load users.';
    }
  }

  (async () => {
    try { await C.initCommon(); } catch (_) {}
    if (C.state && C.state.user) $('#admMe').textContent = C.state.user.email;
    $('#contentClose').addEventListener('click', () => $('#contentDialog').close());
    let t = null;
    $('#admSearch').addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => load(v), 250); });
    load('');
  })();
})();
