// Scheduler, mastery rule, cross-device merge, Quotidien link. Run: node test/core-test.js
// Simulates real sessions of 2, 5, 20 and 30 minutes over 40 days on the real data.js.
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const { TEXTS, FRAMES } = new Function(src + '; return { TEXTS, FRAMES };')();
const byId = {}; FRAMES.forEach(f => { byId[f.id] = f; });

let failures = 0, checks = 0;
const fail = m => { console.log('FAIL ' + m); failures++; };
const ok = (c, m) => { checks++; if (!c) fail(m); };

// Seeded rng so a failure is reproducible.
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const MIN = Core.MIN, DAY = Core.DAY;
const T0 = new Date(2026, 9, 1, 8, 0, 0).getTime();

// ── Mastery ─────────────────────────────────────────────
function repsOf(list) { return { reps: list.map(([d, t]) => [d, t, 'x', null]), md: 0 }; }
ok(!Core.mastery(repsOf([['d1', 'A'], ['d1', 'B'], ['d1', 'C']])).mastered, 'three topics on ONE day is not mastery');
ok(!Core.mastery(repsOf([['d1', 'A'], ['d2', 'A'], ['d3', 'A']])).mastered, 'three days on ONE topic is not mastery');
ok(!Core.mastery(repsOf([['d1', 'A'], ['d1', 'B'], ['d2', 'A'], ['d3', 'B']])).mastered, 'only two distinct topics across three days is not mastery');
ok(Core.mastery(repsOf([['d1', 'A'], ['d2', 'B'], ['d3', 'C']])).mastered, 'three days × three topics is mastery');
ok(Core.mastery(repsOf([['d1', 'A'], ['d1', 'B'], ['d2', 'A'], ['d3', 'C']])).mastered, 'matching finds d1=B, d2=A, d3=C');
ok(!Core.mastery({ reps: [['d1', 'A', 'x', null], ['d2', 'B', 'x', 'fail'], ['d3', 'C', 'x', null]], md: 0 }).mastered, 'a graded fail does not count');
ok(Core.mastery({ reps: [], md: 5 }).mastered, 'mastered is sticky once stamped');

// ── Mise / recon never count toward mastery ──────────────
{
  const st = Core.defaults();
  const ctx = { now: T0, frames: FRAMES, texts: TEXTS, rng: mulberry(1) };
  ['mise', 'recon', 'mise', 'recon'].forEach((k, i) => {
    ctx.now = T0 + i * DAY;
    Core.commit(st, { kind: k, f: 'f01' }, ctx);
  });
  ok(Core.frameRec(st, 'f01').reps.length === 0 && !Core.mastery(st.frames.f01).mastered, 'mise/recon never produce mastery evidence');
}

// ── Simulation ──────────────────────────────────────────
// A user who shows up: some days, sessions of a random length, every item completed.
function simulate(seed, days, lengthsMin) {
  const rng = mulberry(seed);
  const st = Core.defaults();
  const log = [];
  let now = T0;
  for (let d = 0; d < days; d++) {
    now = T0 + d * DAY + 8 * 3600000;
    const len = lengthsMin[Math.floor(rng() * lengthsMin.length)];
    const end = now + len * MIN;
    const start = now;
    let n = 0;
    while (now < end) {
      const ctx = { now, frames: FRAMES, texts: TEXTS, rng, sessionStart: start, sessionItems: n, qsent: [] };
      const item = Core.next(st, ctx);
      if (!item) { fail('scheduler returned null (day ' + d + ', item ' + n + ')'); return { st, log }; }
      log.push({ d, n, now, item: JSON.parse(JSON.stringify(item)), len });
      Core.commit(st, item, ctx);
      now += Core.EST_SECONDS[item.kind] * 1000;
      n++;
    }
  }
  return { st, log };
}

function textsOf(item) {
  if (item.kind === 'comp') return [item.t];
  return (item.kind === 'chain' ? item.f : [item.f]).map(id => byId[id].textId);
}
function topicOf(item) {
  if (!item.p) return null;
  for (const f of FRAMES) for (const p of f.prompts) if (p.id === item.p) return p.topic;
}

