// Text and variation steps, chunks, silent mode, progress per text, variant rotation, cross-device merge. Run: node test/core-test.js
// Walks every text of the real data.js through a first pass and a review pass.
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const { TEXTS, FRAMES, SENTENCES, CHUNKS } = new Function(src + '; return { TEXTS, FRAMES, SENTENCES, CHUNKS };')();
const byId = {}; FRAMES.forEach(f => { byId[f.id] = f; });

let failures = 0, checks = 0;
const fail = m => { console.log('FAIL ' + m); failures++; };
const ok = (c, m) => { checks++; if (!c) fail(m); };

const kinds = steps => steps.map(s => s.t);
const says = steps => steps.filter(s => s.t === 'say');
const turns = steps => steps.filter(s => s.t === 'turn');

const withWho = t => SENTENCES[t.id].map(x => ({ fr: x.fr, en: x.en, f: x.f, who: t.lines[x.l].who }));

// The French is never hidden (v18): no step may hide or mask it.
const neverHidden = steps => steps.every(s => s.t !== 'ui' || (s.v.hideFr === undefined && s.v.mask === undefined));

// ── « Le texte »: one sentence, four times while new, then three ─────
{
  const sent = { fr: "Tu me suis ?", en: "Are you with me?", who: 'moi' };
  const st = Core.textSteps([sent], { size: 1, reads: 3 });
  ok(st[0].t === 'ui' && st[0].v.fr === sent.fr && st[0].v.en === sent.en, 'first step shows French + English');
  ok(says(st).length === Core.REPEAT_SENT && says(st).every(s => s.text === sent.fr && s.lang === 'fr'), 'sentence heard three times in French');
  ok(turns(st).length === Core.REPEAT_SENT, 'three turns to repeat');
  ok(neverHidden(st), 'the French stays on screen');
  ok(st[st.length - 1].t === 'turn', 'ends on his turn');
  ok(!st.some(s => s.t === 'ui' && s.v.phase === 'var'), 'the text part never shows a variation');
  for (const r of [undefined, 0, 1, 2]) {
    const nw = Core.textSteps([sent], { size: 1, reads: r });
    ok(says(nw).length === 4 && turns(nw).length === 4, `reads ${r}: heard and repeated four times`);
  }
}

// ── Readings counted per text ─────────────────────────────
{
  const st = Core.defaults();
  ok(Core.reads(st, 2) === 0, 'no reading yet');
  Core.finishRead(st, 2); Core.finishRead(st, 2);
  ok(Core.reads(st, 2) === 2 && Core.reads(st, 3) === 0, 'readings counted per text');
  const back = Core.normalize(JSON.parse(JSON.stringify({ version: 2, texts: { t2: { pos: 1, done: '1' } } })));
  ok(back.texts.t2.reads === 0, 'normalize adds reads to an old record');
}

