// Проверка банка заданий: в каждом задании ровно один верный вариант, он совпадает с полем a.
// Запуск: node tools/verify.js
const fs = require('fs');
const path = require('path');
const window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'questions.js'), 'utf8'));
const BANK = window.BANK;

function toJs(s) {
  let t = s.replace(/−/g, '-').replace(/·|\*/g, '*').replace(/:/g, '/')
    .replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '');
  t = t.replace(/([0-9a-z)])(?=[a-z(])/g, '$1*');
  return t.replace(/\^/g, '**');
}
function evalAt(expr, vars) {
  const names = Object.keys(vars);
  return Function(...names, 'return (' + toJs(expr) + ');')(...names.map(n => vars[n]));
}
const num = s => Number(s.replace(/−/g, '-').replace(',', '.').replace(/\s+/g, ''));
const close = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const SAMPLES = [{ a: 1.3, b: -0.7, x: 2.1, y: -1.9, m: 0.6, n: 3.2 },
                 { a: -2.4, b: 1.1, x: -0.8, y: 2.7, m: -1.5, n: 0.9 },
                 { a: 3.7, b: 2.2, x: 1.6, y: 0.4, m: 2.3, n: -2.6 }];

let errors = 0;
const ids = new Set();
const bySection = {};
for (const q of BANK) {
  const fail = msg => { errors++; console.log(`✗ ${q.id}: ${msg}`); };
  if (ids.has(q.id)) fail('повтор id');
  ids.add(q.id);
  bySection[q.s] = (bySection[q.s] || 0) + 1;
  if (q.o.length !== 4) fail('вариантов не 4');
  if (new Set(q.o).size !== 4) fail('варианты повторяются');
  const chk = q.chk || (q.s === 'eq' ? 'eq' : 'expr');
  let ok;
  if (chk === 'expr') {
    const samples = q.vars ? [q.vars] : SAMPLES;
    ok = q.o.map(opt => samples.every(v => close(evalAt(q.x, v), evalAt(opt, v))));
  } else if (chk === 'eq') {
    const [l, r] = q.x.split('=');
    ok = q.o.map(opt => { const v = { x: num(opt) }; return close(evalAt(l, v), evalAt(r, v)); });
  } else {
    const [l, r] = q.x.split('=');
    const diffs = SAMPLES.map(v => evalAt(l, v) - evalAt(r, v));
    const identity = diffs.every(d => close(d, 0));
    const noRoots = diffs.every(d => close(d, diffs[0]) && !close(d, 0));
    if (chk === 'id' && !identity) fail('не тождество');
    if (chk === 'none' && !noRoots) fail('есть корни');
    const want = chk === 'id' ? 'x — любое число' : 'корней нет';
    ok = q.o.map(opt => opt === want);
  }
  const good = ok.map((v, i) => v ? i : -1).filter(i => i >= 0);
  if (good.length !== 1) fail(`верных вариантов: ${good.length} (${good.map(i => q.o[i]).join(', ')})`);
  else if (good[0] !== q.a) fail(`верный вариант ${good[0]} («${q.o[good[0]]}»), а указан ${q.a}`);
}
console.log('По разделам:', bySection);
const pos = [0, 0, 0, 0];
BANK.forEach(q => pos[q.a]++);
console.log('Позиции верного ответа в данных:', pos);
console.log(errors ? `ОШИБОК: ${errors}` : `Все ${BANK.length} заданий корректны.`);
process.exit(errors ? 1 : 0);