function checkInvariants(name, log, opts) {
  let relaxedItems = 0, lastSeen = {}, prev = null, sessionKey = null;
  let miseRun = 0, maxMiseRun = 0, compRun = 0;
  const promptSeen = {};
  const frameProm = {};
  log.forEach((e, idx) => {
    const it = e.item;
    if (it.relaxed) relaxedItems++;
    const ids = it.kind === 'comp' ? [] : (it.kind === 'chain' ? it.f : [it.f]);
    const strict = !it.relaxed;
    // Frame never twice within 10 minutes (strict items; relaxed ones allow >= 3 min)
    ids.forEach(id => {
      if (lastSeen[id] !== undefined) {
        const gap = e.now - lastSeen[id];
        ok(gap >= 3 * MIN, `${name}: ${id} returned after ${Math.round(gap / 1000)}s (#${idx})`);
        if (strict) ok(gap >= 10 * MIN, `${name}: strict item ${id} returned within 10 min (#${idx})`);
      }
      lastSeen[id] = e.now;
    });
    // Never two frames from the same text consecutively
    if (prev && strict) {
      const a = textsOf(prev.item), b = textsOf(it);
      ok(!a.some(t => b.includes(t)) || it.relaxed >= 5, `${name}: consecutive items share text (#${idx}) ${JSON.stringify(prev.item)} → ${JSON.stringify(it)}`);
    }
    // Never two consecutive same-topic prompts
    if (prev) {
      const ta = topicOf(prev.item), tb = topicOf(it);
      if (ta && tb) ok(ta !== tb, `${name}: same topic twice in a row (#${idx}): ${ta}`);
    }
    // Mise run ≤ 2 unless relaxed
    if (it.kind === 'mise') { miseRun++; if (it.relaxed < 3) maxMiseRun = Math.max(maxMiseRun, miseRun); } else miseRun = 0;
    // Chain: never first in a session, never before 3 min
    if (it.kind === 'chain') {
      ok(e.n >= 4, `${name}: chain as item ${e.n} of a session`);
      const sessionStart = log.filter(x => x.d === e.d)[0].now;
      ok(e.now - sessionStart >= 3 * MIN, `${name}: chain before 3 minutes`);
      const ids2 = it.f;
      ok(byId[ids2[0]].textId !== byId[ids2[1]].textId, `${name}: chain of two frames from one text`);
    }
    // Prompt never from its frame's own corpus; not re-used while a fresh one could be served
    if (it.p) {
      const owner = FRAMES.find(f => f.prompts.some(p => p.id === it.p));
      const prompt = owner.prompts.find(p => p.id === it.p);
      const corpus = TEXTS.find(t => t.id === owner.textId).corpus;
      ok(!((corpus === 'A' && prompt.topic === 'dieu') || (corpus === 'B' && prompt.topic === 'israel')), `${name}: prompt from own corpus`);
      // Prompts are spent by substitution AND by Enchaînement.
      const fid = owner.id;
      frameProm[fid] = frameProm[fid] || {};
      if (frameProm[fid][it.p]) {
        // Allowed only when every unused prompt shares the previous item's topic (never-same-topic-twice wins).
        const prevTopic = prev ? topicOf(prev.item) : null;
        const unused = owner.prompts.filter(p => !frameProm[fid][p.id]);
        ok(unused.every(p => p.topic === prevTopic), `${name}: ${fid} reused ${it.p} while fresh prompts remained`);
      }
      frameProm[fid][it.p] = 1;
    }
    prev = e;
  });
  ok(maxMiseRun <= 2, `${name}: ${maxMiseRun} mises in a row`);
  return relaxedItems;
}

for (const [name, lengths] of [['2-minute', [2]], ['5-minute', [5]], ['20-minute', [20]], ['30-minute', [30]], ['mixed', [2, 5, 8, 12, 20, 30]]]) {
  for (const seed of [1, 2, 3]) {
    const { st, log } = simulate(seed, 40, lengths);
    const relaxed = checkInvariants(`${name}/${seed}`, log);
    ok(log.length > 0, `${name}: nothing served`);
    if (seed === 1) {
      const solid = FRAMES.filter(f => Core.isSolid(Core.frameRec(st, f.id))).length;
      const mastered = FRAMES.filter(f => Core.mastery(Core.frameRec(st, f.id)).mastered).length;
      const counts = {}; log.forEach(e => { counts[e.item.kind] = (counts[e.item.kind] || 0) + 1; });
      console.log(`  ${name.padEnd(9)} 40d: ${String(log.length).padStart(4)} items ${JSON.stringify(counts)}  relaxed ${relaxed}  solid ${solid}  mastered ${mastered}/${FRAMES.length}`);
    }
  }
}

