// IFPM phone — where the board files come from.
//   Dropbox backend: talks to Dropbox directly from the phone (each person signs into their own Dropbox).
//   Local backend:   the desktop dev server (tools/devserver.js), for testing on this Mac.
// Both expose the same small set of calls, so the UI doesn't care which one it's using.
'use strict';

const BOARD = '.ifboard';
const safeName = s => String(s).replace(/[^\w\-]+/g, '_').slice(0, 60);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('ifpm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ifpm.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('ifpm.' + k); } catch { } },
};

// Turn the text of a log file into ops; only whole lines (a half-synced tail waits for the next read).
function parseLines(text) {
  const last = text.lastIndexOf('\n');
  if (last < 0) return { ops: [], used: 0 };
  const ops = [];
  for (const line of text.slice(0, last).split('\n')) {
    if (!line.trim()) continue;
    try { ops.push(JSON.parse(line)); } catch { }
  }
  return { ops, used: new TextEncoder().encode(text.slice(0, last + 1)).length };
}

// ---------------------------------------------------------------- Dropbox
// Hosts can be pointed at the mock server for testing (tools/mockdropbox.js).
const DBX = Object.assign({
  auth: 'https://www.dropbox.com/oauth2/authorize',
  api: 'https://api.dropboxapi.com',
  content: 'https://content.dropboxapi.com',
}, LS.get('dbxHosts', {}));

function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// Dropbox-API-Arg has to be plain ASCII; escape anything else.
const argHeader = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

class DropboxBackend {
  constructor(appKey) {
    this.kind = 'dropbox';
    this.appKey = appKey;
    this.tok = LS.get('dbxTok', null);           // { access, refresh, exp }
    this.files = {};                              // path -> { off, rev } of log files already read
    this.cursors = {};                            // board -> list_folder cursor of its log folder
    this.links = {};                              // path -> { url, exp } temporary links for images
    this.root = LS.get('dbxRoot', '');            // where the IF_ folders live ('' = top of Dropbox)
  }
  get signedIn() { return !!(this.tok && this.tok.refresh); }
  redirectUri() { return location.origin + location.pathname; }