// ── « Le texte »: chunk sizes ─────────────────────────────
{
  ok(Core.repeatsFor(1, 3) === 3 && Core.repeatsFor(2, 3) === 3 && Core.repeatsFor(3, 5) === 3 && Core.repeatsFor(0) === 0,
     'repeats: three for every chunk size, whole text listen-only');
  ok(Core.repeatsFor(1, 0) === 4 && Core.repeatsFor(3, 2) === 4 && Core.repeatsFor(0, 0) === 0,
     'repeats: four during the first three readings');
  ok(String(Core.units([{ fr: 'A,' }, { fr: 'b.' }, { fr: 'C.' }])) === '2,1', 'phrase: a comma-split sentence stays whole');
  for (const t of TEXTS) {
    const ss = withWho(t);
    const counts = {};
    for (const n of [1, 2, 3]) {
      const list = Core.chunks(ss, n, CHUNKS[t.id]);
      counts[n] = list.length;
      let covered = 0;
      list.forEach((c, i) => {
        ok(c.from === covered && c.len > 0, `text ${t.id} size ${n}: chunk ${i} follows the last`);
        for (let p = c.from; p < c.from + c.len; p++) ok(Core.chunkIndex(list, p) === i, `text ${t.id} size ${n}: sentence ${p} found in chunk ${i}`);
        covered += c.len;
        const ch = ss.slice(c.from, c.from + c.len);
        for (const r of [0, 3]) {
          const st = Core.textSteps(ch, { size: n, reads: r });
          ok(says(st).length === ch.length * Core.repeatsFor(n, r), `text ${t.id} size ${n}: every sentence said per repeat`);
          ok(turns(st).length === Core.repeatsFor(n, r), `text ${t.id} size ${n}: one turn per repeat`);
        }
      });
      ok(covered === ss.length, `text ${t.id}: size ${n} covers every sentence once`);
    }
    ok(counts[1] > counts[2] && counts[2] > counts[3], `text ${t.id}: phrase > bouchée > passage in count (${counts[1]}/${counts[2]}/${counts[3]})`);
    const all = Core.chunks(ss, 0, CHUNKS[t.id]);
    ok(all.length === 1 && all[0].len === ss.length, `text ${t.id}: « Tout » is one chunk`);
    const whole = ss;
    const st = Core.textSteps(whole, { size: 0 });
    ok(says(st).length === ss.length && turns(st).length === 0, `text ${t.id}: « Tout » = whole text, listen only`);
    const label = Core.chunkText(whole, 'fr');
    ok(t.kind === 'dialogue' ? /^Ton ami : /.test(label) || /^Toi : /.test(label) : !/Toi : /.test(label), `text ${t.id}: speaker labels only in dialogues`);
  }
  const mixed = [{ fr: 'A.', en: 'a', who: 'lui' }, { fr: 'B.', en: 'b', who: 'moi' }, { fr: 'C.', en: 'c', who: 'moi' }];
  ok(Core.chunkText(mixed, 'fr') === 'Ton ami : A.\nToi : B. C.', 'a chunk spanning two speakers: one labelled line per turn');
  ok(Core.chunkText(mixed.slice(1), 'fr') === 'B. C.', 'one speaker: no label');
}

// ── « Les variations »: on their own ──────────────────────
{
  for (const t of TEXTS) {
    const vl = Core.varList(SENTENCES[t.id]);
    const fs = new Set(SENTENCES[t.id].filter(s => s.f).map(s => s.f));
    ok(vl.length === fs.size && vl.length >= 3, `text ${t.id}: one variation per structure (${vl.length})`);
  }
  const v = byId.f02.prompts[0];
  const first = Core.varSteps(v, { review: false });
  const varUi = first.find(s => s.t === 'ui' && s.v.phase === 'var');
  ok(varUi && varUi.v.fr === v.model && varUi.v.en === v.en, 'first time: shown in French + English');
  ok(says(first).filter(s => s.text === v.model).length === Core.REPEAT_VAR && turns(first).length === Core.REPEAT_VAR, 'first time: heard and repeated three times');
  ok(!first.some(s => s.t === 'ui' && s.v.phase === 'sent'), 'a variation comes without the text sentence');

  const back = Core.varSteps(v, { review: true });
  const i0 = back.findIndex(s => s.t === 'ui' && s.v.phase === 'var');
  const iEn = back.findIndex(s => s.t === 'say' && s.lang === 'en');
  const iTry = back.findIndex((s, i) => i > iEn && s.t === 'turn');
  const iModel = back.findIndex(s => s.t === 'say' && s.text === v.model);
  ok(back[iEn].text === v.en, 'review: English cue spoken');
  ok(iEn > i0 && iTry > iEn && iModel > iTry, 'review order: English → his try → model');
  ok(back[iTry].ms >= Core.repeatMs(v.model), 'review: the try window is at least a repeat');
  ok(says(back).filter(s => s.text === v.model).length === Core.REPEAT_VAR && turns(back).length === Core.REPEAT_VAR + 1,
     'review: after his try, the answer heard and repeated three times');
  ok(neverHidden(first) && neverHidden(back), 'variation: the French stays on screen');

  // Separate cursor; each one shown moves the rotation on.
  const st = Core.defaults();
  const vl = Core.varList(SENTENCES[10]);
  vl.forEach((e, i) => Core.completeVar(st, 10, i, e.f));
  ok(Core.varProgress(st, 10, vl.length).finished && st.texts.t10.pos === 0, 'variations finish without moving the text cursor');
  ok(vl.every(e => st.vu[e.f] === 1), 'each structure shown once');
  Core.setVarPos(st, 10, 0);
  ok(!Core.varProgress(st, 10, vl.length).finished, 'restart reopens the variations');
}