// ── Session shape ───────────────────────────────────────
{
  // Day 1, first two minutes: 3+ genuine items, none of them a chain.
  const { log } = simulate(7, 1, [2]);
  ok(log.length >= 3, `2 minutes should deliver 3+ items, got ${log.length}`);
  ok(!log.some(e => e.item.kind === 'chain'), 'no chain in a 2-minute session');
  // A 30-minute day-1 session must not run dry or loop one item.
  const s30 = simulate(9, 1, [30]);
  ok(s30.log.length >= 30, `30 minutes on day 1 gave only ${s30.log.length} items`);
  const sig = s30.log.map(e => JSON.stringify(e.item)); ok(new Set(sig).size === sig.length, 'a day-1 30-minute session repeated an identical item');
}

// ── New frames are capped per day ───────────────────────
{
  const { log } = simulate(4, 1, [30]);
  const intro = new Set(log.filter(e => e.item.kind === 'mise' && e.item.relaxed < 2).map(e => e.item.f));
  ok(intro.size <= Core.MAX_NEW_PER_DAY, `introduced ${intro.size} new frames in one day under the cap`);
}

// ── Mastery only via three days AND three topics, in a real run ──
{
  const { st, log } = simulate(5, 40, [10]);
  FRAMES.forEach(f => {
    const rec = Core.frameRec(st, f.id);
    if (!rec.md) return;
    const days = new Set(), topics = new Set();
    log.filter(e => e.item.kind === 'sub' && e.item.f === f.id).forEach(e => { days.add(e.d); topics.add(topicOf(e.item)); });
    ok(days.size >= 3 && topics.size >= 3, `${f.id} mastered on ${days.size} days / ${topics.size} topics`);
  });
  // Each rep's topic should be new for the frame while unproven topics remain.
  FRAMES.forEach(f => {
    const reps = Core.frameRec(st, f.id).reps.slice(0, 3);
    if (reps.length === 3) ok(new Set(reps.map(r => r[1])).size === 3, `${f.id}: first three reps not on three topics: ${reps.map(r => r[1])}`);
  });
}

// ── SRS: intervals expand, and yield shortens them ──────
{
  const st = Core.defaults(); const ctx = { now: T0, frames: FRAMES, texts: TEXTS, rng: mulberry(1) };
  const dues = [];
  ['mise', 'recon', 'sub', 'sub', 'sub'].forEach((k, i) => {
    ctx.now = T0 + i * 40 * DAY;
    Core.commit(st, { kind: k, f: 'f01', p: k === 'sub' ? 'f01-' + (i - 1) : undefined }, ctx);
    dues.push((st.frames.f01.due - ctx.now) / DAY);
  });
  ok(dues[3] > dues[2] && dues[4] > dues[3], 'sub intervals should expand: ' + dues.map(x => x.toFixed(1)));
  const hi = FRAMES.find(f => f.yield === 5), lo = FRAMES.find(f => f.yield <= 3);
  const s2 = Core.defaults();
  ctx.now = T0;
  Core.commit(s2, { kind: 'sub', f: hi.id, p: hi.prompts[0].id }, ctx);
  Core.commit(s2, { kind: 'sub', f: lo.id, p: lo.prompts[0].id }, ctx);
  ok(s2.frames[hi.id].due < s2.frames[lo.id].due, 'higher-yield frame should come round sooner');
}

// ── Compréhension cooldown & pool ───────────────────────
{
  const pool = Core.luiPool(TEXTS);
  ok(pool.length === 23, `Compréhension pool should be 23 items (19 Lui + 4 cues), got ${pool.length}`);
  const st = Core.defaults(); let now = T0;
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const ctx = { now, frames: [], texts: TEXTS, rng: mulberry(i), sessionItems: 9, sessionStart: T0 };
    const it = Core.next(st, ctx);
    if (!it) break;
    const key = it.c !== undefined ? 'c' + it.t + ':' + it.c : 'l' + it.t + ':' + it.i;
    ok(!seen.has(key), 'cue repeated inside its cooldown: ' + key);
    seen.add(key);
    Core.commit(st, it, ctx);
    now += MIN;
  }
  ok(seen.size === 23, `expected all 23 cues once, got ${seen.size}`);
  const dialogueCue = Core.luiText(TEXTS, { kind: 'comp', t: 17, i: 0 });
  ok(dialogueCue.model && dialogueCue.model.length > 10, 'dialogue cue has a Moi model answer');
  const mono = Core.luiText(TEXTS, { kind: 'comp', t: 2, c: 0 });
  ok(mono.model === null && mono.fr.length > 5, 'monologue cue has no model answer');
}

