// Lesson steps, progress per text, variant rotation, cross-device merge. Run: node test/core-test.js
// Walks every text of the real data.js through a first pass and a review pass.
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const { TEXTS, FRAMES, SENTENCES } = new Function(src + '; return { TEXTS, FRAMES, SENTENCES };')();
const byId = {}; FRAMES.forEach(f => { byId[f.id] = f; });

let failures = 0, checks = 0;
const fail = m => { console.log('FAIL ' + m); failures++; };
const ok = (c, m) => { checks++; if (!c) fail(m); };

const kinds = steps => steps.map(s => s.t);
const says = steps => steps.filter(s => s.t === 'say');
const turns = steps => steps.filter(s => s.t === 'turn');

// ── Steps: a plain sentence ──────────────────────────────
{
  const sent = { fr: "Tu me suis ?", en: "Are you with me?" };
  const st = Core.buildSteps(sent, {});
  ok(st[0].t === 'ui' && st[0].v.fr === sent.fr && st[0].v.en === sent.en && st[0].v.hideFr === false, 'first step shows French + English');
  ok(says(st).length === Core.REPEAT_SENT && says(st).every(s => s.text === sent.fr && s.lang === 'fr'), 'sentence heard three times in French');
  ok(turns(st).length === Core.REPEAT_SENT, 'three turns to repeat');
  const fade = st.findIndex(s => s.t === 'ui' && s.v.hideFr === true);
  const lastSay = st.map(s => s.t).lastIndexOf('say');
  ok(fade > 0 && fade < lastSay, 'French fades before the third hearing');
  ok(st[st.length - 1].t === 'turn', 'ends on his turn');
  ok(!st.some(s => s.t === 'ui' && s.v.phase === 'var'), 'no variation without a frame');
}

// ── Steps: with a variation, first time and on return ────
{
  const f = byId.f02, v = f.prompts[0];
  const sent = SENTENCES[10].find(s => s.f === 'f02');
  const first = Core.buildSteps(sent, { variant: v, review: false });
  const varUi = first.find(s => s.t === 'ui' && s.v.phase === 'var');
  ok(varUi && varUi.v.fr === v.model && varUi.v.en === v.en && varUi.v.hideFr === false, 'first time: variation shown in French + English');
  ok(says(first).filter(s => s.text === v.model).length === Core.REPEAT_VAR, 'first time: variation heard twice');
  ok(!says(first).some(s => s.lang === 'en'), 'first time: no English spoken');
  ok(turns(first).length === Core.REPEAT_SENT + Core.REPEAT_VAR, 'first time: 3 + 2 turns');

  const back = Core.buildSteps(sent, { variant: v, review: true });
  const i0 = back.findIndex(s => s.t === 'ui' && s.v.phase === 'var');
  ok(back[i0].v.hideFr === true, 'review: variation starts with French hidden');
  const iEn = back.findIndex(s => s.t === 'say' && s.lang === 'en');
  const iTry = back.findIndex((s, i) => i > iEn && s.t === 'turn');
  const iReveal = back.findIndex(s => s.t === 'ui' && s.v.hideFr === false && back.indexOf(s) > i0);
  const iModel = back.findIndex(s => s.t === 'say' && s.text === v.model);
  ok(back[iEn].text === v.en, 'review: English cue spoken');
  ok(iEn > i0 && iTry > iEn && iReveal > iTry && iModel > iReveal, 'review order: English → his try → reveal → model');
  ok(back[iTry].ms > Core.repeatMs(v.model), 'review: the try window is longer than a repeat');
  ok(back[back.length - 1].t === 'turn', 'review: ends on his repeat');
}

// ── Windows scale with length ────────────────────────────
ok(Core.repeatMs('un deux trois quatre cinq six') > Core.repeatMs('un deux'), 'longer sentence, longer window');
ok(Core.repeatMs('Tu me suis ?') >= 2500, 'even a short sentence leaves time to repeat');