// ── « Silencieux »: nothing spoken, French + English shown, one tap ──────
{
  const ss = withWho(TEXTS[0]);
  const st = Core.textSteps(ss.slice(0, 2), { size: 2, silent: true });
  ok(says(st).length === 0, 'silent text: nothing spoken');
  ok(st[0].v.fr && st[0].v.en && turns(st).length === 1 && neverHidden(st), 'silent text: French + English shown, then « Suivant »');
  const vs = Core.varSteps(byId.f02.prompts[0], { review: true, silent: true });
  ok(says(vs).length === 0 && vs[0].v.fr && vs[0].v.en && neverHidden(vs), 'silent variation: French + English, no sound');
}

// ── « Anglais d'abord »: the English once, then the French ×3 with his turns ──
{
  const ss = withWho(TEXTS[0]);
  for (const size of [1, 2, 3, 0]) {
    const ch = ss.slice(0, 3);
    const st = Core.textSteps(ch, { size, reads: 3, enFirst: true });
    const sp = says(st);
    ok(sp.slice(0, ch.length).every((s, i) => s.lang === 'en' && s.text === ch[i].en), `en-first size ${size}: the English first, once`);
    ok(sp.filter(s => s.lang === 'en').length === ch.length, `en-first size ${size}: English said only once`);
    ok(sp.filter(s => s.lang === 'fr').length === 3 * ch.length, `en-first size ${size}: French three times, whatever the size`);
    ok(turns(st).length === 4, `en-first size ${size}: a try after the English, a turn after each French`);
    const firstTurn = st.findIndex(s => s.t === 'turn');
    ok(firstTurn > st.findIndex(s => s.t === 'say' && s.lang === 'en') && firstTurn < st.findIndex(s => s.t === 'say' && s.lang === 'fr') && st[firstTurn].ms >= turns(st)[1].ms,
       `en-first size ${size}: the try comes before the French, at least as long as a repeat`);
    ok(neverHidden(st), `en-first size ${size}: the French stays on screen`);
    const nw = Core.textSteps(ch, { size, reads: 0, enFirst: true });
    ok(says(nw).filter(s => s.lang === 'fr').length === 4 * ch.length && turns(nw).length === 5, `en-first size ${size}: four times while the text is new`);
  }
  const v = byId.f02.prompts[0];
  for (const review of [false, true]) {
    const vs = Core.varSteps(v, { review, enFirst: true });
    const sp = says(vs);
    ok(sp[0].lang === 'en' && sp[0].text === v.en && sp.filter(s => s.lang === 'en').length === 1, 'en-first variation: English once, first');
    ok(sp.filter(s => s.lang === 'fr' && s.text === v.model).length === 3 && turns(vs).length === 4, 'en-first variation: a try, then French ×3, a turn each');
  }
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
  // Frames used in several sentences rotate across them: f02 sits in many texts.
  const f02n = TEXTS.reduce((a, t) => a + SENTENCES[t.id].filter(s => s.f === 'f02').length, 0);
  ok(st.vu.f02 === f02n, 'f02 shown once per sentence carrying it');
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
