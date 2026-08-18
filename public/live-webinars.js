/* Public webinar board: anyone can browse upcoming/live public webinars,
 * reserve a seat (capped at 50), or join one that's live right now. No login
 * required to attend — signups are by email. */
(() => {
  const { $, escapeHtml, api, initCommon } = window.AppCommon;

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function kindLabel(w) {
    if (w.kind === 'whiteboard') return '🖊 Whiteboard';
    return `📚 ${w.formatLabel || 'Lesson'}`;
  }

  function seatText(w) {
    if (w.live) {
      // Live: show who's in now and how many live seats remain.
      const left = (typeof w.liveSeatsLeft === 'number') ? w.liveSeatsLeft : Math.max(0, (w.capacity || 50) - (w.attendingNow || 0));
      const inNow = w.attendingNow || 0;
      if (left <= 0) return `<span class="web-seats">${inNow} attending · <span class="web-full-txt">room full</span></span>`;
      return `<span class="web-seats">${inNow} attending · ${left} of ${w.capacity} seats open</span>`;
    }
    // Upcoming: reserved vs available.
    const reserved = w.reserved || 0;
    const left = (typeof w.seatsLeft === 'number') ? w.seatsLeft : Math.max(0, (w.capacity || 50) - reserved);
    if (left <= 0) return '<span class="web-pill full">Full</span>';
    return `<span class="web-seats">${reserved} reserved · ${left} of ${w.capacity} seats left</span>`;
  }

  function row(w) {
    const liveFull = w.live && ((w.liveSeatsLeft ?? ((w.capacity || 50) - (w.attendingNow || 0))) <= 0);
    const upcomingFull = !w.live && ((w.seatsLeft ?? ((w.capacity || 50) - (w.reserved || 0))) <= 0);
    const action = w.live
      ? `<a class="btn primary small" href="${w.joinUrl}" target="_blank" rel="noopener" ${liveFull ? 'style="pointer-events:none;opacity:.5"' : ''}>${liveFull ? 'Room full' : '▶ Join live'}</a>`
      : `<button class="btn primary small web-signup" data-id="${w.id}" data-title="${escapeHtml(w.title)}" ${upcomingFull ? 'disabled' : ''}>${upcomingFull ? 'Full' : 'Reserve a seat'}</button>`;
    return `<div class="webinar-row" data-id="${w.id}">
      <div class="web-main">
        <div class="web-title">${escapeHtml(w.title)}</div>
        <div class="web-meta">${kindLabel(w)} · ${escapeHtml(fmtWhen(w.scheduledAt))}
          ${w.live ? '<span class="web-pill live">● LIVE NOW</span>' : '<span class="web-pill">Upcoming</span>'}
          · ${seatText(w)}</div>
      </div>
      <div class="web-actions">${action}</div>
    </div>`;
  }

  async function load() {
    try {
      const data = await api('/api/public/webinars');
      const list = data.webinars || [];
      const wrap = $('#liveWebList');
      if (!list.length) {
        wrap.innerHTML = '<p class="info-empty">No webinars scheduled right now. Check back soon — or if you teach, <a href="/webinars">host one</a>.</p>';
        return;
      }
      wrap.innerHTML = list.map(row).join('');
      wrap.querySelectorAll('.web-signup').forEach((b) => b.addEventListener('click', () => openSignup(b.dataset.id, b.dataset.title)));
    } catch (e) {
      $('#liveWebList').innerHTML = `<p class="info-empty">${escapeHtml(e.message || 'Could not load webinars.')}</p>`;
    }
  }

  let signupId = null;
  function openSignup(id, title) {
    signupId = id;
    $('#signupTitle').textContent = `Sign up — ${title}`;
    $('#signupSub').textContent = "We'll send the join link to your email before it starts.";
    $('#signupErr').style.display = 'none';
    $('#signupEmail').value = '';
    $('#signupDialog').showModal();
    setTimeout(() => $('#signupEmail').focus(), 40);
  }

  async function confirmSignup() {
    const email = $('#signupEmail').value.trim();
    const err = $('#signupErr');
    const btn = $('#signupConfirm');
    if (!email) { err.textContent = 'Enter your email.'; err.style.display = ''; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const d = await api(`/api/public/webinars/${signupId}/signup`, { method: 'POST', body: JSON.stringify({ email }) });
      $('#signupDialog').close();
      await load();
      if (d.live && d.joinUrl) {
        window.open(d.joinUrl, '_blank', 'noopener');
      } else if (window.AppCommon && AppCommon.setStatus) {
        const msg = d.alreadySignedUp
          ? "You're already on the list — we've re-sent your join link."
          : `Seat reserved — we've emailed your join link. ${d.seatsLeft} of ${d.capacity} seats left.`;
        AppCommon.setStatus(msg, 'success');
      }
    } catch (e) {
      err.textContent = e.message || 'Could not sign you up.'; err.style.display = '';
    } finally {
      btn.disabled = false; btn.textContent = 'Save my seat';
    }
  }

  (async () => {
    try { if (typeof initCommon === 'function') await initCommon(); } catch (_) {}
    $('#signupClose').addEventListener('click', () => $('#signupDialog').close());
    $('#signupConfirm').addEventListener('click', confirmSignup);
    $('#signupEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSignup(); });
    await load();
    // Refresh periodically so a session going live surfaces its Join button.
    setInterval(load, 30000);
  })();
})();
