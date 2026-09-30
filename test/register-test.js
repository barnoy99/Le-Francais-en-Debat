// Register guard for texts/*.md — fails on op-ed vocabulary, phonetic respelling,
// and sentences too long to say in one breath. Run: node test/register-test.js
const fs = require('fs');
const path = require('path');

const BANNED = ['en effet', 'par ailleurs', 'force est de constater', 'il convient de',
  'dès lors', 'nonobstant', "à l'aune de", 'ne saurait', "tant s'en faut"];
const RESPELL = [/\bchuis\b/i, /\bj'sais\b/i, /\bptêt\b/i, /\bj'suis\b/i, /\bt'sais\b/i];
const MAX_WORDS = 32; // read-aloud test: longer than this runs out of breath

const dir = path.join(__dirname, '..', 'texts');
let failures = 0;
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.md'))) {
  const body = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('Corpus') && l !== '---')
    .join(' ').replace(/\*\*[^*]+\*\*/g, '');
  const low = body.toLowerCase().replace(/’/g, "'");
  for (const b of BANNED) if (low.includes(b)) { console.log(`FAIL ${f}: banned "${b}"`); failures++; }
  for (const r of RESPELL) if (r.test(body)) { console.log(`FAIL ${f}: respelling ${r}`); failures++; }
  for (const s of body.split(/(?<=[.!?…])\s+/)) {
    const n = s.trim().split(/\s+/).length;
    if (n > MAX_WORDS) { console.log(`FAIL ${f}: ${n} words: ${s.slice(0, 70)}…`); failures++; }
  }
}
console.log(failures ? `${failures} failure(s)` : 'register OK');
process.exit(failures ? 1 : 0);