  // ---- sign-in (PKCE: no secret needed on the phone) ----
  async startSignIn(useCode) {
    const ver = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const chal = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver))));
    LS.set('dbxVerifier', ver);
    LS.set('dbxCodeMode', !!useCode);
    const q = new URLSearchParams({ client_id: this.appKey, response_type: 'code', code_challenge: chal, code_challenge_method: 'S256', token_access_type: 'offline' });
    if (!useCode) q.set('redirect_uri', this.redirectUri());
    const url = DBX.auth + '?' + q;
    if (useCode) window.open(url, '_blank'); else location.href = url;
  }
  // After Dropbox sends the person back with ?code=…  (or they paste the code by hand)
  async finishSignIn(code) {
    const codeMode = LS.get('dbxCodeMode', false);
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: this.appKey, code_verifier: LS.get('dbxVerifier', '') });
    if (!codeMode) body.set('redirect_uri', this.redirectUri());
    const r = await fetch(DBX.api + '/oauth2/token', { method: 'POST', body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || 'Dropbox sign-in failed');
    this.tok = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 14400) * 1000 - 60000 };
    LS.set('dbxTok', this.tok);
    LS.del('dbxVerifier');
  }
  signOut() { this.tok = null; LS.del('dbxTok'); }
  async token() {
    if (!this.tok) throw new Error('Not signed in to Dropbox');
    if (Date.now() < this.tok.exp) return this.tok.access;
    const r = await fetch(DBX.api + '/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tok.refresh, client_id: this.appKey }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { if (r.status === 400 || r.status === 401) { this.signOut(); throw new Error('Dropbox signed you out. Sign in again.'); } throw new Error('Could not reach Dropbox'); }
    this.tok.access = j.access_token; this.tok.exp = Date.now() + (j.expires_in || 14400) * 1000 - 60000;
    LS.set('dbxTok', this.tok);
    return this.tok.access;
  }
  async rpc(ep, args) {
    const r = await fetch(DBX.api + '/2/' + ep, { method: 'POST', headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(args === undefined ? null : args) });
    if (r.status === 409) { const j = await r.json().catch(() => ({})); const e = new Error(j.error_summary || 'Dropbox: not found'); e.dbx = j.error; e.summary = j.error_summary || ''; throw e; }
    if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); return this.rpc(ep, args); }
    if (!r.ok) throw new Error('Dropbox error ' + r.status);
    return r.json();
  }
  async download(path, from) {
    const h = { Authorization: 'Bearer ' + await this.token(), 'Dropbox-API-Arg': argHeader({ path }) };
    if (from) h.Range = 'bytes=' + from + '-';
    const r = await fetch(DBX.content + '/2/files/download', { method: 'POST', headers: h });
    if (r.status === 416) return { text: '', partial: true, rev: null };
    if (r.status === 409) { const e = new Error('not found'); e.summary = 'not_found'; throw e; }
    if (!r.ok && r.status !== 206) throw new Error('Dropbox download error ' + r.status);
    const meta = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}');
    const buf = new Uint8Array(await r.arrayBuffer());
    return { buf, partial: r.status === 206, rev: meta.rev, size: meta.size };
  }
  async upload(path, data, mode) {
    const r = await fetch(DBX.content + '/2/files/upload', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': argHeader({ path, mode: mode || 'add', autorename: false, mute: true }) },
      body: data });
    if (r.status === 409) { const j = await r.json().catch(() => ({})); const e = new Error(j.error_summary || 'conflict'); e.summary = j.error_summary || ''; throw e; }
    if (!r.ok) throw new Error('Dropbox upload error ' + r.status);
    return r.json();
  }
  async listAll(path) {
    let j = await this.rpc('files/list_folder', { path, limit: 2000 });
    const out = [...j.entries];
    while (j.has_more) { j = await this.rpc('files/list_folder/continue', { cursor: j.cursor }); out.push(...j.entries); }
    return { entries: out, cursor: j.cursor };
  }

  async account() { const a = await this.rpc('users/get_current_account'); return { name: a.name && a.name.display_name, email: a.email }; }

  async listProjects() {
    const { entries } = await this.listAll(this.root);
    const ifs = entries.filter(e => e['.tag'] === 'folder' && /^IF_/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const out = await Promise.all(ifs.map(async e => {
      let hasBoard = true;
      try { await this.rpc('files/get_metadata', { path: e.path_lower + '/' + BOARD + '/log' }); } catch { hasBoard = false; }
      return { name: e.name, path: e.path_display, hasBoard };
    }));
    return out;
  }

  // New ops in this board since the last read. Only downloads the part of each log that's new.
  async readLog(p, reset) {
    const dir = p + '/' + BOARD + '/log';
    let changed;
    if (reset || !this.cursors[p]) {
      if (reset) for (const k of Object.keys(this.files)) if (k.startsWith(dir.toLowerCase() + '/')) delete this.files[k];
      const { entries, cursor } = await this.listAll(dir);
      this.cursors[p] = cursor; changed = entries;
    } else {
      changed = [];
      let j = { has_more: true, cursor: this.cursors[p] };
      while (j.has_more) { j = await this.rpc('files/list_folder/continue', { cursor: j.cursor }); changed.push(...j.entries); }
      this.cursors[p] = j.cursor;
    }
    const ops = [];
    for (const e of changed) {
      if (e['.tag'] !== 'file' || !/\.jsonl$/i.test(e.name)) continue;
      const key = e.path_lower, seen = this.files[key] || { off: 0 };
      if (e.size === seen.off) continue;
      let off = e.size < seen.off ? 0 : seen.off;
      let d = await this.download(e.path_lower, off);
      if (!d.partial && off) d = { buf: d.buf.subarray(off), partial: true, rev: d.rev };   // server ignored the range
      if (!d.buf) continue;
      const { ops: got, used } = parseLines(new TextDecoder().decode(d.buf));
      ops.push(...got);
      this.files[key] = { off: off + used, rev: e.rev };
    }
    return ops;
  }

  // This phone's own log: one file only this phone writes, so nobody else ever touches it.
  async appendLog(p, uid, ops) {
    const path = p + '/' + BOARD + '/log/' + safeName(uid) + '.jsonl';
    const add = new TextEncoder().encode(ops.map(o => JSON.stringify(o)).join('\n') + '\n');
    for (let attempt = 0; attempt < 3; attempt++) {
      let old = new Uint8Array(0), rev = null;
      try { const d = await this.download(path); old = d.buf; rev = d.rev; } catch (e) { if (!/not_found/.test(e.summary || '')) throw e; }
      const all = new Uint8Array(old.length + add.length); all.set(old); all.set(add, old.length);
      try {
        await this.upload(path, all, rev ? { '.tag': 'update', update: rev } : 'add');
        return true;
      } catch (e) { if (!/conflict/.test(e.summary || e.message)) throw e; }   // changed underneath us: re-read and retry
    }
    throw new Error('Could not save to Dropbox');
  }

  async fileUrl(p, rel, inBoard) {
    const path = (p + '/' + (inBoard ? BOARD + '/' : '') + rel).replace(/\/+/g, '/');
    const c = this.links[path];
    if (c && c.exp > Date.now()) return c.url;
    const j = await this.rpc('files/get_temporary_link', { path });
    this.links[path] = { url: j.link, exp: Date.now() + 3.5 * 3600 * 1000 };
    return j.link;
  }
  async saveNoteFile(p, itemId, name, blob) {
    const ext = (String(name).match(/\.(png|jpe?g|gif|webp|mp4|mov|m4v|webm)$/i) || ['.jpg'])[0].toLowerCase();
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const fn = stamp + '_' + safeName(String(name).replace(/\.[^.]+$/, '')).slice(0, 40) + ext;
    const rel = 'notes/' + safeName(itemId) + '/' + fn;
    await this.upload(p + '/' + BOARD + '/' + rel, blob, 'add');
    return rel;
  }
  async listAvatars(p) {
    let entries;
    try { entries = (await this.listAll(p + '/' + BOARD + '/avatars')).entries; } catch { return {}; }
    const out = {};
    await Promise.all(entries.filter(e => /\.png$/i.test(e.name)).map(async e => {
      try { out[e.name.slice(0, -4).replace(/_/g, ' ')] = await this.fileUrl(p, 'avatars/' + e.name, true); } catch { }
    }));
    return out;
  }
  async writePresence(p, uid, data) {
    try { await this.upload(p + '/' + BOARD + '/presence/' + safeName(uid) + '.json', new TextEncoder().encode(JSON.stringify(data)), 'overwrite'); } catch { }
  }
  // Phone notifications: the sender computer's public key, and this phone's registration file.
  async pushKeyOf(p) {
    try { const d = await this.download(p + '/' + BOARD + '/push/key.json'); return JSON.parse(new TextDecoder().decode(d.buf)).publicKey || null; } catch { return null; }
  }
  async pushRegister(p, file, obj) { await this.upload(p + '/' + BOARD + '/push/' + file, new TextEncoder().encode(JSON.stringify(obj)), 'overwrite'); return true; }
  async pushUnregister(p, file) { try { await this.rpc('files/delete_v2', { path: p + '/' + BOARD + '/push/' + file }); } catch { } }
}

