/* Le Français en Débat — pure logic: scheduler, mastery, sync merge, Quotidien link.
   No DOM, no storage, no network. app.js drives it; test/*.js load it in node.
   (Kept out of app.js so the scheduler can be tested without extracting functions.) */
var Core = (function () {
  'use strict';

  var MIN = 60000, DAY = 86400000;

  // ── Tunables ──────────────────────────────────────────
  var GAP_SAME_FRAME = 10 * MIN;     // a frame never returns within ten minutes
  var GAP_FLOOR = 3 * MIN;           // last-resort gap when nothing else is eligible
  var SUB_DAYS = [1, 3, 7, 14, 30, 60];   // expanding intervals after each substitution
  var MASTERED_FLOOR_DAYS = 30;      // a mastered frame is maintained, not drilled
  var MAX_NEW_PER_DAY = 5;           // frames introduced (first mise) per calendar day
  var MAX_LEARNING = 8;              // introduced frames still under two substitutions
  var LUI_COOLDOWN = 7 * DAY;        // a Compréhension cue rests a week
  var MISE_MAX_RUN = 2;              // never more than two mises in a row
  var CHAIN_MIN_ELAPSED = 3 * MIN;   // Enchaînement only after the session has warmed up
  var CHAIN_MIN_ITEMS = 4;
  var CHAIN_EVERY = 7;               // items between two Enchaînements
  var COMP_EVERY = 5;                // items between two Compréhensions
  var REWARM_AFTER = 21 * DAY;       // a frame untouched this long gets a mise again
  var Q_SHARE = 0.2;                 // share of substitutions fed with a Quotidien sentence
  var HIST_KEEP = 12;
  var REPS_KEEP = 24;

  // Seconds — the app uses these for the countdown, the sim for item length.
  var WINDOW = { mise: 10, recon: 15, sub: 25, chain: 40, comp: 25, reconRepeat: 6 };
  var EST_SECONDS = { mise: 30, recon: 45, sub: 50, chain: 95, comp: 60 };

  var CONNECTORS = ['du coup', "n'empêche", 'cela dit'];

  // ── Dates ─────────────────────────────────────────────

  function dayKey(ts) {
    var d = new Date(ts);
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  function daysBetweenKeys(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((tb - ta) / DAY);
  }

  // ── State ─────────────────────────────────────────────

  function defaults() {
    return { version: 1, updatedAt: 0, sessionCount: 0,
             frames: {},            // id -> frame record (see blankFrame)
             pu: {},                // prompt id -> [uses, lastTs]
             lui: {},               // Compréhension key -> lastTs
             hist: [],              // last HIST_KEEP served items (constraints across sessions)
             since: { chain: 0, comp: 0 },
             current: null,         // the item being served — reopening resumes on it
             dayDate: '', dayCount: 0, dayNew: 0, dayHistory: {},
             cycleSeen: {}, cycleStart: '', cycleNo: 1, cycleLast: 0 };
  }

  // m/r/s = completed mise / reconstruction / substitution. n = every exposure.
  // reps = [dayKey, topic, promptId, verdict] — the mastery evidence (substitutions only).
  function blankFrame() {
    return { m: 0, r: 0, s: 0, n: 0, due: 0, last: 0, reps: [], md: 0 };
  }

  function frameRec(state, id) { return state.frames[id] || blankFrame(); }

  function writeFrame(state, id, changes) {
    var f = state.frames[id] || blankFrame();
    for (var k in changes) f[k] = changes[k];
    state.frames[id] = f;
    return f;
  }

  function rollDay(state, now) {
    var today = dayKey(now);
    if (state.dayDate === today) return;
    if (state.dayDate) {
      state.dayHistory[state.dayDate] = state.dayCount;
      var keys = Object.keys(state.dayHistory).sort();
      while (keys.length > 14) delete state.dayHistory[keys.shift()];
    }
    state.dayDate = today;
    state.dayCount = 0;
    state.dayNew = 0;
  }

  // ── Mastery: the anti-futility rule ───────────────────
  // Mastered = three substitution reps on three separate days AND three different
  // topics, each rep its own day and its own topic (a system of distinct
  // representatives). Three drills on one day, or three on one topic, don't count.
  // Mise / reconstruction never count: they are the source sentence, not new content.

  function countedReps(f) {
    var out = [];
    for (var i = 0; i < (f.reps || []).length; i++) if (f.reps[i][3] !== 'fail') out.push(f.reps[i]);
    return out;
  }

  function mastery(f) {
    var reps = countedReps(f);
    var byDay = {}, topics = {};
    reps.forEach(function (r) {
      (byDay[r[0]] = byDay[r[0]] || {})[r[1]] = 1;
      topics[r[1]] = 1;
    });
    var days = Object.keys(byDay);
    // Kuhn's augmenting-path matching, days -> topics.
    var owner = {};
    function tryDay(d, seen) {
      for (var t in byDay[d]) {
        if (seen[t]) continue;
        seen[t] = 1;
        if (owner[t] === undefined || tryDay(owner[t], seen)) { owner[t] = d; return true; }
      }
      return false;
    }
    var matched = 0;
    days.forEach(function (d) { if (tryDay(d, {})) matched++; });
    return { reps: reps.length, days: days.length, topics: Object.keys(topics).length,
             matched: matched, mastered: !!f.md || matched >= 3 };
  }

  // Enough evidence to be chained: two counted reps on two days (or mastered).
  function isSolid(f) {
    var m = mastery(f);
    return m.mastered || (m.reps >= 2 && m.days >= 2);
  }

  function frameStatus(f) {
    if (!f || !f.n) return 'nouvelle';
    var m = mastery(f);
    if (m.mastered) return 'maîtrisée';
    if (isSolid(f)) return 'solide';
    return 'en cours';
  }

  // ── Scheduling helpers ────────────────────────────────

  function yieldMult(frame) { return 1.4 - 0.1 * (frame.yield || 3); }   // high transfer → comes round sooner

  function nextKind(f, now) {
    if (!f.m) return 'mise';
    if (!f.r) return 'recon';
    if (f.last && now - f.last > REWARM_AFTER) return 'mise';   // re-warm the mouth
    return 'sub';
  }

  // One number ranks everything: how overdue, plus a nudge for yield. A new frame
  // sits just above "due now". Not-yet-due frames score negative, so when the due
  // queue is empty the nearest-to-due frame wins without a second code path.
  function score(frame, f, now) {
    var s = 0.15 * (frame.yield || 3);
    if (!f.n) return s + 0.6;
    return s + (now - f.due) / DAY;
  }

  function pick(list, rng) { return list[Math.floor(rng() * list.length)]; }

  function textsOfItem(item, frames) {
    if (item.kind === 'comp') return [item.t];
    var ids = item.kind === 'chain' ? item.f : [item.f];
    return ids.map(function (id) { return frames[id] ? frames[id].textId : null; });
  }

  // ── Prompts ───────────────────────────────────────────

  // Fresh before repeated, then a topic this frame hasn't been proven on yet
  // (so the three mastery reps land on three topics), then oldest. Never the same
  // topic as the previous item.
  function pickPrompt(state, frames, ids, prevTopic, rng) {
    var cands = [];
    ids.forEach(function (id) {
      var fr = frames[id], rec = frameRec(state, id);
      var seenTopics = {};
      countedReps(rec).forEach(function (r) { seenTopics[r[1]] = 1; });
      (fr.prompts || []).forEach(function (p) {
        var u = state.pu[p.id] || [0, 0];
        cands.push({ p: p, use: u[0], last: u[1], fresh: seenTopics[p.topic] ? 1 : 0, r: rng() });
      });
    });
    var ok = cands.filter(function (c) { return c.p.topic !== prevTopic; });
    if (ok.length) cands = ok;
    cands.sort(function (a, b) {
      return a.use - b.use || a.fresh - b.fresh || a.last - b.last || a.r - b.r;
    });
    return cands.length ? cands[0].p : null;
  }

  function pickQuotidien(state, qsent, prevTopic, rng) {
    if (!qsent || !qsent.length || prevTopic === 'quotidien') return null;
    var best = null, bestKey = null;
    qsent.forEach(function (q) {
      var u = state.pu['q:' + q.k] || [0, 0];
      var key = [u[0], u[1], rng()];
      if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] ||
          (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = q; bestKey = key; }
    });
    return best;
  }

  // ── Compréhension material ────────────────────────────
  // Lui lines of the dialogues, plus the friend's objection quoted inside each
  // monologue. A dialogue's following Moi line is the model answer.

  function luiPool(texts) {
    var out = [];
    texts.forEach(function (t) {
      t.lines.forEach(function (ln, i) {
        if (ln.who === 'lui') out.push({ key: 'l' + t.id + ':' + i, t: t.id, i: i });
      });
      (t.cues || []).forEach(function (c, j) {
        out.push({ key: 'c' + t.id + ':' + j, t: t.id, c: j });
      });
    });
    return out;
  }

  function luiText(texts, item) {
    var t = null;
    texts.forEach(function (x) { if (x.id === item.t) t = x; });
    if (!t) return null;
    if (item.c !== undefined) return { fr: t.cues[item.c], model: null };
    var ln = t.lines[item.i];
    var nxt = t.lines[item.i + 1];
    return { fr: ln.fr, model: nxt && nxt.who === 'moi' ? nxt.fr : null };
  }

  function luiAvailable(state, ctx, prev, avoidText) {
    var out = luiPool(ctx.texts).filter(function (x) {
      return ctx.now - (state.lui[x.key] || 0) >= LUI_COOLDOWN;
    });
    if (avoidText) {
      out = out.filter(function (x) { return avoidText.indexOf(x.t) === -1; });
    }
    return out;
  }

  function buildComp(state, ctx, prev, avoidText) {
    var pool = luiAvailable(state, ctx, prev, avoidText);
    if (!pool.length) return null;
    pool.sort(function (a, b) { return (state.lui[a.key] || 0) - (state.lui[b.key] || 0); });
    var oldest = pool.filter(function (x) { return (state.lui[x.key] || 0) === (state.lui[pool[0].key] || 0); });
    var c = pick(oldest, ctx.rng);
    var item = { kind: 'comp', t: c.t };
    if (c.i !== undefined) item.i = c.i; else item.c = c.c;
    return item;
  }

  // ── The scheduler ─────────────────────────────────────

  function learningCount(state, frames) {
    var n = 0;
    frames.forEach(function (fr) {
      var f = state.frames[fr.id];
      if (f && f.n && f.s < 2 && !f.md) n++;
    });
    return n;
  }

  function usable(fr, ctx) {
    if (!fr.quotidienIds || !fr.quotidienIds.length || !ctx.qmastered) return true;
    for (var i = 0; i < fr.quotidienIds.length; i++) if (!ctx.qmastered[fr.quotidienIds[i]]) return true;
    return false;   // he already owns this one as a phrase in Quotidien
  }

  function buildFrameItem(state, ctx, prev, lv) {
    var now = ctx.now;
    var frames = ctx.frames;
    var gap = lv >= 4 ? GAP_FLOOR : GAP_SAME_FRAME;
    var capNew = lv < 2, miseRun = lv < 3, textRule = lv < 5;
    var miseStreak = 0;
    for (var h = state.hist.length - 1; h >= 0 && state.hist[h].kind === 'mise' && miseStreak < MISE_MAX_RUN; h--) miseStreak++;
    var newOk = !capNew || (state.dayNew < MAX_NEW_PER_DAY && learningCount(state, frames) < MAX_LEARNING);

    var byId = {};
    frames.forEach(function (fr) { byId[fr.id] = fr; });
    var cands = [];
    frames.forEach(function (fr) {
      if (!usable(fr, ctx)) return;
      var f = frameRec(state, fr.id);
      if (lv < 6 && f.last && now - f.last < gap) return;
      if (prev && prev.f && prev.f.indexOf(fr.id) !== -1) return;
      if (textRule && prev && prev.t && prev.t.indexOf(fr.textId) !== -1) return;
      var kind = nextKind(f, now);
      if (!f.n && !newOk) return;
      if (miseRun && kind === 'mise' && miseStreak >= MISE_MAX_RUN) return;
      cands.push({ fr: fr, f: f, kind: kind, sc: score(fr, f, now), r: ctx.rng() });
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return b.sc - a.sc || a.r - b.r; });
    var c = cands[0];
    var item = { kind: c.kind, f: c.fr.id };
    if (c.kind === 'sub') {
      var prevTopic = prev ? prev.topic : null;
      var q = c.f.s >= 1 && ctx.rng() < Q_SHARE ? pickQuotidien(state, ctx.qsent, prevTopic, ctx.rng) : null;
      if (q) { item.q = { k: q.k, fr: q.fr }; }
      else {
        var p = pickPrompt(state, byId, [c.fr.id], prevTopic, ctx.rng);
        if (!p) return null;
        item.p = p.id;
      }
    }
    return item;
  }

  function buildChain(state, ctx, prev, lv) {
    var now = ctx.now;
    var gap = lv >= 4 ? GAP_FLOOR : GAP_SAME_FRAME;
    var cands = [];
    ctx.frames.forEach(function (fr) {
      var f = state.frames[fr.id];
      if (!f || !isSolid(f) || !usable(fr, ctx)) return;
      if (f.last && now - f.last < gap) return;
      if (prev && prev.t && prev.t.indexOf(fr.textId) !== -1) return;
      cands.push({ fr: fr, sc: score(fr, f, now), r: ctx.rng() });
    });
    cands.sort(function (a, b) { return b.sc - a.sc || a.r - b.r; });
    if (!cands.length) return null;
    var first = cands[0].fr, second = null;
    for (var i = 1; i < cands.length; i++) {
      if (cands[i].fr.textId !== first.textId) { second = cands[i].fr; break; }
    }
    if (!second) return null;
    var byId = {}; byId[first.id] = first; byId[second.id] = second;
    var p = pickPrompt(state, byId, [first.id, second.id], prev ? prev.topic : null, ctx.rng);
    if (!p) return null;
    return { kind: 'chain', f: [first.id, second.id], p: p.id };
  }

  function chainDue(state, ctx) {
    return state.since.chain >= CHAIN_EVERY - 1 &&
           (ctx.sessionItems || 0) >= CHAIN_MIN_ITEMS &&
           ctx.now - (ctx.sessionStart || ctx.now) >= CHAIN_MIN_ELAPSED;
  }

  // Returns the next item to serve, or null only when there is no content at all.
  // Relaxation levels (each only when the stricter one finds nothing, so a 30-minute
  // session never runs dry):
  //   0 all rules   1 lift new-frame caps   2 allow long mise runs
  //   3 (reserved)  4 gap 10 → 3 min        5 ignore same-text rule   6 ignore the gap
  function next(state, ctx) {
    ctx.rng = ctx.rng || Math.random;
    ctx.texts = ctx.texts || [];
    rollDay(state, ctx.now);
    var prev = state.hist.length ? state.hist[state.hist.length - 1] : null;
    var item = null, lv;
    for (lv = 0; lv <= 6 && !item; lv++) {
      if (lv === 0) {
        if (chainDue(state, ctx)) item = buildChain(state, ctx, prev, 0);
        if (!item && state.since.comp >= COMP_EVERY && !(prev && prev.kind === 'comp')) {
          item = buildComp(state, ctx, prev, prev ? prev.t : null);
        }
      }
      if (!item) item = buildFrameItem(state, ctx, prev, lv);
      if (!item && lv === 0 && !(prev && prev.kind === 'comp')) item = buildComp(state, ctx, prev, prev ? prev.t : null);
      if (item) item.relaxed = lv;
    }
    if (!item) item = buildComp(state, ctx, prev, null);   // last resort: repeat a cue
    return item;
  }

  // ── Recording what happened ───────────────────────────

  function pushHist(state, item, ctx, now, skipped) {
    var topic = null;
    if (item.p) {
      ctx.frames.forEach(function (fr) {
        (fr.prompts || []).forEach(function (p) { if (p.id === item.p) topic = p.topic; });
      });
    } else if (item.q) topic = 'quotidien';
    var frameIds = item.kind === 'comp' ? [] : (item.kind === 'chain' ? item.f : [item.f]);
    var byId = {};
    ctx.frames.forEach(function (fr) { byId[fr.id] = fr; });
    state.hist.push({ ts: now, kind: item.kind, f: frameIds, t: textsOfItem(item, byId),
                      topic: topic, skipped: skipped ? 1 : 0 });
    while (state.hist.length > HIST_KEEP) state.hist.shift();
  }

  function usePrompt(state, id, now) {
    var u = state.pu[id] || [0, 0];
    state.pu[id] = [u[0] + 1, now];
  }

  function cycleTouch(state, ctx, id, now) {
    if (!state.cycleStart) state.cycleStart = dayKey(now);
    state.cycleSeen[id] = 1;
    var ids = ctx.frames.map(function (fr) { return fr.id; });
    for (var i = 0; i < ids.length; i++) if (!state.cycleSeen[ids[i]]) return;
    state.cycleLast = daysBetweenKeys(state.cycleStart, dayKey(now)) + 1;
    state.cycleNo++;
    state.cycleSeen = {};
    state.cycleStart = dayKey(now);
  }

  function topicOfPrompt(ctx, id) {
    var t = null;
    ctx.frames.forEach(function (fr) {
      (fr.prompts || []).forEach(function (p) { if (p.id === id) t = p.topic; });
    });
    return t;
  }

  // A completed item. `verdict` is null until Phase 4 (STT) can grade it; only
  // 'fail' keeps a substitution from counting toward mastery.
  function commit(state, item, ctx, verdict) {
    var now = ctx.now, byId = {};
    ctx.frames.forEach(function (fr) { byId[fr.id] = fr; });
    rollDay(state, now);
    pushHist(state, item, ctx, now, false);

    if (item.kind === 'comp') {
      var key = item.c !== undefined ? 'c' + item.t + ':' + item.c : 'l' + item.t + ':' + item.i;
      state.lui[key] = now;
    } else {
      var ids = item.kind === 'chain' ? item.f : [item.f];
      ids.forEach(function (id) {
        var fr = byId[id];
        if (!fr) return;
        var f = frameRec(state, id);
        var ch = { n: f.n + 1, last: now };
        if (!f.n) state.dayNew++;
        if (item.kind === 'mise') {
          ch.m = f.m + 1;
          ch.due = f.r ? now + 60 * MIN : now + 20 * MIN;
        } else if (item.kind === 'recon') {
          ch.r = f.r + 1;
          ch.due = now + 6 * 60 * MIN;
        } else if (item.kind === 'sub') {
          ch.s = f.s + 1;
          var days = SUB_DAYS[Math.min(ch.s - 1, SUB_DAYS.length - 1)] * yieldMult(fr);
          ch.due = now + days * DAY;
          var topic = item.q ? 'quotidien' : topicOfPrompt(ctx, item.p);
          var reps = f.reps.slice();
          reps.push([dayKey(now), topic, item.q ? 'q:' + item.q.k : item.p, verdict || null]);
          while (reps.length > REPS_KEEP) reps.shift();
          ch.reps = reps;
        } else if (item.kind === 'chain') {
          ch.due = Math.max(f.due, now + 2 * DAY);
        }
        var rec = writeFrame(state, id, ch);
        if (item.kind === 'sub') {
          var ms = mastery(rec);
          if (ms.matched >= 3 && !rec.md) rec.md = now;
          if (rec.md) rec.due = Math.max(rec.due, now + MASTERED_FLOOR_DAYS * DAY);
        }
        cycleTouch(state, ctx, id, now);
      });
    }
    if (item.p) usePrompt(state, item.p, now);
    if (item.q) usePrompt(state, 'q:' + item.q.k, now);
    state.since.chain = item.kind === 'chain' ? 0 : state.since.chain + 1;
    state.since.comp = item.kind === 'comp' ? 0 : state.since.comp + 1;
    state.dayCount++;
    state.current = null;
  }

  // Skipped or abandoned: nothing counts, but the item must not come straight back.
  function skip(state, item, ctx) {
    var now = ctx.now;
    rollDay(state, now);
    pushHist(state, item, ctx, now, true);
    if (item.kind === 'comp') {
      state.lui[item.c !== undefined ? 'c' + item.t + ':' + item.c : 'l' + item.t + ':' + item.i] = now;
    } else {
      (item.kind === 'chain' ? item.f : [item.f]).forEach(function (id) {
        writeFrame(state, id, { last: now });
      });
    }
    if (item.p) usePrompt(state, item.p, now);
    if (item.q) usePrompt(state, 'q:' + item.q.k, now);
    state.current = null;
  }

  // ── Sync: which copy wins ─────────────────────────────
  // Last write wins by updatedAt (Quotidien's rule); sessionCount only breaks ties
  // for states written before the stamp existed. Ties go to the cloud.

  function isNewer(a, b) {
    var at = a.updatedAt || 0, bt = b.updatedAt || 0;
    if (at !== bt) return at > bt;
    return (a.sessionCount || 0) > (b.sessionCount || 0);
  }

  function pickFreshest(local, cloud) {
    if (!cloud || !cloud.version) return local || defaults();
    if (!local) return cloud;
    return isNewer(local, cloud) ? local : cloud;
  }

  // Firebase strips empty objects/arrays and turns dense integer-keyed objects
  // into arrays; put back what the code indexes without checking.
  function normalize(state) {
    var d = defaults();
    for (var k in d) if (state[k] === undefined || state[k] === null) state[k] = d[k];
    if (!state.since.chain) state.since.chain = 0;
    if (!state.since.comp) state.since.comp = 0;
    for (var id in state.frames) {
      var f = state.frames[id];
      if (!f) { delete state.frames[id]; continue; }
      if (!f.reps) f.reps = [];
      ['m', 'r', 's', 'n', 'due', 'last', 'md'].forEach(function (key) { if (!f[key]) f[key] = 0; });
    }
    if (!Array.isArray(state.hist)) state.hist = [];
    state.hist.forEach(function (h) { if (!h.f) h.f = []; if (!h.t) h.t = []; });
    return state;
  }

  // ── Quotidien link (read-only) ────────────────────────
  // `phrases` comes back from Firebase as an array OR an object depending on how
  // dense the numeric keys are (same for hfPass); entries can be null; ids can
  // linger for phrases since deleted from data.js.

  function masteredIds(progress) {
    var out = [];
    if (!progress || !progress.phrases) return out;
    var deleted = {};
    (progress.deletedIds || []).forEach(function (id) { deleted[id] = 1; });
    var p = progress.phrases;
    function visit(id, rec) {
      if (rec && rec.level === 4 && !deleted[id]) out.push(+id);
    }
    if (Array.isArray(p)) p.forEach(function (rec, i) { visit(i, rec); });
    else Object.keys(p).forEach(function (k) { visit(k, p[k]); });
    return out.sort(function (a, b) { return a - b; });
  }

  // His own mastered sentences, as substitution content. Long ones are dropped:
  // recombining a 25-word sentence inside a 15-second window is not the exercise.
  function quotidienSentences(phrases, ids) {
    var want = {};
    ids.forEach(function (id) { want[id] = 1; });
    var out = [];
    function ok(s) { var n = s.trim().split(/\s+/).length; return n >= 4 && n <= 14; }
    (phrases || []).forEach(function (p) {
      if (!want[p.id]) return;
      if (p.fr && ok(p.fr)) out.push({ k: p.id + ':main', fr: p.fr });
      if (p.alt_usage && ok(p.alt_usage)) out.push({ k: p.id + ':alt', fr: p.alt_usage });
    });
    return out;
  }

  return {
    MIN: MIN, DAY: DAY, WINDOW: WINDOW, EST_SECONDS: EST_SECONDS, CONNECTORS: CONNECTORS,
    GAP_SAME_FRAME: GAP_SAME_FRAME, MAX_NEW_PER_DAY: MAX_NEW_PER_DAY, LUI_COOLDOWN: LUI_COOLDOWN,
    dayKey: dayKey, daysBetweenKeys: daysBetweenKeys,
    defaults: defaults, normalize: normalize, frameRec: frameRec, rollDay: rollDay,
    mastery: mastery, isSolid: isSolid, frameStatus: frameStatus, nextKind: nextKind,
    luiPool: luiPool, luiText: luiText,
    next: next, commit: commit, skip: skip,
    isNewer: isNewer, pickFreshest: pickFreshest,
    masteredIds: masteredIds, quotidienSentences: quotidienSentences
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
