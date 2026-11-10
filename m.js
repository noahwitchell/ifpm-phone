// IFPM phone — the whole board, phone-sized. Same data and change logs as the desktop app.
'use strict';
const { Store } = window.IFState;
const $ = s => document.querySelector(s);
const CFG = window.IFPM_PHONE || {};

// ---------- constants (kept in step with the desktop app) ----------
const EP_DATES = [
  { k: 'approve', name: 'Approve by', color: '#7445c4', fg: '#fff' },
  { k: 'due', name: 'Due', color: '#5a27a8', fg: '#fff' },
  { k: 'dry', name: 'DB', color: '#9b76de', fg: '#fff' },
  { k: 'camera', name: 'CB', color: '#bba3ee', fg: '#1d0b3a' },
  { k: 'taping', name: 'VTR', color: '#ddd0f8', fg: '#2a0f52' },
];
const OOO_COLOR = '#d93a3a';
const OOO_PARTS = { all: 'all day', am: 'AM', pm: 'PM' };
const BRIEF_KEYS = [['segment', 'Segment'], ['song', 'Song'], ['overview', 'Look'], ['music', 'Music'], ['creative', 'Creative'], ['notes', 'Notes'], ['programming', 'Programming'], ['noahStatus', 'Noah status']];
const IMG_RE = /\.(png|jpe?g|gif|webp)$/i, VID_RE = /\.(mp4|m4v|mov|webm)$/i;

// ---------- utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
const fmtDate = s => s ? new Date(s + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const fmtDay = s => new Date(s + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
function hashColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ['#3aa96b', '#e07b39', '#d9534f', '#e05fa3', '#8e6bd8', '#3b82c4', '#2aa198', '#7a5230', '#5c6bc0', '#c2185b', '#00897b', '#6d4c41'][h % 12]; }
function initials(n) { const p = String(n).trim().split(/\s+/); return ((p[0] || '')[0] || '?').toUpperCase() + ((p[1] || '')[0] || '').toUpperCase(); }
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1d1d1f' : '#fff';
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago'; if (s < 86400 * 6) return Math.round(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener">${/dropbox\.com/i.test(u) ? '📦 ' + esc(decodeURIComponent(u.replace(/&amp;/g, '&').split('?')[0].split('/').pop() || 'Dropbox link')) : u}</a>`).replace(/\n/g, '<br>'); }
// Countdown colour (same steps as desktop): calm blue a week out, warming to red on the day.
function dueColor(date, done, tone) {
  if (!date) return null;
  if (done) return { bg: 'var(--chip)', fg: 'var(--faint)', tag: '' };
  const d = daysBetween(today(), date);
  if (d < 0) return { bg: '#b0122a', fg: '#fff', tag: `${-d}d late`, late: true };
  if (d === 0) return { bg: '#ff2a2a', fg: '#fff', tag: 'TODAY' };
  const calm = tone === 'light' ? { 5: [193, 62, 56, '#fff'], 6: [200, 60, 58, '#fff'], 7: [206, 58, 60, '#fff'] }
    : tone === 'dark' ? { 5: [200, 64, 38, '#fff'], 6: [208, 60, 37, '#fff'], 7: [216, 56, 36, '#fff'] }
    : { 5: [196, 55, 46, '#fff'], 6: [205, 55, 46, '#fff'], 7: [212, 50, 45, '#fff'] };
  const steps = { 1: [6, 88, 52, '#fff'], 2: [22, 92, 50, '#fff'], 3: [36, 95, 50, '#222'], 4: [48, 92, 52, '#222'], 5: calm[5], 6: calm[6] };
  const [h, s, l, fg] = steps[d] || calm[7];
  return { bg: `hsl(${h} ${s}% ${l}%)`, fg, tag: d === 1 ? 'tmrw' : `${d}d` };
}
function toast(msg, undoable) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undoable ? ' <button data-act="undo">Undo</button>' : '');
  t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 4000);
}

// ---------- backend + who am I ----------
const useLocal = location.pathname.startsWith('/m/') && LS.get('backend', 'local') === 'local';
const be = useLocal ? new LocalBackend() : new DropboxBackend(CFG.DROPBOX_APP_KEY);
let me = LS.get('me', null);                         // { id, name } — this phone's own id, same name as on desktop

// ---------- board state ----------
let projects = [];
const stores = {}, avatars = {};
let cur = LS.get('last', null);
const ui = { tab: LS.get('tab', 'board'), filter: 'all', person: '', status: null, q: '', item: null, itab: 'updates', showPast: false, open: new Set(LS.get('open', [])), draft: { text: '', files: [], important: false }, replyTo: null, datesBack: false };
let syncState = 'ok', lastSync = 0, undoLast = null;
const pending = LS.get('pending', {});               // board -> ops not yet saved to Dropbox (offline)