// ---------------------------------------------------------------- local (desktop dev server, for testing)
class LocalBackend {
  constructor() { this.kind = 'local'; this.signedIn = true; }
  async call(name, ...args) {
    const r = await fetch('/api/' + name, { method: 'POST', body: JSON.stringify(args) }).then(r => r.json());
    if (!r.ok) throw new Error(r.e);
    return r.v;
  }
  async account() { const c = await this.call('getConfig'); return { name: '', email: 'local test (' + c.root + ')' }; }
  async listProjects() { const c = await this.call('getConfig'); return (await this.call('listProjects', c.root)).map(x => ({ name: x.name, path: x.path, hasBoard: x.hasBoard })); }
  readLog(p, reset) { return this.call('readLog', p, !!reset); }
  appendLog(p, uid, ops) { return this.call('appendLog', p, uid, ops); }
  async fileUrl(p, rel, inBoard) { return (inBoard ? '/bfile' : '/pfile') + '?p=' + encodeURIComponent(p) + '&rel=' + encodeURIComponent(rel); }
  async saveNoteFile(p, itemId, name, blob) {
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    return this.call('saveNoteFile', p, itemId, name, b64);
  }
  listAvatars(p) { return this.call('listAvatars', p); }
  writePresence(p, uid, data) { return this.call('writePresence', p, uid, data).catch(() => { }); }
  pushKeyOf(p) { return this.call('pushKeyOf', p); }
  pushRegister(p, file, obj) { return this.call('pushRegister', p, file, obj); }
  pushUnregister(p, file) { return this.call('pushForget', p, file).catch(() => { }); }
}