// ── Variant rotation ─────────────────────────────────────
{
  const st = Core.defaults();
  const f = byId.f02;
  const a = Core.pickVariant(st, f);
  ok(Core.pickVariant(st, f) === a, 'pick does not consume (replay keeps the same variation)');
  Core.complete(st, 10, 0, 'f02');
  const b = Core.pickVariant(st, f);
  ok(b !== a && b === f.prompts[1], 'after completing, the next variation comes');
  for (let i = 0; i < f.prompts.length - 1; i++) Core.complete(st, 10, 0, 'f02');
  ok(Core.pickVariant(st, f) === f.prompts[0], 'rotation wraps around');
  ok(Core.pickVariant(st, null) === null, 'no frame, no variation');
}

// ── Progress: a full first pass and a review pass on every text ──
{
  const st = Core.defaults();
  for (const t of TEXTS) {
    const ss = SENTENCES[t.id];
    let p = Core.progress(st, t.id, ss.length);
    ok(p.pos === 0 && p.done === 0 && !p.finished, `text ${t.id}: starts at 0`);
    ss.forEach((s, i) => {
      ok(!Core.isDone(st, t.id, i), `text ${t.id}: sentence ${i} is new on first pass`);
      const v = s.f ? Core.pickVariant(st, byId[s.f]) : null;
      ok(!s.f || (v && v.model && v.en), `text ${t.id} sentence ${i}: frame gives a variation with English`);
      Core.complete(st, t.id, i, v ? s.f : null);
    });
    p = Core.progress(st, t.id, ss.length);
    ok(p.finished && p.done === ss.length, `text ${t.id}: finished after the last sentence`);
    Core.setPos(st, t.id, 0);
    ok(ss.every((s, i) => Core.isDone(st, t.id, i)), `text ${t.id}: everything is review on the second pass`);
    ok(!Core.progress(st, t.id, ss.length).finished, `text ${t.id}: restart reopens it`);
  }
  // Frames used in several sentences rotate across them: f02 sits in four texts.
  ok(st.vu.f02 === 4, 'f02 shown once per sentence carrying it');
}

// ── Out-of-order completion (⏭ then ⏮) keeps the done string coherent ──
{
  const st = Core.defaults();
  Core.complete(st, 2, 3, null);
  ok(st.texts.t2.done === '0001' && st.texts.t2.pos === 4, 'skipped sentences stay undone');
  Core.complete(st, 2, 1, null);
  ok(st.texts.t2.done === '0101' && st.texts.t2.pos === 2, 'going back marks just that one, cursor follows');
  ok(Core.progress(st, 2, SENTENCES[2].length).done === 2, 'done counts the marks');
}

// ── Merge & normalize ────────────────────────────────────
{
  const a = Core.defaults(); a.updatedAt = 10;
  const b = Core.defaults(); b.updatedAt = 20;
  ok(Core.pickFreshest(a, b) === b && Core.pickFreshest(b, a) === b, 'newest updatedAt wins');
  const c = Core.defaults(); c.updatedAt = 20; c.sessionCount = 5;
  ok(Core.pickFreshest(c, b) === c, 'tie broken by sessionCount');
  ok(Core.pickFreshest(a, null) === a, 'no cloud: local');
  ok(Core.pickFreshest(a, { version: 1, updatedAt: 99 }) === a, 'old-shape cloud state is ignored');
  const stripped = Core.normalize({ version: 2, updatedAt: 1, texts: { t2: { pos: 3 }, t6: null } });
  ok(stripped.vu && typeof stripped.texts.t2.done === 'string' && !('t6' in stripped.texts), 'normalize restores what Firebase strips');
  const round = JSON.parse(JSON.stringify(Core.defaults()));
  ok(Core.normalize(round).texts && Core.normalize(round).vu, 'round-trips through JSON');
}

console.log(failures ? `${failures} failure(s) in ${checks} checks` : `core OK — ${checks} checks`);
process.exit(failures ? 1 : 0);