// ── Skipping does not count, and does not come straight back ─────
{
  const st = Core.defaults();
  const ctx = { now: T0, frames: FRAMES, texts: TEXTS, rng: mulberry(3) };
  const it = Core.next(st, ctx);
  Core.skip(st, it, ctx);
  ok(st.dayCount === 0 && !Core.frameRec(st, it.f).n, 'a skip is not an exposure');
  const ctx2 = { now: T0 + 5000, frames: FRAMES, texts: TEXTS, rng: mulberry(3) };
  const it2 = Core.next(st, ctx2);
  ok(it2.f !== it.f, 'a skipped frame must not return immediately');
}

// ── Resume: a persisted current item survives a JSON round-trip ──
{
  const st = Core.defaults();
  const ctx = { now: T0, frames: FRAMES, texts: TEXTS, rng: mulberry(3) };
  st.current = Core.next(st, ctx);
  const back = Core.normalize(JSON.parse(JSON.stringify(st)));
  ok(JSON.stringify(back.current) === JSON.stringify(st.current), 'current item round-trips');
}

// ── Quotidien link: both Firebase shapes, nulls, deleted ids ─────
{
  const asArray = { phrases: [null, { level: 4 }, { level: 2 }, { level: 4 }, null, { level: 4 }], deletedIds: [5] };
  const asObject = { phrases: { 1: { level: 4 }, 2: { level: 2 }, 3: { level: 4 }, 5: { level: 4 }, 9: null }, deletedIds: [5] };
  ok(JSON.stringify(Core.masteredIds(asArray)) === '[1,3]', 'array shape: ' + Core.masteredIds(asArray));
  ok(JSON.stringify(Core.masteredIds(asObject)) === '[1,3]', 'object shape: ' + Core.masteredIds(asObject));
  ok(Core.masteredIds(null).length === 0 && Core.masteredIds({}).length === 0, 'missing phrases → empty');
  const qs = Core.quotidienSentences([{ id: 1, fr: 'Plus on y pense, moins on comprend vraiment.', alt_usage: 'Non.' }, { id: 2, fr: 'Une phrase assez longue pour passer le filtre ici.', alt_usage: '' }], [1]);
  ok(qs.length === 1 && qs[0].k === '1:main', 'only mastered, only usable-length sentences');
}

// ── Sync merge ──────────────────────────────────────────
{
  const mk = (updatedAt, sessionCount, tag) => Object.assign(Core.defaults(), { updatedAt, sessionCount, tag });
  ok(Core.pickFreshest(mk(200, 1, 'L'), mk(100, 99, 'C')).tag === 'L', 'newer updatedAt wins even with fewer sessions');
  ok(Core.pickFreshest(mk(100, 99, 'L'), mk(200, 1, 'C')).tag === 'C', 'cloud newer wins');
  ok(Core.pickFreshest(mk(0, 3, 'L'), mk(0, 2, 'C')).tag === 'L', 'sessionCount breaks a stamp tie');
  ok(Core.pickFreshest(mk(5, 1, 'L'), null).tag === 'L', 'no cloud → local');
  ok(Core.pickFreshest(null, mk(5, 1, 'C')).tag === 'C', 'no local → cloud');
  ok(Core.pickFreshest(null, null).version === 1, 'neither → fresh defaults');
  const stripped = Core.normalize({ version: 1, frames: { f01: { reps: undefined, n: 2 } }, hist: [{ kind: 'mise' }] });
  ok(Array.isArray(stripped.frames.f01.reps) && stripped.hist[0].f.length === 0 && stripped.since.chain === 0, 'normalize restores fields Firebase strips');
}

console.log(failures ? `\n${failures} FAILED of ${checks} checks` : `\ncore OK — ${checks} checks`);
process.exit(failures ? 1 : 0);
