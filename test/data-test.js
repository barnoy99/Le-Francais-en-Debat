// Content guard for data.js. Run: node test/data-test.js
// Checks: structure, the anti-futility prompt rules, register, and TEXTS ↔ texts/*.md sync.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const { TEXTS, TOPICS, FRAMES } = new Function(src + '; return { TEXTS, TOPICS, FRAMES };')();

let failures = 0;
const fail = msg => { console.log('FAIL ' + msg); failures++; };

// ── Register (same rules as register-test.js, plus the Quotidien subject-negation rule)
const BANNED = ['en effet', 'par ailleurs', 'force est de constater', 'il convient de',
  'dès lors', 'nonobstant', "à l'aune de", 'ne saurait', "tant s'en faut"];
const RESPELL = [/\bchuis\b/i, /\bj'sais\b/i, /\bptêt\b/i, /\bj'suis\b/i, /\bt'sais\b/i];
const MAX_WORDS = 32;
// `personne` / `rien` / `aucun` as subject keep their `ne` (CORPUS.md in the sibling repo).
// Unicode lookbehind, never \b: \b is ASCII-only and fires inside accented words.
const SUBJ_NEG = /(?<![\p{L}'])(?:(?:^|[.!?:«]\s*)(?:Personne|Rien)|personne(?: d'\p{L}+)?|aucun \p{L}+)\s+(?!ne\b|n'|d')(me|te|se|le|la|les|lui|nous|vous|y|sait|dit|a|est|va|peut|veut|fait|comprend|écoute|lit)\b/u;

function checkRegister(where, s) {
  const low = s.toLowerCase().replace(/’/g, "'");
  for (const b of BANNED) if (low.includes(b)) fail(`${where}: banned "${b}"`);
  for (const r of RESPELL) if (r.test(s)) fail(`${where}: respelling ${r}`);
  if (SUBJ_NEG.test(s)) fail(`${where}: subject negation without ne: ${s.match(SUBJ_NEG)[0]}`);
  for (const sent of s.split(/(?<=[.!?…])\s+/)) {
    const n = sent.trim().split(/\s+/).length;
    if (n > MAX_WORDS) fail(`${where}: ${n} words: ${sent.slice(0, 60)}…`);
  }
}

// ── TEXTS ↔ markdown
function parseMd(file) {
  const raw = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r/g, '');
  return raw.split('\n---\n')[1].split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^\*\*(Lui|Moi) :\*\* (.+)$/);
    return m ? { who: m[1].toLowerCase(), fr: m[2] } : { who: 'moi', fr: l };
  });
}
const textIds = new Set();
for (const t of TEXTS) {
  textIds.add(t.id);
  if (!['A', 'B'].includes(t.corpus)) fail(`text ${t.id}: corpus`);
  if (!fs.existsSync(path.join(root, t.file))) { fail(`text ${t.id}: missing ${t.file}`); continue; }
  const md = parseMd(t.file);
  if (md.length !== t.lines.length) fail(`text ${t.id}: ${t.lines.length} lines in data.js, ${md.length} in ${t.file}`);
  md.forEach((l, i) => {
    const d = t.lines[i];
    if (!d || d.who !== l.who || d.fr !== l.fr) fail(`text ${t.id} line ${i + 1} out of sync with ${t.file}`);
  });
  t.lines.forEach((l, i) => checkRegister(`text ${t.id} line ${i + 1}`, l.fr));
  for (const c of t.cues || []) if (!t.lines.some(l => l.fr.includes(c))) fail(`text ${t.id}: cue not in text: ${c}`);
  if (t.kind === 'monologue' && !(t.cues && t.cues.length)) fail(`text ${t.id}: monologue without cues`);
  if (t.kind === 'dialogue' && !t.lines.some(l => l.who === 'lui')) fail(`text ${t.id}: dialogue without Lui lines`);
}

// ── FRAMES
const corpusOf = Object.fromEntries(TEXTS.map(t => [t.id, t.corpus]));
const HOME_TOPIC = { A: 'dieu', B: 'israel' };
const CROSS_TOPIC = { A: 'israel', B: 'dieu' };
const frameIds = new Set();
const promptIds = new Set();
for (const f of FRAMES) {
  const w = f.id;
  if (!/^f\d{2}$/.test(f.id) || frameIds.has(f.id)) fail(`${w}: bad or duplicate id`);
  frameIds.add(f.id);
  for (const k of ['form', 'gloss', 'gist', 'exemplarFr', 'exemplarEn', 'trap', 'register'])
    if (typeof f[k] !== 'string' || !f[k].trim()) fail(`${w}: missing ${k}`);
  if (!/\{[^}]+\}/.test(f.form)) fail(`${w}: form has no slot`);
  if (!Array.isArray(f.slots) || !f.slots.length) fail(`${w}: no slots`);
  if (!Number.isInteger(f.yield) || f.yield < 1 || f.yield > 5) fail(`${w}: yield`);
  if (!textIds.has(f.textId)) fail(`${w}: unknown textId ${f.textId}`);
  if (!f.sources || !f.sources.includes(f.textId) || f.sources.some(s => !textIds.has(s))) fail(`${w}: sources`);
  checkRegister(`${w} exemplar`, f.exemplarFr);

  const corpus = corpusOf[f.textId];
  const ps = f.prompts || [];
  if (ps.length < 6) fail(`${w}: only ${ps.length} prompts (need 6+)`);
  const topics = ps.map(p => p.topic);
  if (new Set(topics).size < 4) fail(`${w}: fewer than 4 distinct topics`);
  if (topics.includes(HOME_TOPIC[corpus])) fail(`${w}: prompt from its own corpus (${HOME_TOPIC[corpus]})`);
  if (topics.filter(t => t === CROSS_TOPIC[corpus]).length !== 1) fail(`${w}: needs exactly one '${CROSS_TOPIC[corpus]}' prompt`);
  for (const p of ps) {
    if (!p.id.startsWith(f.id + '-') || promptIds.has(p.id)) fail(`${w}: bad or duplicate prompt id ${p.id}`);
    promptIds.add(p.id);
    if (!(p.topic in TOPICS)) fail(`${p.id}: unknown topic ${p.topic}`);
    if (p.fr.includes(f.exemplarFr)) fail(`${p.id}: prompt contains the exemplar`);
    checkRegister(p.id, p.fr);
  }
}

console.log(failures ? `${failures} failure(s)`
  : `data OK — ${TEXTS.length} texts, ${FRAMES.length} frames, ${promptIds.size} prompts`);
process.exit(failures ? 1 : 0);