const S = p => stores[p] || (stores[p] = new Store());
const settings = p => S(p).get('proj', 'settings') || {};
const cols = p => S(p).list('col');
const groups = p => S(p).list('group');
const items = p => S(p).list('item');
const statusCols = p => cols(p).filter(c => c.type === 'status');
const mainStatus = p => { const c = statusCols(p); return c.find(x => x.main) || c.find(x => !(x.kind === 'complexity' || /complex|approv/i.test(x.name))) || c[0] || null; };
const labelOf = (col, v) => col && (col.labels || []).find(l => l.id === v);
const canEdit = col => !col.editors || !col.editors.length || col.editors.includes(me.name);
const leadCol = p => cols(p).find(c => c.lead);
const boardName = p => settings(p).name || (projects.find(x => x.path === p) || {}).name || String(p).split('/').pop();
const isMe = (p, uid) => uid === me.id || S(p).name(uid) === me.name;
function people(p) {
  const set = new Set([...(settings(p).people || []), ...S(p).users().map(u => u.name).filter(n => n && n !== 'Sample data'), me && me.name]);
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}
function isDone(p, item) { const c = mainStatus(p); const l = c && labelOf(c, item['c_' + c.id]); return !!(l && l.done); }
const dueCol = p => { const ds = cols(p).filter(c => c.type === 'date'); return ds.find(c => /due/i.test(c.name)) || ds[ds.length - 1] || null; };
const dueOf = (p, item) => { const c = dueCol(p); return c ? item['c_' + c.id] || '' : ''; };
const dateTone = (p, col) => /approv/i.test(col.name) || (col.statusCol && /approv/i.test((S(p).get('col', col.statusCol) || {}).name || '')) ? 'light' : /due/i.test(col.name) ? 'dark' : null;
function dateDone(p, col, item) {
  if (isDone(p, item)) return true;
  const sc = col.statusCol && S(p).get('col', col.statusCol);
  if (sc) { const l = labelOf(sc, item['c_' + sc.id]); return !!(l && l.done); }
  return false;
}
const subsOf = (p, id) => items(p).filter(i => i.parent === id);
const assignees = (p, it) => { const s = new Set(); for (const c of cols(p)) if (c.type === 'person') for (const n of it['c_' + c.id] || []) s.add(n); return [...s]; };
function assignedAll(p, top) { const s = new Set(assignees(p, top)); for (const x of subsOf(p, top.id)) for (const n of assignees(p, x)) s.add(n); return s; }
const updsFor = (p, ids) => S(p).list('upd').filter(u => ids.has(u.item));
function episodeDates(p, g) {
  const out = {};
  for (const d of EP_DATES) if (g['d_' + d.k]) out[d.k] = g['d_' + d.k];
  if (!out.due) {
    const c = dueCol(p); const counts = {};
    if (c) for (const i of items(p)) if (i.group === g.id && !i.parent && i['c_' + c.id]) counts[i['c_' + c.id]] = (counts[i['c_' + c.id]] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    if (best) out.due = best[0];
  }
  return out;
}
// Items in an episode that has already taped never count as late.
const taped = (p, i) => { const g = S(p).get('group', i.group); return !!g && epPast(p, g); };
function epPast(p, g) { const ed = episodeDates(p, g); const end = ed.taping || Object.values(ed).sort().pop(); return !!end && end < today(); }
const itemTitle = (p, it) => { const l = leadCol(p); return (l && it['c_' + l.id] ? it['c_' + l.id] + ' – ' : '') + (it.name || ''); };
function av(n, cls = '') {
  const a = cur && (avatars[cur] || {})[n];
  if (a) return `<img class="av ${cls}" src="${esc(a)}" alt="${esc(initials(n))}">`;
  return `<span class="av ${cls}" style="background:${hashColor(n)}">${esc(initials(n))}</span>`;
}
function spill(l, small) { return l ? `<span class="spill ${small ? 'sm' : ''}" style="background:${l.color};color:${textOn(l.color)}">${esc(l.name)}</span>` : `<span class="spill empty ${small ? 'sm' : ''}">—</span>`; }
function dpill(date, done, tone, prefix) {
  if (!date) return '';
  const c = dueColor(date, done, tone);
  return `<span class="dpill" style="background:${c.bg};color:${c.fg}">${prefix ? `<i>${esc(prefix)}</i>` : ''}${esc(fmtDate(date))}${c.tag ? `<small>${esc(c.tag)}</small>` : ''}</span>`;
}

// ---------- reading + writing ----------
async function loadBoard(p, reset) {
  const ops = await be.readLog(p, reset);
  let ch = false;
  for (const o of ops) if (S(p).apply(o)) ch = true;
  return ch;
}
async function loadAvatars(p) { try { avatars[p] = await be.listAvatars(p); } catch { } }
async function writeMany(p, list, opts = {}) {
  const st = S(p), undo = [];
  const ops = list.map(([t, id, f]) => {
    const e = st.raw(t, id), prev = {};
    if (!e) prev.deleted = true; else for (const k of Object.keys(f)) prev[k] = k in e.f ? e.f[k] : null;
    undo.push([t, id, prev]);
    const o = { ts: Math.max(Date.now(), st.maxTs + 1), u: me.id, n: st.lastSeq(me.id) + 1, w: me.name, t, id, f };
    st.apply(o);
    return o;
  });
  if (!opts.noUndo) undoLast = { p, list: undo };
  (pending[p] = pending[p] || []).push(...ops);
  LS.set('pending', pending);
  render();
  await flush(p);
}
const write = (p, t, id, f, opts) => writeMany(p, [[t, id, f]], opts);
async function flush(p) {
  const ops = pending[p];
  if (!ops || !ops.length) return true;
  try {
    await be.appendLog(p, me.id, ops.slice());
    pending[p] = pending[p].slice(ops.length);
    if (!pending[p].length) delete pending[p];
    LS.set('pending', pending);
    syncState = 'ok'; lastSync = Date.now();
    return true;
  } catch (e) {
    console.warn(e);
    syncState = 'offline';
    toast('Saved on this phone. It will send when you have signal.');
    return false;
  } finally { renderTop(); }
}
async function poll(force) {
  if (!cur || !me || (!force && document.visibilityState !== 'visible')) return;
  try {
    for (const p of Object.keys(pending)) await flush(p);
    const ch = await loadBoard(cur);
    syncState = Object.keys(pending).length ? 'offline' : 'ok'; lastSync = Date.now();
    if (ch) softRender(); else renderTop();
  } catch (e) { console.warn(e); syncState = 'offline'; renderTop(); }
}
function softRender() {
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) { ui.pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { const a = document.activeElement; if (ui.pendingRender && !(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'))) { ui.pendingRender = false; render(); } }, 0));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
async function heartbeat() {
  if (!cur || !me) return;
  const st = S(cur), seen = {};
  for (const u of st.users()) seen[u.id] = st.lastSeq(u.id);
  be.writePresence(cur, me.id, { id: me.id, name: me.name, ts: Date.now(), seen, viewing: true, device: 'phone' });
}

// ---------- notifications on this phone ----------
// The team's sender computer sends them (core/webpush.js on the desktop). This phone only has to say "send them here":
// it registers with the phone's own push service (Apple / Google) and leaves that address in each board's .ifboard/push folder.
const devId = LS.get('devId', null) || (() => { const v = nid(); LS.set('devId', v); return v; })();
const pushFile = () => safeName(me.name) + '__' + safeName(devId) + '.json';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushState() {
  if (isIOS && !standalone()) return 'install';         // iPhone only allows notifications for apps on the Home Screen
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return LS.get('push', null) && Notification.permission === 'granted' ? 'on' : 'off';
}
function pushRowHtml() {
  const st = pushState();
  // one toggle: blue = on, plain = off; tap to flip
  if (st === 'on') return `<button class="wide primary" data-act="push-off" aria-pressed="true">🔔 Notifications on</button><button class="wide" data-act="push-test-info">How they work</button>`;
  if (st === 'off') return `<button class="wide" data-act="push-on" aria-pressed="false">🔕 Notifications off</button>`;
  if (st === 'install') return `<div class="note small">To get notifications on iPhone, add IFPM to your Home Screen first (Share button → <b>Add to Home Screen</b>), then open it from there.</div>`;
  if (st === 'denied') return `<div class="note small">Notifications are blocked for IFPM. Turn them on in your phone's Settings → Notifications → IFPM, then come back here.</div>`;
  return `<div class="note small">This browser can't show notifications. On iPhone use Safari, on Android use Chrome.</div>`;
}
function keyBytes(k) { const b = atob(k.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((k.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function senderKey() {
  for (const pr of projects) { const k = await be.pushKeyOf(pr.path).catch(() => null); if (k) return k; }
  return null;
}
async function pushRegisterAll(sub, key) {
  const j = sub.toJSON();
  const rec = { name: me.name, endpoint: j.endpoint, keys: j.keys, key, device: (isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'phone'), at: Date.now() };
  let n = 0;
  for (const pr of projects) { try { await be.pushRegister(pr.path, pushFile(), rec); n++; } catch { } }
  LS.set('push', { key, at: Date.now(), boards: projects.map(x => x.path) });
  return n;
}
async function pushOn() {
  const perm = await Notification.requestPermission();                  // must come straight from the tap
  if (perm !== 'granted') { toast('Notifications weren’t allowed'); return settingsSheet(); }
  const key = await senderKey();
  if (!key) { toast('The team’s sender computer hasn’t set up phone notifications yet'); return settingsSheet(); }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await pushRegisterAll(sub, key);
    toast('Notifications on. You’ll get a ding when something needs you.');
  } catch (e) { toast('Couldn’t turn on notifications: ' + (e.message || e)); }
  settingsSheet();
}
async function pushOff() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { }
  for (const pr of projects) await be.pushUnregister(pr.path, pushFile());
  LS.del('push');
  toast('Notifications off on this phone');
  settingsSheet();
}
// Each time the app opens: keep the registration current (new boards, a new sender computer, an expired address).
async function pushKeepUp() {
  const was = LS.get('push', null);
  if (!was || !pushSupported() || Notification.permission !== 'granted') return;
  try {
    const key = await senderKey(); if (!key) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const fresh = sub && was.key === key;
    if (!fresh) { if (sub) await sub.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }); }
    const newBoards = projects.some(x => !(was.boards || []).includes(x.path));
    if (!fresh || newBoards || Date.now() - (was.at || 0) > 7 * 86400e3) await pushRegisterAll(sub, key);
  } catch (e) { console.warn('push keep-up', e); }
}
function clearBadge() {
  try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch { }
  try { navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('clear-badge'); } catch { }
}
// Tapping a notification opens that performance.
async function openFromNotification(d) {
  if (!d || !d.board) return;
  const pr = projects.find(x => x.name.toLowerCase() === String(d.board).toLowerCase());
  if (!pr) return;
  if (cur !== pr.path || !stores[pr.path]) await openBoard(pr.path, true);
  if (d.item && S(pr.path).get('item', d.item)) openItem(d.item);
}
function hashOpen() {
  const m = /#open=([^&]*)/.exec(location.hash); if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const [board, item] = decodeURIComponent(m[1]).split('|');
  return { board, item };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open) { clearBadge(); openFromNotification(e.data.open); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearBadge(); });

// A one-time card on the board asking to turn notifications on (has to be a tap: phones don't allow asking otherwise).
function pushNudge() {
  if (LS.get('pushNudged', false) || pushState() !== 'off') return;
  const el = document.createElement('div');
  el.className = 'pushnudge';
  el.innerHTML = `<span>🔔 Get a ding on this phone when something needs you</span><button class="small primary" data-act="push-on-nudge">Turn on</button><button class="small ghost" data-act="push-nudge-x">Not now</button>`;
  document.body.appendChild(el);
}
const dropNudge = () => { LS.set('pushNudged', true); const n = document.querySelector('.pushnudge'); if (n) n.remove(); };

// ---------- boot ----------
async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('code') && be.kind === 'dropbox') {
    history.replaceState(null, '', location.pathname);
    try { await be.finishSignIn(q.get('code')); } catch (e) { return screenSignIn(String(e.message || e)); }
  }
  if (be.kind === 'dropbox' && !CFG.DROPBOX_APP_KEY && !LS.get('dbxHosts', null)) return screenMsg('Almost ready', 'This page isn’t connected to the team’s Dropbox app yet (no app key in config.js).');
  if (!be.signedIn) return screenSignIn();
  if (!me) return screenName();
  $('#main').innerHTML = '<div class="loading">Loading boards…</div>';
  try { projects = (await be.listProjects()).filter(x => x.hasBoard); }
  catch (e) { return screenMsg('Couldn’t reach Dropbox', String(e.message || e), true); }
  if (!projects.length) return screenMsg('No boards found', `No IF_ project with an IFPM board is shared with this Dropbox${be.root ? ' in ' + be.root : ''}.`, true);
  if (!projects.some(x => x.path === cur)) cur = projects.length === 1 ? projects[0].path : null;
  const fromNote = hashOpen();
  clearBadge();
  if (fromNote) await openFromNotification(fromNote);
  else if (cur) await openBoard(cur, true); else render();
  pushKeepUp();
  pushNudge();
  // stats on the board list need every board loaded; do the rest quietly
  for (const pr of projects) if (!stores[pr.path]) { try { await loadBoard(pr.path, true); } catch { } if (!cur) render(); }
  setInterval(poll, 8000);
  setInterval(heartbeat, 120000);
}
async function openBoard(p, quiet) {
  cur = p; LS.set('last', p);
  ui.item = null; closeSheet();
  if (!quiet) $('#main').innerHTML = '<div class="loading">Loading…</div>';
  try { await loadBoard(p, !stores[p]); } catch (e) { toast('Couldn’t load: ' + (e.message || e)); }
  await loadAvatars(p);
  render(); heartbeat();
}

// ---------- screens before the board ----------
function screenMsg(title, text, retry) {
  $('#top').innerHTML = `<div class="tb"><span class="logo"><img src="icon-192.png" alt="">IFPM</span></div>`; $('#tabs').innerHTML = '';
  $('#main').innerHTML = `<div class="welcome"><h2>${esc(title)}</h2><p>${esc(text)}</p>${retry ? '<button class="primary" data-act="reload">Try again</button> <button data-act="menu">Settings</button>' : ''}</div>`;
}
function screenSignIn(err) {
  $('#top').innerHTML = ''; $('#tabs').innerHTML = '';
  $('#main').innerHTML = `<div class="welcome"><img class="bigicon" src="icon-192.png" alt=""><h1>IFPM</h1>
    <p>Sign in with the Dropbox account that has your IF_ project folders. IFPM only reads and writes the boards inside them.</p>
    ${err ? `<p class="err">${esc(err)}</p>` : ''}
    <button class="primary big" data-act="signin">Sign in with Dropbox</button>
    <p class="small muted" style="margin-top:22px">Sign-in didn’t come back to IFPM? <a href="#" data-act="signin-code">Use a code instead</a></p>
    <div id="codebox" class="hidden"><input id="code-in" placeholder="Paste the code from Dropbox" autocomplete="off"><button class="primary" data-act="code-go">Continue</button></div></div>`;
}
async function screenName() {
  $('#top').innerHTML = ''; $('#tabs').innerHTML = '';
  let guess = '';
  try { guess = (await be.account()).name || ''; } catch { }
  $('#main').innerHTML = `<div class="welcome"><h2>Who are you?</h2>
    <p>Use the same name you use in IFPM on your computer, so your work, mentions and notifications line up.</p>
    <input id="me-name" value="${esc(guess)}" placeholder="e.g. Noah Witchell" autocomplete="name">
    <button class="primary big" data-act="me-save">Continue</button></div>`;
}

// ---------- render ----------
function render() {
  if (!me) return;
  renderTop(); renderTabs();
  if (!cur) renderBoards();
  else if (ui.tab === 'people') renderPeople();
  else if (ui.tab === 'dates') renderDates();
  else if (ui.tab === 'activity') renderActivity();
  else renderBoard();
  if (ui.item) renderSheet();
  hydrate();
}
function renderTop() {
  if (!me) return;
  const dot = syncState === 'offline' ? 'off' : 'ok';
  const pend = Object.values(pending).reduce((n, a) => n + a.length, 0);
  $('#top').innerHTML = `<div class="tb">
    ${cur ? `<button class="bname" data-act="boards"><span>${esc(boardName(cur))}</span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></button>` : `<span class="logo"><img src="icon-192.png" alt="">IFPM</span>`}
    <span class="spacer"></span>
    <span class="sync ${dot}" data-act="sync-now" title="">${pend ? pend + ' to send' : syncState === 'offline' ? 'Offline' : ''}<i></i></span>
    <button class="icon" data-act="menu" aria-label="Settings">${av(me.name, 'sm')}</button></div>`;
}
const TAB_ICONS = {
  board: '<path d="M3 5h14M3 10h14M3 15h9" />',
  people: '<circle cx="7" cy="7" r="3"/><path d="M1.8 17c.6-3 2.6-4.6 5.2-4.6s4.6 1.6 5.2 4.6M13 4.6a3 3 0 010 5.4M15.2 12.6c1.6.6 2.6 2 3 4.4"/>',
  dates: '<rect x="2.5" y="4" width="15" height="13.5" rx="2"/><path d="M2.5 8h15M6.5 2v4M13.5 2v4"/>',
  activity: '<path d="M2 10h3.5l2.5-6 4 12 2.5-6H18"/>',
};
function renderTabs() {
  if (!cur) { $('#tabs').innerHTML = ''; return; }
  $('#tabs').innerHTML = [['board', 'Board'], ['people', 'People'], ['dates', 'Dates'], ['activity', 'Activity']].map(([k, n]) =>
    `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[k]}</svg>${n}</button>`).join('');
}

// Stats for a set of top-level items.
function stats(p, its) {
  const col = mainStatus(p), counts = new Map(), t = today(), wk = addDays(t, 7);
  let late = 0, soon = 0, done = 0;
  for (const i of its) {
    const v = col ? i['c_' + col.id] || '' : '';
    counts.set(v, (counts.get(v) || 0) + 1);
    const dn = isDone(p, i); if (dn) done++;
    const d = dueOf(p, i); if (!d || dn || taped(p, i)) continue;
    if (d < t) late++; else if (d <= wk) soon++;
  }
  const segs = [];
  for (const l of (col && col.labels) || []) if (counts.get(l.id)) segs.push({ id: l.id, name: l.name, color: l.color, n: counts.get(l.id) });
  if (counts.get('')) segs.push({ id: '', name: 'No status', color: 'var(--line2)', n: counts.get('') });
  return { total: its.length, segs, late, soon, done };
}
const barHtml = s => `<div class="bar">${s.total ? s.segs.map(g => `<span style="flex:${g.n};background:${g.color}"></span>`).join('') : ''}</div>`;

function renderBoards() {
  $('#main').innerHTML = `<div class="pad"><h1 class="h1">Boards</h1>${projects.map(pr => {
    const loaded = !!stores[pr.path];
    const s = loaded ? stats(pr.path, items(pr.path).filter(i => !i.parent)) : null;
    return `<div class="card bcard" data-act="open-board" data-p="${esc(pr.path)}">
      <div class="bc-h"><b>${esc(loaded ? boardName(pr.path) : pr.name)}</b><span class="muted small">${esc(pr.name)}</span></div>
      ${s ? `${barHtml(s)}<div class="kpis sm"><span><b>${s.total}</b> items</span><span><b>${s.done}</b> done</span><span class="${s.late ? 'red' : ''}"><b>${s.late}</b> late</span><span><b>${s.soon}</b> this week</span></div>` : '<div class="muted small">Loading…</div>'}
    </div>`;
  }).join('')}</div>`;
}

// ---------- Board (bird's-eye) ----------
function matches(p, top) {
  const t = today(), wk = addDays(t, 7);
  const fam = [top, ...subsOf(p, top.id)];
  if (ui.person && !assignedAll(p, top).has(ui.person)) return false;
  if (ui.filter === 'mine' && !assignedAll(p, top).has(me.name)) return false;
  if (ui.filter === 'unassigned' && assignedAll(p, top).size) return false;
  if (ui.filter === 'open' && isDone(p, top)) return false;
  if (ui.filter === 'late' || ui.filter === 'week') {
    const d = dueOf(p, top); if (!d || isDone(p, top) || taped(p, top)) return false;
    if (ui.filter === 'late' && d >= t) return false;
    if (ui.filter === 'week' && (d < t || d > wk)) return false;
  }
  if (ui.status != null) { const c = mainStatus(p); if (!c || (top['c_' + c.id] || '') !== ui.status) return false; }
  const q = ui.q.trim().toLowerCase();
  if (q) {
    let hay = '';
    for (const it of fam) {
      hay += ' ' + (it.name || '');
      for (const c of cols(p)) { const v = it['c_' + c.id]; if (!v) continue; if (c.type === 'status') { const l = labelOf(c, v); if (l) hay += ' ' + l.name; } else if (c.type === 'person') hay += ' ' + v.join(' '); else hay += ' ' + v; }
    }
    const g = S(p).get('group', top.group); if (g) hay += ' ' + g.name;
    if (!hay.toLowerCase().includes(q)) return false;
  }
  return true;
}
const filtering = () => ui.filter !== 'all' || ui.person || ui.status != null || ui.q.trim();

function renderBoard() {
  const p = cur, tops = items(p).filter(i => !i.parent), s = stats(p, tops), col = mainStatus(p);
  const gs = groups(p);
  const live = gs.filter(g => !epPast(p, g)), past = gs.filter(g => epPast(p, g));
  const shown = tops.filter(i => matches(p, i));
  const chips = [['all', 'All'], ['mine', 'Mine'], ['late', 'Late'], ['week', 'Due this week'], ['open', 'Not done'], ['unassigned', 'Unassigned']];
  const epCard = g => {
    const its = tops.filter(i => i.group === g.id), vis = its.filter(i => shown.includes(i));
    if (filtering() && !vis.length) return '';
    const es = stats(p, its), ed = episodeDates(p, g), isPast = epPast(p, g);
    const open = filtering() || ui.open.has(g.id);
    const dates = EP_DATES.filter(d => ed[d.k]).map(d => `<span class="epd" style="background:${isPast ? 'var(--chip)' : d.color};color:${isPast ? 'var(--faint)' : d.fg}">${esc(d.name)} ${esc(fmtDate(ed[d.k]))}</span>`).join('');
    return `<div class="ep ${isPast ? 'past' : ''} ${open ? 'open' : ''}" style="--gc:${g.color || '#3b82c4'}">
      <div class="ep-h" data-act="ep-toggle" data-id="${esc(g.id)}">
        <div class="ep-t"><b>${esc(g.name)}</b><span class="muted small">${filtering() ? vis.length + ' of ' : ''}${its.length}</span>${es.late ? `<span class="redtag">${es.late} late</span>` : ''}<span class="spacer"></span><svg class="chev" width="14" height="14" viewBox="0 0 12 12"><path d="M4.5 3l3 3-3 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></div>
        ${dates ? `<div class="epds">${dates}</div>` : ''}
        ${barHtml(es)}
      </div>
      ${open ? `<div class="rows">${(filtering() ? vis : its).map(i => rowHtml(p, i, col)).join('') || '<div class="muted small pad">Nothing in this episode yet.</div>'}</div>` : ''}
    </div>`;
  };
  const ungrouped = tops.filter(i => !gs.some(g => g.id === i.group) && shown.includes(i));
  $('#main').innerHTML = `<div class="pad">
    <div class="search"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>
      <input id="q" type="search" placeholder="Search performers, songs, people…" value="${esc(ui.q)}" autocomplete="off"></div>
    <div class="card sum">
      <div class="kpis"><div><b>${s.total}</b><span>items</span></div><div><b>${s.total ? Math.round(s.done / s.total * 100) : 0}%</b><span>done</span></div>
        <div class="${s.late ? 'red' : ''}" data-act="filter" data-f="late"><b>${s.late}</b><span>late</span></div><div data-act="filter" data-f="week"><b>${s.soon}</b><span>this week</span></div></div>
      ${barHtml(s)}
      <div class="legend">${s.segs.map(g => `<span class="${ui.status === g.id ? 'on' : ''}" data-act="status-filter" data-s="${esc(g.id)}"><i style="background:${g.color}"></i>${esc(g.name)} <b>${g.n}</b></span>`).join('')}</div>
    </div>
    <div class="chips">${chips.map(([k, n]) => `<button class="${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${n}</button>`).join('')}
      ${ui.person ? `<button class="on person" data-act="person-clear">${av(ui.person, 'xs')}${esc(ui.person.split(' ')[0])} ✕</button>` : ''}
      ${ui.status != null ? `<button class="on" data-act="status-filter" data-s="${esc(ui.status)}">${esc((labelOf(col, ui.status) || { name: 'No status' }).name)} ✕</button>` : ''}</div>
    ${filtering() ? `<div class="muted small fhint">${shown.length} match${shown.length === 1 ? '' : 'es'}</div>` : ''}
    ${live.map(epCard).join('')}
    ${ungrouped.length ? `<div class="ep open"><div class="ep-h"><div class="ep-t"><b>No episode</b></div></div><div class="rows">${ungrouped.map(i => rowHtml(p, i, col)).join('')}</div></div>` : ''}
    ${past.length ? (filtering() || ui.showPast ? `<div class="sect">Past episodes</div>${past.slice().reverse().map(epCard).join('')}` : `<button class="ghost wide" data-act="show-past">Show ${past.length} past episode${past.length === 1 ? '' : 's'}</button>`) : ''}
    ${!gs.length && !tops.length ? '<div class="muted pad">This board is empty.</div>' : ''}
  </div>`;
}
function rowHtml(p, i, col) {
  const lc = leadCol(p), perf = lc && i['c_' + lc.id];
  const subs = subsOf(p, i.id), dn = isDone(p, i);
  const subDone = subs.filter(x => isDone(p, x)).length;
  const ids = new Set([i.id, ...subs.map(x => x.id)]);
  const nUpd = updsFor(p, ids).length;
  const who = [...assignedAll(p, i)];
  const dc = dueCol(p);
  return `<div class="row ${dn ? 'done' : ''}" data-act="item" data-id="${esc(i.id)}">
    <div class="r1">${perf ? `<span class="perf">${esc(perf)}</span>` : ''}<span class="nm">${esc(i.name || 'Untitled')}</span></div>
    <div class="r2">${spill(labelOf(col, col && i['c_' + col.id]), true)}${dc ? dpill(i['c_' + dc.id], dateDone(p, dc, i) || taped(p, i), dateTone(p, dc)) : ''}
      ${subs.length ? `<span class="meta">${subDone}/${subs.length}</span>` : ''}${nUpd ? `<span class="meta">💬 ${nUpd}</span>` : ''}
      <span class="spacer"></span><span class="avs">${who.slice(0, 3).map(n => av(n, 'xs')).join('')}${who.length > 3 ? `<span class="av xs more">+${who.length - 3}</span>` : ''}</span></div>
  </div>`;
}

// ---------- People ----------
function renderPeople() {
  const p = cur, tops = items(p).filter(i => !i.parent), t = today(), wk = addDays(t, 7);
  const ooo = S(p).list('event').filter(e => e.kind === 'ooo' && (e.end || e.date) >= t);
  const rows = people(p).map(n => {
    const mine = tops.filter(i => assignedAll(p, i).has(n));
    const open = mine.filter(i => !isDone(p, i) && !taped(p, i));
    const late = open.filter(i => { const d = dueOf(p, i); return d && d < t; }).length;
    const week = open.filter(i => { const d = dueOf(p, i); return d && d >= t && d <= wk; }).length;
    const next = open.map(i => dueOf(p, i)).filter(d => d && d >= t).sort()[0];
    const out = ooo.filter(e => e.person === n).sort((a, b) => a.date.localeCompare(b.date))[0];
    return { n, total: mine.length, open: open.length, late, week, next, out };
  }).filter(r => r.total || r.out || r.n === me.name).sort((a, b) => b.open - a.open || a.n.localeCompare(b.n));
  const un = tops.filter(i => !assignedAll(p, i).size && !isDone(p, i) && !taped(p, i)).length;
  const maxOpen = Math.max(1, ...rows.map(r => r.open));
  $('#main').innerHTML = `<div class="pad"><h1 class="h1">People</h1>
    ${rows.map(r => `<div class="card pcard" data-act="person" data-n="${esc(r.n)}">
      ${av(r.n, 'lg')}<div class="pc-b"><div class="pc-t"><b>${esc(r.n)}</b>${r.out ? `<span class="ootag">Out ${esc(fmtDate(r.out.date))}${r.out.end && r.out.end !== r.out.date ? '–' + esc(fmtDate(r.out.end)) : ''}${r.out.part && r.out.part !== 'all' ? ' ' + OOO_PARTS[r.out.part] : ''}</span>` : ''}</div>
        <div class="load"><span style="width:${r.open / maxOpen * 100}%"></span></div>
        <div class="kpis sm"><span><b>${r.open}</b> open</span><span class="${r.late ? 'red' : ''}"><b>${r.late}</b> late</span><span><b>${r.week}</b> this week</span>${r.next ? `<span>next ${esc(fmtDate(r.next))}</span>` : ''}</div></div>
    </div>`).join('')}
    ${un ? `<div class="card pcard" data-act="filter-tab" data-f="unassigned"><span class="av lg" style="background:var(--line2)">?</span><div class="pc-b"><b>Nobody assigned</b><div class="kpis sm"><span><b>${un}</b> open items</span></div></div></div>` : ''}
  </div>`;
}

// ---------- Dates (month grid + the picked day's details) ----------
function dayEntries(p, from, to) {
  const days = {};
  const add = (d, e) => { if (d >= from && d <= to) (days[d] = days[d] || []).push(e); };
  for (const g of groups(p)) {
    const ed = episodeDates(p, g), short = (g.name.match(/^\s*(\d{3,5})/) || [])[1] || g.name.split(/\s+-\s+/)[0].slice(0, 8);
    for (const d of EP_DATES) if (ed[d.k]) add(ed[d.k], { sort: EP_DATES.indexOf(d), bg: d.color, fg: d.fg, tag: d.name === 'Approve by' ? 'APV' : d.name.toUpperCase(), short, long: `<b>${esc(d.name)}</b> ${esc(g.name.replace(/\s+-\s+/, ' '))}` });
  }
  for (const e of S(p).list('event')) {
    const end = e.end && e.end > e.date ? e.end : e.date;
    for (let d = e.date > from ? e.date : from, k = 0; d <= end && d <= to && k < 120; d = addDays(d, 1), k++) {
      if (e.kind === 'ooo') add(d, { sort: 10, bg: OOO_COLOR, fg: '#fff', tag: initials(e.person || '?'), short: e.part && e.part !== 'all' ? OOO_PARTS[e.part] : 'out', id: e.id,
        long: `${av(e.person || '?', 'xs')}<b>${esc((e.person || 'Someone').split(' ')[0])} out</b>${e.part && e.part !== 'all' ? ' ' + OOO_PARTS[e.part] : ''}${e.title ? ' · ' + esc(e.title) : ''}` });
      else add(d, { sort: 11, bg: '#2aa198', fg: '#fff', tag: '', short: (e.title || 'Date').slice(0, 10), id: e.id, long: esc(e.title || 'Date') });
    }
  }
  return days;
}
function renderDates() {
  const p = cur, t = today();
  const month = ui.calMonth || t.slice(0, 7);
  const first = new Date(month + '-01T12:00');
  const start = addDays(month + '-01', -first.getDay());                         // weeks start Sunday
  const lastDay = ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0, 12));
  const end = addDays(lastDay, 6 - new Date(lastDay + 'T12:00').getDay());
  const days = dayEntries(p, start, end);
  const dueN = {}, dueItems = {};
  for (const i of items(p)) { if (i.parent || isDone(p, i)) continue; const d = dueOf(p, i); if (d && d >= start && d <= end) { dueN[d] = (dueN[d] || 0) + 1; (dueItems[d] = dueItems[d] || []).push(i); } }
  const sel = ui.calDay && ui.calDay >= start && ui.calDay <= end ? ui.calDay : (t >= start && t <= end ? t : month + '-01');
  let cells = '';
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const list = (days[d] || []).sort((a, b) => a.sort - b.sort);
    const show = list.slice(0, 3), more = list.length - show.length;
    cells += `<div class="cd ${d.slice(0, 7) !== month ? 'other' : ''} ${d === t ? 'today' : ''} ${d === sel ? 'sel' : ''} ${d < t ? 'pastday' : ''}" data-act="cal-day" data-d="${d}">
      <span class="cn">${+d.slice(8)}</span>
      ${show.map(x => `<span class="cb" style="background:${x.bg};color:${x.fg}">${x.tag ? `<b>${esc(x.tag)}</b>` : ''}${esc(x.short)}</span>`).join('')}
      ${more > 0 ? `<span class="cmore">+${more}</span>` : ''}${dueN[d] ? `<span class="cdue">${dueN[d]} due</span>` : ''}</div>`;
  }
  const selList = (dayEntries(p, sel, sel)[sel] || []).sort((a, b) => a.sort - b.sort);
  const selDue = dueItems[sel] || items(p).filter(i => !i.parent && !isDone(p, i) && dueOf(p, i) === sel);
  const col = mainStatus(p);
  const late = items(p).filter(i => !i.parent && !isDone(p, i) && !taped(p, i) && dueOf(p, i) && dueOf(p, i) < t).length;
  $('#main').innerHTML = `<div class="pad">
    <div class="hrow"><h1 class="h1">${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h1><span class="spacer"></span>
      <button class="ghost small" data-act="cal-m" data-d="-1" aria-label="Previous month">‹</button><button class="small" data-act="cal-m" data-d="0">Today</button><button class="ghost small" data-act="cal-m" data-d="1" aria-label="Next month">›</button></div>
    ${late ? `<div class="card latecard" data-act="filter-tab" data-f="late"><b>${late}</b> item${late === 1 ? '' : 's'} past due · tap to see</div>` : ''}
    <div class="cal"><div class="cw">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<span>${x}</span>`).join('')}</div><div class="cg">${cells}</div></div>
    <div class="hrow" style="margin-top:14px"><div class="sect" style="margin:0 4px">${esc(fmtDay(sel))}</div><span class="spacer"></span><button class="primary small" data-act="ev-new" data-d="${sel}">+ Time off</button></div>
    <div class="card dayc">${selList.map(x => `<div class="dline" ${x.id ? `data-act="ev-edit" data-id="${esc(x.id)}"` : ''}><span class="ag" style="background:${x.bg};color:${x.fg}">${x.long}</span></div>`).join('')}
      ${selDue.length ? `<div class="small muted" style="margin:8px 0 2px">Due</div>${selDue.map(i => rowHtml(p, i, col)).join('')}` : ''}
      ${!selList.length && !selDue.length ? '<div class="muted small">Nothing on this day.</div>' : ''}</div>
  </div>`;
}

// ---------- Activity ----------
function describe(p, o) {
  const parts = [];
  if (o.t === 'upd') {
    if (o.f.deleted) return null;
    if (!('text' in o.f) && !o.f.files) return null;
    const u = S(p).get('upd', o.id);
    const txt = (o.f.text || '').slice(0, 140);
    return { verb: o.f.parent ? 'replied' : (o.f.important ? 'posted an important update' : 'posted an update'), body: txt ? '“' + esc(txt) + (o.f.text.length > 140 ? '…' : '') + '”' : (o.f.files ? '📷 photo' : ''), item: u && u.item };
  }
  if (o.t === 'item') {
    for (const [k, v] of Object.entries(o.f)) {
      if (k === 'order' || k === 'parent' || k === 'sheet' || k === 'briefPrev' || k === 'briefChangedAt') continue;
      if (k === 'deleted') { parts.push(v ? 'deleted it' : 'restored it'); continue; }
      if (k === 'name') { parts.push(S(p).raw('item', o.id).created === o ? 'added it' : `renamed it “${esc(v)}”`); continue; }
      if (k === 'group') { const g = (S(p).raw('group', v) || {}).f; if (S(p).raw('item', o.id).created !== o) parts.push(`moved it to ${esc(g ? g.name : '?')}`); continue; }
      if (k === 'brief') { parts.push('synced Lisa’s brief'); continue; }
      if (k === 'direction') { parts.push('updated the creative direction'); continue; }
      if (k.startsWith('c_')) {
        const c = (S(p).raw('col', k.slice(2)) || {}).f; if (!c) continue;
        let txt = v;
        if (c.type === 'status') { const l = labelOf(c, v); txt = l ? `<span class="spill sm" style="background:${l.color};color:${textOn(l.color)}">${esc(l.name)}</span>` : 'blank'; parts.push(`set ${esc(c.name)} ${txt}`); continue; }
        if (c.type === 'person') txt = (v || []).join(', ') || 'nobody';
        if (c.type === 'date') txt = fmtDate(v) || 'blank';
        parts.push(`set ${esc(c.name)} → ${esc(txt || 'blank')}`);
      }
    }
    return parts.length ? { verb: parts.join(', '), item: o.id } : null;
  }
  if (o.t === 'event' && o.f.kind === 'ooo') return { verb: `added time off ${esc(fmtDate(o.f.date))}${o.f.end && o.f.end !== o.f.date ? '–' + esc(fmtDate(o.f.end)) : ''}${o.f.person ? ' for ' + esc(o.f.person) : ''}` };
  return null;
}
function renderActivity() {
  const p = cur, st = S(p);
  const ops = st.ops.slice().sort((a, b) => b.ts - a.ts);
  const out = []; let lastDay = '';
  for (const o of ops) {
    if (out.length >= 150) break;
    if (st.name(o.u) === 'Sample data') continue;
    const d = describe(p, o); if (!d) continue;
    let where = '';
    if (d.item) { const it = st.get('item', d.item); if (!it) continue; const top = it.parent ? st.get('item', it.parent) : it; if (!top) continue; where = itemTitle(p, top) + (it.parent ? ' › ' + it.name : ''); d.top = top.id; }
    const day = ymd(new Date(o.ts));
    if (day !== lastDay) { out.push(`<div class="sect">${day === today() ? 'Today' : day === addDays(today(), -1) ? 'Yesterday' : esc(fmtDay(day))}</div>`); lastDay = day; }
    out.push(`<div class="act" ${d.top ? `data-act="item" data-id="${esc(d.top)}"` : ''}>${av(st.name(o.u), 'sm')}<div><div><b>${esc(st.name(o.u))}</b> ${d.verb}</div>
      ${where ? `<div class="small"><span class="where">${esc(where)}</span></div>` : ''}${d.body ? `<div class="small muted">${d.body}</div>` : ''}
      <div class="tiny faint">${esc(new Date(o.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</div></div></div>`);
  }
  $('#main').innerHTML = `<div class="pad"><h1 class="h1">Activity</h1>${out.join('') || '<div class="muted">Nothing yet.</div>'}</div>`;
}

// ---------- item sheet ----------
function openItem(id) { ui.item = id; ui.itab = 'updates'; ui.draft = { text: '', files: [], important: false }; ui.replyTo = null; render(); $('#sheet').scrollTop = 0; }
function closeSheet() { ui.item = null; $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; }
function fieldRow(p, c, it) {
  const v = it['c_' + c.id], ro = !canEdit(c);
  let val;
  if (c.type === 'status') val = spill(labelOf(c, v));
  else if (c.type === 'person') val = (v || []).length ? `<span class="pl">${v.map(n => `<span class="pchip">${av(n, 'xs')}${esc(n.split(' ')[0])}</span>`).join('')}</span>` : '<span class="faint">Nobody</span>';
  else if (c.type === 'date') val = v ? dpill(v, dateDone(p, c, it) || taped(p, it.parent ? S(p).get('item', it.parent) || it : it), dateTone(p, c)) : '<span class="faint">Set date</span>';
  else val = v ? esc(v) : '<span class="faint">—</span>';
  const dateIn = c.type === 'date' && !ro ? `<input type="date" class="overdate" data-date-col="${esc(c.id)}" data-id="${esc(it.id)}" value="${esc(v || '')}">` : '';
  return `<div class="frow ${ro ? 'ro' : ''}" ${ro || c.type === 'date' ? '' : `data-act="edit-field" data-col="${esc(c.id)}" data-id="${esc(it.id)}"`}><span class="fl">${esc(c.name)}${ro ? ' 🔒' : ''}</span><span class="fv">${val}</span>${dateIn}</div>`;
}
function renderSheet() {
  const p = cur, it = S(p).get('item', ui.item);
  if (!it) { closeSheet(); return; }
  const g = S(p).get('group', it.group), col = mainStatus(p);
  const subs = subsOf(p, it.id), ids = new Set([it.id, ...subs.map(s => s.id)]);
  const allU = updsFor(p, ids);
  const lc = leadCol(p);
  const fields = cols(p).filter(c => c !== lc || true);
  let body = '';
  if (ui.itab === 'updates') body = updatesHtml(p, it, allU);
  else if (ui.itab === 'brief') body = briefHtml(p, it);
  else body = historyHtml(p, it, subs);
  const el = $('#sheet');
  const keepScroll = !el.classList.contains('hidden') ? el.scrollTop : 0;
  el.innerHTML = `<div class="sh-top"><button class="back" data-act="close-item"><svg width="12" height="20" viewBox="0 0 12 20"><path d="M10 2L2 10l8 8" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="sh-ttl"><b>${esc(itemTitle(p, it))}</b><span class="small muted"><i class="gdot" style="background:${g ? g.color : '#999'}"></i>${esc(g ? g.name : '')}</span></div></div>
    <div class="sh-body">
      <div class="card fields">${fields.map(c => fieldRow(p, c, it)).join('')}</div>
      ${subs.length ? `<div class="card subs"><div class="ch">Subitems <span class="muted small">${subs.filter(s => isDone(p, s)).length}/${subs.length} done</span></div>${subs.map(s => `<div class="srow"><span class="snm">${esc(s.name)}</span>
        <span class="avs">${assignees(p, s).map(n => av(n, 'xs')).join('')}</span>
        <span ${col && canEdit(col) ? `data-act="edit-field" data-col="${esc(col.id)}" data-id="${esc(s.id)}"` : ''}>${spill(labelOf(col, col && s['c_' + col.id]), true)}</span></div>`).join('')}</div>` : ''}
      <div class="seg">${[['updates', 'Updates' + (allU.length ? ' ' + allU.length : '')], ['brief', 'Brief'], ['history', 'History']].map(([k, n]) => `<button class="${ui.itab === k ? 'on' : ''}" data-act="itab" data-t="${k}">${n}</button>`).join('')}</div>
      ${body}
    </div>`;
  el.classList.remove('hidden');
  el.scrollTop = keepScroll;
}
function composerHtml(key, placeholder) {
  const d = ui.draft;
  return `<div class="card composer">
    <textarea id="upd-text" rows="3" placeholder="${esc(placeholder)}">${esc(d.text)}</textarea>
    ${d.files.length ? `<div class="thumbs">${d.files.map((f, i) => `<div class="th"><img src="${esc(f.url)}"><button data-act="rm-photo" data-i="${i}">✕</button></div>`).join('')}</div>` : ''}
    <div class="crow"><label class="btn ghost small"><input type="file" accept="image/*" multiple data-photo hidden>📷 Photo</label>
      ${key === 'top' ? `<label class="imp"><input type="checkbox" id="upd-imp" ${d.important ? 'checked' : ''}> Important</label>` : ''}
      <span class="spacer"></span>${key !== 'top' ? '<button class="ghost small" data-act="reply-cancel">Cancel</button>' : ''}<button class="primary small" data-act="post" data-key="${esc(key)}">Post</button></div></div>`;
}
function updatesHtml(p, it, allU) {
  const acks = id => S(p).list('ack').filter(a => a.upd === id).map(a => a.who);
  const one = (u, isReply) => {
    const sub = u.item !== it.id ? S(p).get('item', u.item) : null;
    const a = acks(u.id), needAck = u.important && !isMe(p, u._by) && !a.includes(me.name);
    return `<div class="upd ${isReply ? 'reply' : ''} ${u.important ? 'important' : ''}">
      <div class="uh">${av(S(p).name(u._by), 'sm')}<b>${esc(S(p).name(u._by))}</b>${sub ? `<span class="chip">${esc(sub.name)}</span>` : ''}<span class="faint small">${esc(ago(u._at))}</span>
        ${isMe(p, u._by) ? `<span class="spacer"></span><button class="ghost tiny" data-act="del-upd" data-id="${esc(u.id)}">Delete</button>` : ''}</div>
      ${u.important ? `<div class="impbar"><b>Important</b>${needAck ? `<button class="primary tiny" data-act="ack" data-id="${esc(u.id)}">Got it</button>` : ''}<span class="small">${a.length ? 'Seen by ' + a.map(esc).join(', ') : 'Not acknowledged yet'}</span></div>` : ''}
      ${u.text ? `<div class="ut">${linkify(u.text)}</div>` : ''}
      ${(u.files || []).length || (u.refs || []).length ? `<div class="thumbs">${(u.files || []).map(f => mediaThumb(p, f, true)).join('')}${(u.refs || []).map(f => mediaThumb(p, f, false)).join('')}</div>` : ''}
    </div>`;
  };
  const tops = allU.filter(u => !u.parent).sort((a, b) => b._at - a._at);
  const replies = id => allU.filter(u => u.parent === id).sort((a, b) => a._at - b._at);
  return `${ui.replyTo ? '' : composerHtml('top', 'Write an update… @name to ping someone')}
    ${tops.map(u => `<div class="thread">${one(u)}${replies(u.id).map(r => one(r, true)).join('')}
      ${ui.replyTo === u.id ? composerHtml('r:' + u.id, 'Reply…') : `<button class="ghost tiny replybtn" data-act="reply" data-id="${esc(u.id)}">Reply</button>`}</div>`).join('') || '<div class="muted small pad">No updates yet.</div>'}`;
}
// Images load through a temporary link; data-src gets swapped in by hydrate().
function mediaThumb(p, rel, inBoard) {
  const name = rel.split('/').pop();
  if (IMG_RE.test(rel)) return `<div class="th"><img data-src="${esc(rel)}" data-board="${inBoard ? 1 : 0}" data-act="view" alt=""></div>`;
  if (VID_RE.test(rel)) return `<div class="th vid" data-act="play" data-src="${esc(rel)}" data-board="${inBoard ? 1 : 0}"><span>▶</span><small>${esc(name)}</small></div>`;
  return `<div class="th file"><small>${esc(name)}</small></div>`;
}
async function hydrate() {
  for (const img of document.querySelectorAll('img[data-src]:not([src])')) {
    try { img.src = await be.fileUrl(cur, img.dataset.src, img.dataset.board === '1'); } catch { img.alt = 'missing'; img.parentElement.classList.add('missing'); }
  }
}
function briefParts(b) { const out = {}; if (!b) return out; for (const [k] of BRIEF_KEYS) if (b[k]) out[k] = b[k]; for (const [k, v] of Object.entries(b.screens || {})) if (v) out['scr:' + k] = v; return out; }
function briefHtml(p, it) {
  const b = it.brief, prev = it.briefPrev, when = it.briefChangedAt;
  const pp = briefParts(prev), np = briefParts(b);
  const changed = new Set(prev ? [...new Set([...Object.keys(pp), ...Object.keys(np)])].filter(k => (pp[k] || '') !== (np[k] || '')) : []);
  const sec = (label, key, v) => {
    const ch = changed.has(key), was = pp[key];
    if (!v && !(ch && was)) return '';
    return `<div class="bsec ${ch ? 'changed' : ''}"><h5>${esc(label)}${ch ? `<span class="chg">Changed ${esc(fmtDate(ymd(new Date(when))))}</span>` : ''}</h5>
      <div class="btext">${v ? linkify(v) : '<span class="faint">(removed)</span>'}</div>
      ${ch && was ? `<details><summary>What it said before</summary><div class="btext">${linkify(was)}</div></details>` : ''}</div>`;
  };
  return `<div class="card"><div class="ch">Creative direction <span class="faint small">(team)</span></div>
      <textarea id="dir-text" rows="3" placeholder="What we're going for.">${esc(it.direction || '')}</textarea>
      <div style="text-align:right;margin-top:6px"><button class="primary small" data-act="dir-save">Save direction</button></div></div>
    ${b ? `<div class="card"><div class="ch">From Lisa’s grid <span class="faint small">synced ${esc(ago(b.syncedAt || 0))}</span></div>
      ${BRIEF_KEYS.map(([k, l]) => sec(l, k, b[k])).join('')}
      ${[...new Set([...Object.keys(b.screens || {}), ...Object.keys((prev && prev.screens) || {})])].map(k => sec(k, 'scr:' + k, (b.screens || {})[k])).join('')}</div>`
    : '<div class="muted small pad">No brief from Lisa’s grid for this one.</div>'}`;
}
function historyHtml(p, it, subs) {
  const ids = new Set([it.id, ...subs.map(s => s.id)]);
  const ops = S(p).ops.filter(o => o.t === 'item' && ids.has(o.id)).sort((a, b) => b.ts - a.ts).slice(0, 120);
  return `<div class="card">${ops.map(o => { const d = describe(p, o); if (!d) return ''; const sub = o.id !== it.id ? S(p).get('item', o.id) : null;
    return `<div class="hl"><span class="faint tiny">${esc(new Date(o.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span> <b>${esc(S(p).name(o.u))}</b> ${sub ? `<span class="chip">${esc(sub.name)}</span> ` : ''}${d.verb}</div>`; }).join('') || '<div class="muted small">No history.</div>'}</div>`;
}

// ---------- pickers (bottom sheets) ----------
let pickCtx = null;
function showPick(title, html) {
  const el = $('#pick');
  el.innerHTML = `<div class="pick"><div class="grab"></div><div class="pk-h"><b>${esc(title)}</b><span class="spacer"></span><button class="ghost small" data-act="pick-close">Done</button></div><div class="pk-b">${html}</div></div>`;
  el.classList.remove('hidden');
}
function hidePick() { $('#pick').classList.add('hidden'); $('#pick').innerHTML = ''; pickCtx = null; }
function editField(colId, itemId) {
  const p = cur, c = S(p).get('col', colId), it = S(p).get('item', itemId);
  if (!c || !it || !canEdit(c)) return;
  const v = it['c_' + c.id];
  pickCtx = { colId, itemId };
  if (c.type === 'status') return showPick(c.name, `${(c.labels || []).map(l => `<button class="opt" data-act="pick-set" data-v="${esc(l.id)}"><span class="spill" style="background:${l.color};color:${textOn(l.color)}">${esc(l.name)}</span>${v === l.id ? '<span class="tick">✓</span>' : ''}</button>`).join('')}
    <button class="opt" data-act="pick-set" data-v=""><span class="spill empty">Clear</span></button>`);
  if (c.type === 'person') { pickCtx.multi = new Set(v || []); return renderPersonPick(); }
  if (c.type === 'choice') {
    const opts = [...new Set([...(c.options || []), ...items(p).map(i => i['c_' + c.id]).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
    return showPick(c.name, `<div class="addrow"><input id="pk-new" placeholder="Type a new one…"><button class="primary small" data-act="pick-new">Set</button></div>
      ${opts.map(o => `<button class="opt" data-act="pick-set" data-v="${esc(o)}">${esc(o)}${v === o ? '<span class="tick">✓</span>' : ''}</button>`).join('')}
      <button class="opt muted" data-act="pick-set" data-v="">Clear</button>`);
  }
  return showPick(c.name, `<textarea id="pk-text" rows="4">${esc(v || '')}</textarea><div style="text-align:right;margin-top:8px"><button class="primary" data-act="pick-text">Save</button></div>`);
}
function renderPersonPick() {
  const c = S(cur).get('col', pickCtx.colId);
  showPick(c.name, people(cur).map(n => `<button class="opt" data-act="pick-person" data-n="${esc(n)}">${av(n, 'sm')}<span>${esc(n)}</span>${pickCtx.multi.has(n) ? '<span class="tick">✓</span>' : ''}</button>`).join(''));
}
function timeOffSheet(id, day) {
  const e = id ? S(cur).get('event', id) : { person: me.name, date: day || today(), end: '', part: 'all', title: '' };
  pickCtx = { ev: id || null };
  showPick(id ? 'Edit time off' : 'Time off', `<div class="form">
    <label>Who</label><select id="ev-person">${people(cur).map(n => `<option ${e.person === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <div class="two"><div><label>From</label><input type="date" id="ev-date" value="${esc(e.date || '')}"></div><div><label>To (optional)</label><input type="date" id="ev-end" value="${esc(e.end || '')}"></div></div>
    <label>Out</label><div class="segs">${Object.entries({ all: 'All day', am: 'Morning', pm: 'Afternoon' }).map(([k, v]) => `<label><input type="radio" name="ev-part" value="${k}" ${(e.part || 'all') === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <label>Note (optional)</label><input id="ev-title" value="${esc(e.title || '')}" placeholder="e.g. travel, dentist">
    <div class="acts">${id ? '<button class="danger" data-act="ev-del">Delete</button>' : ''}<span class="spacer"></span><button class="primary" data-act="ev-save">Save</button></div></div>`);
}
function settingsSheet() {
  pickCtx = {};
  showPick('Settings', `<div class="form">
    <div class="muted small">Signed in as</div><div style="display:flex;align-items:center;gap:10px;margin:6px 0 14px">${av(me.name, 'lg')}<div><b>${esc(me.name)}</b><div class="small muted" id="acct">${be.kind === 'local' ? 'Local test mode' : 'Dropbox'}</div></div></div>
    <button class="wide" data-act="boards">Switch board</button>
    <button class="wide" data-act="rename-me">Change my name</button>
    <div id="push-row">${pushRowHtml()}</div>
    ${be.kind === 'dropbox' ? `<label>Where the IF_ folders are in Dropbox</label><div class="addrow"><input id="dbx-root" value="${esc(be.root)}" placeholder="(top of Dropbox)"><button class="small" data-act="root-save">Save</button></div>
      <button class="wide danger" data-act="signout">Sign out of Dropbox</button>` : ''}
    <div class="tiny faint" style="margin-top:14px">IFPM phone ${esc(CFG.VERSION || '')} · last synced ${lastSync ? esc(ago(lastSync)) : 'never'}</div></div>`);
  if (be.kind === 'dropbox') be.account().then(a => { const x = $('#acct'); if (x && a.email) x.textContent = 'Dropbox · ' + a.email; }).catch(() => { });
}

// ---------- photos ----------
// Phone photos are big; shrink to 2400px JPEG before uploading (what the desktop shows anyway).
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.86));
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}

// ---------- viewer ----------
function viewImage(src) {
  const v = $('#viewer');
  v.innerHTML = `<img src="${esc(src)}"><button class="vclose" data-act="viewer-close">✕</button>`;
  v.classList.remove('hidden');
}
async function playVideo(rel, inBoard) {
  try { const u = await be.fileUrl(cur, rel, inBoard); const v = $('#viewer'); v.innerHTML = `<video src="${esc(u)}" controls autoplay muted playsinline></video><button class="vclose" data-act="viewer-close">✕</button>`; v.classList.remove('hidden'); }
  catch (e) { toast('Couldn’t open that video'); }
}

// ---------- actions ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) { if (e.target.id === 'pick') hidePick(); return; }
  const d = t.dataset, p = cur;
  switch (d.act) {
    case 'reload': return location.reload();
    case 'signin': return be.startSignIn(false);
    case 'signin-code': e.preventDefault(); $('#codebox').classList.remove('hidden'); return be.startSignIn(true);
    case 'code-go': { const c = $('#code-in').value.trim(); if (!c) return; try { await be.finishSignIn(c); boot(); } catch (err) { screenSignIn(String(err.message || err)); } return; }
    case 'me-save': {
      const n = $('#me-name').value.trim().replace(/\s+/g, ' ');
      if (!n) return;
      me = { id: (me && me.name === n ? me.id : safeName(n) + '_phone_' + Math.random().toString(36).slice(2, 6)), name: n };
      LS.set('me', me); return boot();
    }
    case 'rename-me': hidePick(); me = null; LS.del('me'); return screenName();
    case 'signout': hidePick(); be.signOut(); LS.del('me'); me = null; return screenSignIn();
    case 'root-save': be.root = $('#dbx-root').value.trim().replace(/\/+$/, ''); if (be.root && !be.root.startsWith('/')) be.root = '/' + be.root; LS.set('dbxRoot', be.root); hidePick(); return location.reload();
    case 'menu': return settingsSheet();
    case 'push-on': return pushOn();
    case 'push-on-nudge': dropNudge(); return pushOn();
    case 'push-nudge-x': return dropNudge();
    case 'push-off': return pushOff();
    case 'push-test-info': return toast('The team’s sender computer sends them: new notes and replies on your performances, @mentions, and the daily due reminder.');
    case 'boards': hidePick(); closeSheet(); cur = null; LS.set('last', null); return render();
    case 'open-board': return openBoard(d.p);
    case 'sync-now': toast('Syncing…'); return poll(true);
    case 'tab': ui.tab = d.tab; LS.set('tab', ui.tab); closeSheet(); render(); return window.scrollTo(0, 0);
    case 'filter': ui.filter = ui.filter === d.f && d.f !== 'all' ? 'all' : d.f; return render();
    case 'filter-tab': ui.tab = 'board'; ui.filter = d.f; ui.person = ''; LS.set('tab', 'board'); render(); return window.scrollTo(0, 0);
    case 'status-filter': ui.status = ui.status === d.s ? null : d.s; return render();
    case 'person': ui.tab = 'board'; ui.person = d.n; ui.filter = 'open'; LS.set('tab', 'board'); render(); return window.scrollTo(0, 0);
    case 'person-clear': ui.person = ''; return render();
    case 'show-past': ui.showPast = true; return render();
    case 'ep-toggle': if (filtering()) return; ui.open.has(d.id) ? ui.open.delete(d.id) : ui.open.add(d.id); LS.set('open', [...ui.open]); return render();
    case 'due-day': ui.tab = 'board'; ui.q = ''; ui.filter = 'all'; ui.dueDay = d.d; { const its = items(p).filter(i => !i.parent && dueOf(p, i) === d.d); if (its.length === 1) return openItem(its[0].id); ui.filter = d.d < today() ? 'late' : 'week'; } LS.set('tab', 'board'); render(); return window.scrollTo(0, 0);
    case 'cal-day': ui.calDay = d.d; return render();
    case 'cal-m': { if (d.d === '0') { ui.calMonth = null; ui.calDay = today(); } else { const m = new Date((ui.calMonth || today().slice(0, 7)) + '-15T12:00'); m.setMonth(m.getMonth() + +d.d); ui.calMonth = ymd(m).slice(0, 7); ui.calDay = ui.calMonth + '-01'; } return render(); }
    case 'item': return openItem(d.id);
    case 'close-item': if (history.state && history.state.item) return history.back(); closeSheet(); return render();
    case 'itab': ui.itab = d.t; return renderSheet(), hydrate();
    case 'edit-field': return editField(d.col, d.id);
    case 'pick-close': { const pc = pickCtx; hidePick(); if (pc && pc.multi) { const c = S(p).get('col', pc.colId); const v = [...pc.multi]; await write(p, 'item', pc.itemId, { ['c_' + c.id]: v.length ? v : null }); } return; }
    case 'pick-set': { const pc = pickCtx; hidePick(); await write(p, 'item', pc.itemId, { ['c_' + pc.colId]: d.v || null }); return toast('Saved', true); }
    case 'pick-new': { const v = $('#pk-new').value.trim(); if (!v) return; const pc = pickCtx; hidePick(); await write(p, 'item', pc.itemId, { ['c_' + pc.colId]: v }); return toast('Saved', true); }
    case 'pick-text': { const v = $('#pk-text').value.trim(); const pc = pickCtx; hidePick(); await write(p, 'item', pc.itemId, { ['c_' + pc.colId]: v || null }); return toast('Saved', true); }
    case 'pick-person': pickCtx.multi.has(d.n) ? pickCtx.multi.delete(d.n) : pickCtx.multi.add(d.n); return renderPersonPick();
    case 'undo': { const u = undoLast; undoLast = null; if (!u) return; await writeMany(u.p, u.list, { noUndo: true }); return toast('Undone'); }
    case 'reply': saveDraft(); ui.replyTo = d.id; ui.draft = { text: '', files: [], important: false }; renderSheet(); hydrate(); { const ta = $('#upd-text'); if (ta) ta.focus(); } return;
    case 'reply-cancel': ui.replyTo = null; ui.draft = { text: '', files: [], important: false }; return renderSheet(), hydrate();
    case 'rm-photo': saveDraft(); ui.draft.files.splice(+d.i, 1); return renderSheet(), hydrate();
    case 'post': {
      saveDraft();
      const dr = ui.draft;
      if (!dr.text.trim() && !dr.files.length) return;
      if (dr.files.some(f => !f.rel)) return toast('Photos are still uploading…');
      const f = { item: ui.item, text: dr.text.trim(), via: 'phone' };
      if (dr.files.length) f.files = dr.files.map(x => x.rel);
      if (d.key === 'top' && dr.important) f.important = true;
      if (d.key.startsWith('r:')) f.parent = d.key.slice(2);
      ui.draft = { text: '', files: [], important: false }; ui.replyTo = null;
      await write(p, 'upd', nid(), f, { noUndo: true });
      return toast('Posted');
    }
    case 'del-upd': if (!confirm('Delete this update?')) return; return write(p, 'upd', d.id, { deleted: true });
    case 'ack': return write(p, 'ack', d.id + '|' + me.id, { upd: d.id, who: me.name }, { noUndo: true });
    case 'dir-save': { const v = $('#dir-text').value.trim(); await write(p, 'item', ui.item, { direction: v || null }); return toast('Direction saved', true); }
    case 'view': return viewImage(t.src);
    case 'play': return playVideo(d.src, d.board === '1');
    case 'viewer-close': $('#viewer').classList.add('hidden'); $('#viewer').innerHTML = ''; return;
    case 'ev-new': return timeOffSheet(null, d.d);
    case 'ev-edit': { const ev = S(p).get('event', d.id); if (ev && ev.kind === 'ooo') return timeOffSheet(d.id); return; }
    case 'ev-save': {
      const date = $('#ev-date').value; if (!date) return toast('Pick a date');
      const end = $('#ev-end').value || null;
      const f = { kind: 'ooo', person: $('#ev-person').value || null, date, end: end && end > date ? end : null, part: (document.querySelector('[name=ev-part]:checked') || {}).value || 'all', title: $('#ev-title').value.trim() };
      const id = pickCtx.ev || nid(); hidePick();
      await write(p, 'event', id, f); return toast('Time off saved', true);
    }
    case 'ev-del': { const id = pickCtx.ev; hidePick(); await write(p, 'event', id, { deleted: true }); return toast('Deleted', true); }
  }
});
function saveDraft() {
  const ta = $('#upd-text'); if (ta) ui.draft.text = ta.value;
  const imp = $('#upd-imp'); if (imp) ui.draft.important = imp.checked;
}
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; clearTimeout(ui.qt); ui.qt = setTimeout(() => { const pos = e.target.selectionStart; renderBoard(); hydrate(); const q = $('#q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch { } }, 200); }
  if (e.target.id === 'upd-text') ui.draft.text = e.target.value;
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.dateCol) { await write(cur, 'item', t.dataset.id, { ['c_' + t.dataset.dateCol]: t.value || null }); return toast('Saved', true); }
  if (t.id === 'upd-imp') ui.draft.important = t.checked;
  if (t.matches('[data-photo]') && t.files.length) {
    saveDraft();
    const files = [...t.files]; t.value = '';
    for (const f of files) {
      const entry = { url: URL.createObjectURL(f), rel: null };
      ui.draft.files.push(entry);
      renderSheet(); hydrate();
      try {
        const blob = await shrinkPhoto(f);
        entry.rel = await be.saveNoteFile(cur, ui.item, (f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', blob);
      } catch (err) { ui.draft.files.splice(ui.draft.files.indexOf(entry), 1); toast('Photo didn’t upload: ' + (err.message || err)); }
      renderSheet(); hydrate();
    }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#pick').classList.contains('hidden')) hidePick(); else if (ui.item) { closeSheet(); render(); } } });

// Phone "back" swipe / button closes the item instead of leaving the app.
try { history.scrollRestoration = 'manual'; } catch { }
window.addEventListener('popstate', () => { if (ui.item) { closeSheet(); render(); } });
const _openItem = openItem;
openItem = function (id) { if (!ui.item) history.pushState({ item: id }, ''); _openItem(id); };

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
boot();
