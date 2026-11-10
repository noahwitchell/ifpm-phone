// IFPM — board state rebuilt from everyone's change logs.
//
// Every change anyone makes is one small "op": {ts, u, n, w, t, id, f}
//   ts = time, u = user id, n = that user's running count, w = display name
//   t  = entity type (proj | col | group | item | upd), id = entity id
//   f  = the fields this change sets, e.g. {status: "done"}
// Each user only ever appends to their own log file, so Dropbox never has two
// people writing the same file. Every app replays all logs; for each field the
// newest write wins. Same inputs -> same board on every machine.
(function (root) {
  function newer(a, b) {
    if (a.ts !== b.ts) return a.ts > b.ts;
    if (a.u !== b.u) return a.u > b.u;
    return a.n > b.n;
  }
  function cmp(a, b) { return newer(a, b) ? 1 : newer(b, a) ? -1 : 0; }

  class Store {
    constructor() { this.seen = new Set(); this.ents = {}; this.ops = []; this.maxTs = 0; this.names = {}; }
    apply(o) {
      if (!o || !o.t || !o.id || !o.f) return false;
      const k = o.u + '#' + o.n;
      if (this.seen.has(k)) return false;          // duplicates (e.g. conflicted copies) are harmless
      this.seen.add(k);
      this.ops.push(o);
      if (o.ts > this.maxTs) this.maxTs = o.ts;
      if (o.w) this.names[o.u] = o.w;
      const key = o.t + ':' + o.id;
      let e = this.ents[key];
      if (!e) e = this.ents[key] = { t: o.t, id: o.id, f: {}, stamp: {}, created: o };
      if (newer(e.created, o)) e.created = o;
      for (const [f, v] of Object.entries(o.f)) {
        const s = e.stamp[f];
        if (!s || newer(o, s)) { e.f[f] = v; e.stamp[f] = o; }
      }
      return true;
    }
    raw(t, id) { return this.ents[t + ':' + id]; }
    get(t, id) {
      const e = this.raw(t, id);
      if (!e || e.f.deleted) return null;
      return Object.assign({ id: e.id, _by: e.created.u, _at: e.created.ts }, e.f);
    }
    list(t) {
      const out = [];
      for (const e of Object.values(this.ents)) {
        if (e.t === t && !e.f.deleted) out.push(Object.assign({ id: e.id, _by: e.created.u, _at: e.created.ts }, e.f));
      }
      return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a._at - b._at);
    }
    history(id) {
      return this.ops.filter(o => o.id === id || (o.f && o.f.item === id)).sort(cmp);
    }
    lastSeq(u) { let m = 0; for (const o of this.ops) if (o.u === u && o.n > m) m = o.n; return m; }
    name(u) { return this.names[u] || u; }
    users() { return Object.keys(this.names).map(u => ({ id: u, name: this.names[u] })); }
  }

  const api = { Store, newer, cmp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IFState = api;
})(this);
