(() => {
'use strict';

const CFG = window.CONFIG;
const BANK = window.BANK;
const SECTIONS = window.SECTIONS;
const BY_ID = Object.fromEntries(BANK.map(q => [q.id, q]));
const SHORT = { fsu: 'ФСУ', eq: 'Уравнения', ar: 'Устный счёт' };
const LETTERS = ['А', 'Б', 'В', 'Г'];
const LS_SESSION = 'algebra_session';
const LIVE_MS = 60000;
const app = document.getElementById('app');

// ───────── утилиты ─────────
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function math(s) {
  return esc(s)
    .replace(/[a-z]/g, '\u0001$&\u0002')
    .replace(/(\d) (?=\d)/g, '$1 ')
    .replace(/-/g, '−')
    .replace(/\*/g, '·')
    .replace(/\^(\d)/g, '<sup>$1</sup>')
    .replace(/\u0001/g, '<i>').replace(/\u0002/g, '</i>');
}
const rich = s => String(s).split('`').map((part, i) => i % 2 ? `<span class="m">${math(part)}</span>` : esc(part)).join('');

function optionHtml(q, k) {
  const v = q.o[k];
  const isNum = /^-?[\d,]+$/.test(v);
  return (q.s === 'eq' || q.chk === 'eq') && isNum ? math('x = ' + v) : math(v);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pad = n => String(n).padStart(2, '0');
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60000);
  return m < 1 ? 'быстрее чем за минуту' : `за ${m} мин`;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Firebase может вернуть массив как объект {"0":…,"1":…} — приводим к массиву
function toArr(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  return Object.keys(v).sort((a, b) => a - b).map(k => v[k]);
}
function normWork(r) {
  if (!r || typeof r !== 'object' || !r.name || !r.qs) return null;
  return { ...r, answers: r.answers || {}, qs: toArr(r.qs).map(x => ({ ...x, o: toArr(x.o) })) };
}

function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ───────── хранилище: Firebase REST или локальный режим ─────────
const SV = { '.sv': 'timestamp' };
const REMOTE = !!CFG.DB_URL;
const PATH = CFG.DB_PATH || 'results';

function setAt(root, path, value) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return value;
  root = (root && typeof root === 'object') ? root : {};
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last]; else node[last] = value;
  return root;
}
function resolveSV(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    const out = Array.isArray(v) ? [] : {};
    for (const k in v) out[k] = resolveSV(v[k]);
    return out;
  }
  return v;
}

const db = REMOTE ? {
  async write(method, path, data) {
    const res = await fetch(`${CFG.DB_URL}/${path}.json`, {
      method, body: data === undefined ? undefined : JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
  put(path, data) { return this.write('PUT', path, data); },
  patch(path, data) { return this.write('PATCH', path, data); },
  del(path) { return this.write('DELETE', path); },
  stream(path, onTree, onStatus) {
    let tree = null;
    const es = new EventSource(`${CFG.DB_URL}/${path}.json`);
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false);
    es.addEventListener('put', e => {
      const { path: p, data } = JSON.parse(e.data);
      tree = setAt(tree, p, data);
      onTree(tree, p);
    });
    es.addEventListener('patch', e => {
      const { path: p, data } = JSON.parse(e.data);
      for (const k in data) tree = setAt(tree, `${p}/${k}`, data[k]);
      onTree(tree, p);
    });
    return () => es.close();
  }
} : {
  // Без Firebase: всё хранится в localStorage этого браузера (для пробы на одном устройстве).
  KEY: 'algebra_local_db',
  listeners: new Set(),
  load() { return lsGet(this.KEY) || {}; },
  save(root) { lsSet(this.KEY, root); this.listeners.forEach(fn => fn()); },
  async put(path, data) { this.save(setAt(this.load(), path, resolveSV(data))); },
  async patch(path, data) {
    let root = this.load();
    for (const k in data) root = setAt(root, `${path}/${k}`, resolveSV(data[k]));
    this.save(root);
  },
  async del(path) { this.save(setAt(this.load(), path, null)); },
  stream(path, onTree, onStatus) {
    const emit = () => onTree(path.split('/').reduce((n, k) => n && n[k], this.load()) || null, '/');
    const onStorage = e => { if (e.key === this.KEY) emit(); };
    window.addEventListener('storage', onStorage);
    this.listeners.add(emit);
    onStatus(true);
    emit();
    return () => { window.removeEventListener('storage', onStorage); this.listeners.delete(emit); };
  }
};

// ───────── модальное окно ввода ─────────
const modal = {
  el: document.getElementById('modal'),
  form: document.getElementById('modal-form'),
  input: document.getElementById('modal-input'),
  error: document.getElementById('modal-error'),
  open({ title, text, placeholder, type = 'text', ok, validate }) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    document.getElementById('modal-ok').textContent = ok;
    this.input.type = type;
    this.input.placeholder = placeholder;
    this.input.value = '';
    this.error.hidden = true;
    this.el.hidden = false;
    setTimeout(() => this.input.focus(), 30);
    return new Promise(resolve => {
      const close = val => {
        this.el.hidden = true;
        this.form.onsubmit = null;
        document.getElementById('modal-cancel').onclick = null;
        this.el.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      document.getElementById('modal-cancel').onclick = () => close(null);
      this.el.onclick = e => { if (e.target === this.el) close(null); };
      this.form.onsubmit = async e => {
        e.preventDefault();
        const val = this.input.value.trim().replace(/\s+/g, ' ');
        const err = await validate(val);
        if (err) {
          this.error.textContent = err;
          this.error.hidden = false;
          this.input.select();
          return;
        }
        close(val);
      };
    });
  }
};

// ───────── запоминание экрана (чтобы при обновлении страницы не выкидывало в начало) ─────────
// sessionStorage живёт, пока открыта вкладка: обновление страницы возвращает на тот же экран,
// а новая вкладка открывает главную (следующий ученик за тем же компьютером не попадёт в чужой тест).
const SS_VIEW = 'algebra_view';
function saveView(v) { try { sessionStorage.setItem(SS_VIEW, JSON.stringify(v)); } catch { /* ignore */ } }
function loadView() { try { return JSON.parse(sessionStorage.getItem(SS_VIEW)) || {}; } catch { return {}; } }
function teacherAuthed() { try { return sessionStorage.getItem('algebra_teacher') === CFG.TEACHER_HASH; } catch { return false; } }

function restore() {
  const v = loadView();
  const s = lsGet(LS_SESSION);
  if ((v.v === 'test' || v.v === 'result') && s) {
    if (!s.finished) return resumeStudent();
    session = s;
    return renderResult();
  }
  if (v.v === 'teacher' && teacherAuthed()) {
    teacher.filter = v.filter || 'all';
    teacher.query = v.query || '';
    return openTeacher({ view: v.tv, sid: v.sid });
  }
  renderHome();
}

// ───────── главный экран ─────────
function renderHome() {
  stopTeacher();
  stopHeartbeat();
  saveView({ v: 'home' });
  const s = lsGet(LS_SESSION);
  const resume = s && !s.finished ? s : null;
  app.className = 'sheet home';
  app.innerHTML = `
    <header class="home-head">
      <h1>Проверочная по алгебре</h1>
      <p class="formula" aria-hidden="true">${math('(a - b)^2 = a^2 - 2ab + b^2')}</p>
      <p class="lead">12 заданий: четыре на формулы сокращённого умножения, четыре на линейные уравнения и четыре на устный счёт.
      На каждое задание — один ответ из четырёх. Выбрать можно только один раз: сразу видно, верно или нет, а при ошибке появится подсказка, как решать.</p>
    </header>
    ${resume ? `
      <div class="resume">
        <p>Незаконченный тест: <b>${esc(resume.name)}</b>, отвечено ${answeredCount(resume)} из ${resume.qs.length}.</p>
        <button class="btn" data-action="resume">Продолжить тест</button>
      </div>` : ''}
    <div class="roles">
      <button class="role" data-action="student">
        <span class="role-name">Ученик</span>
        <span class="role-hint">Ввести фамилию и имя и начать тест</span>
      </button>
      <button class="role" data-action="teacher">
        <span class="role-name">Учитель</span>
        <span class="role-hint">Посмотреть работы учеников — нужен пароль</span>
      </button>
    </div>
    ${REMOTE ? '' : `<p class="note-local">База данных не подключена: результаты сохраняются только в этом браузере. Инструкция по подключению — в README.</p>`}
  `;
}

// ───────── ученик ─────────
let session = null;
let syncTimer = null;
let heartbeat = null;
let syncState = 'ok';

function answeredCount(s) { return Object.keys(s.answers || {}).length; }
function scoreOf(s) { return Object.values(s.answers || {}).filter(a => a && a.ok).length; }

async function startStudent() {
  const s = lsGet(LS_SESSION);
  if (s && !s.finished && !confirm(`Есть незаконченный тест (${s.name}). Начать новый? Старая попытка останется у учителя незавершённой.`)) return;
  const name = await modal.open({
    title: 'Кто проходит тест?',
    text: 'Напишите фамилию и имя — так учитель найдёт вашу работу.',
    placeholder: 'Например, Иванов Пётр',
    ok: 'Начать тест',
    validate: v => v.length < 3 ? 'Напишите фамилию и имя полностью.' : (!/[a-zа-яё]/i.test(v) ? 'Имя должно содержать буквы.' : null)
  });
  if (!name) return;
  const qs = [];
  for (const sec of Object.keys(SECTIONS)) {
    shuffle(BANK.filter(q => q.s === sec)).slice(0, CFG.PER_SECTION)
      .forEach(q => qs.push({ id: q.id, o: shuffle([0, 1, 2, 3]) }));
  }
  session = {
    sid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name, qs, answers: {}, current: 0, finished: false, startedLocal: Date.now()
  };
  lsSet(LS_SESSION, session);
  db.put(`${PATH}/${session.sid}`, {
    name, qs, answers: {}, current: 0, score: 0, answered: 0, total: qs.length,
    startedAt: SV, updatedAt: SV, finishedAt: null
  }).then(() => setSync('ok'), () => { setSync('error'); scheduleSync(); });
  startHeartbeat();
  renderTest();
}

function resumeStudent() {
  session = lsGet(LS_SESSION);
  if (!session) return renderHome();
  startHeartbeat();
  sync();
  renderTest();
}

function setSync(state) {
  syncState = state;
  const el = document.getElementById('sync');
  if (el) {
    el.dataset.state = state;
    el.textContent = state === 'ok' ? 'Ответы сохранены' : state === 'saving' ? 'Сохраняю…' : 'Нет связи — повторю';
  }
}

async function sync() {
  if (!session) return;
  clearTimeout(syncTimer);
  const s = session;
  const data = {
    answers: s.answers, current: s.current, score: scoreOf(s), answered: answeredCount(s),
    updatedAt: SV
  };
  if (s.finished && !s.finishedSent) data.finishedAt = SV;
  // если стартовая запись не дошла — дошлём всё целиком
  data.name = s.name; data.qs = s.qs; data.total = s.qs.length;
  setSync('saving');
  try {
    await db.patch(`${PATH}/${s.sid}`, data);
    if (s.finished) { s.finishedSent = true; lsSet(LS_SESSION, s); }
    setSync('ok');
  } catch {
    setSync('error');
    scheduleSync();
  }
}
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 5000); }

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (!session || session.finished || document.hidden) return;
    db.patch(`${PATH}/${session.sid}`, { updatedAt: SV, current: session.current }).catch(() => {});
  }, 20000);
}
function stopHeartbeat() { clearInterval(heartbeat); heartbeat = null; }

function navHtml(s, current, clickable) {
  const groups = [];
  s.qs.forEach((item, i) => {
    const sec = BY_ID[item.id].s;
    if (!groups.length || groups[groups.length - 1].sec !== sec) groups.push({ sec, items: [] });
    groups[groups.length - 1].items.push(i);
  });
  return `<nav class="qnav" aria-label="Задания">${groups.map(g => `
    <div class="qnav-group">
      <span class="qnav-label">${SHORT[g.sec]}</span>
      <div class="qnav-cells">${g.items.map(i => {
        const a = (s.answers || {})[i];
        const st = a ? (a.ok ? 'ok' : 'bad') : 'none';
        const tag = clickable ? 'button' : 'span';
        return `<${tag} class="cell ${st}${i === current ? ' current' : ''}" ${clickable ? `data-action="go" data-i="${i}"` : ''}
          aria-label="Задание ${i + 1}${a ? (a.ok ? ', верно' : ', ошибка') : ''}">${i + 1}</${tag}>`;
      }).join('')}</div>
    </div>`).join('')}</nav>`;
}

// Задание: вид для ученика (mode='student') и для учителя (mode='teacher')
function questionHtml(s, i, mode) {
  const item = s.qs[i];
  const q = BY_ID[item.id];
  if (!q) return `<section class="task"><p class="muted">Задание ${esc(item.id)} удалено из банка.</p></section>`;
  const a = (s.answers || {})[i];
  const answered = !!a;
  const opts = item.o.map((orig, k) => {
    let cls = 'opt';
    if (answered) {
      if (orig === q.a) cls += ' right';
      if (orig === a.c && !a.ok) cls += ' wrong';
      if (orig === a.c) cls += ' chosen';
    }
    const inner = `<span class="opt-letter">${LETTERS[k]}</span><span class="opt-val">${optionHtml(q, orig)}</span>`;
    return mode === 'student' && !answered
      ? `<button class="${cls}" data-action="answer" data-k="${k}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join('');
  const rightLetter = LETTERS[item.o.indexOf(q.a)];
  let fb = '';
  if (answered && a.ok) {
    fb = `<p class="verdict ok">${mode === 'student' ? 'Верно!' : 'Ответ верный'}</p>`;
  } else if (answered) {
    fb = `<p class="verdict bad">Неверно. Правильный ответ — ${rightLetter}.</p>
          <aside class="hint"><span class="hint-title">Как решать</span>${rich(q.h)}</aside>`;
  } else if (mode === 'teacher') {
    fb = `<p class="verdict none">Ещё не отвечено</p>`;
  }
  return `
    <section class="task${mode === 'teacher' && i === s.current && !s.finishedAt ? ' is-current' : ''}" id="task-${i}">
      <div class="task-margin"><span class="task-num">${i + 1}</span></div>
      <div class="task-body">
        <p class="task-sec">${SECTIONS[q.s]}</p>
        <p class="task-q">${rich(q.q)}:</p>
        <p class="task-x">${math(q.x)}</p>
        <div class="opts">${opts}</div>
        <div class="fb" aria-live="polite">${fb}</div>
      </div>
    </section>`;
}

function renderTest() {
  const s = session;
  if (s.finished) return renderResult();
  const i = s.current;
  const n = s.qs.length;
  const done = answeredCount(s);
  saveView({ v: 'test' });
  app.className = 'sheet test';
  app.innerHTML = `
    <header class="bar">
      <div>
        <p class="bar-name">${esc(s.name)}</p>
        <p class="bar-meta">Отвечено ${done} из ${n}</p>
      </div>
      <p class="sync" id="sync" data-state="${syncState}"></p>
    </header>
    ${navHtml(s, i, true)}
    ${questionHtml(s, i, 'student')}
    <footer class="pager">
      <button class="btn ghost" data-action="prev" ${i === 0 ? 'disabled' : ''}>Назад</button>
      <button class="btn ghost" data-action="next" ${i === n - 1 ? 'disabled' : ''}>Дальше</button>
      <button class="btn finish" data-action="finish">Завершить тест</button>
    </footer>
  `;
  setSync(syncState);
}

function answer(k) {
  const s = session;
  const i = s.current;
  if (s.answers[i]) return;
  const item = s.qs[i];
  const orig = item.o[k];
  s.answers[i] = { c: orig, ok: orig === BY_ID[item.id].a };
  lsSet(LS_SESSION, s);
  sync();
  renderTest();
}

function goTo(i) {
  session.current = Math.max(0, Math.min(session.qs.length - 1, i));
  lsSet(LS_SESSION, session);
  sync();
  renderTest();
  app.querySelector('.task').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function finish() {
  const s = session;
  const left = s.qs.length - answeredCount(s);
  if (left > 0 && !confirm(`Осталось без ответа: ${left} ${plural(left, 'задание', 'задания', 'заданий')}. Всё равно завершить?`)) return;
  if (left === 0 && !confirm('Завершить тест и отправить результат учителю?')) return;
  s.finished = true;
  s.finishedLocal = Date.now();
  lsSet(LS_SESSION, s);
  stopHeartbeat();
  sync();
  renderResult();
}

function renderResult() {
  const s = session;
  const score = scoreOf(s);
  const n = s.qs.length;
  const wrong = s.qs.map((_, i) => i).filter(i => s.answers[i] && !s.answers[i].ok);
  saveView({ v: 'result' });
  app.className = 'sheet result';
  app.innerHTML = `
    <header class="result-head">
      <p class="bar-name">${esc(s.name)}</p>
      <p class="score"><span class="score-num">${score}</span> из ${n}</p>
      <p class="lead">${score === n ? 'Все задания решены верно.' :
        `Верных ответов: ${score}. ${wrong.length ? 'Ниже — задания с ошибками и как их решать.' : ''}`}
        Результат отправлен учителю.</p>
      <p class="sync" id="sync" data-state="${syncState}"></p>
    </header>
    ${navHtml(s, -1, false)}
    ${wrong.map(i => questionHtml(s, i, 'review')).join('')}
    <footer class="pager"><button class="btn ghost" data-action="home">На главную</button></footer>
  `;
  setSync(syncState);
}

// ───────── учитель ─────────
let teacher = { stop: null, tree: null, view: 'list', sid: null, filter: 'all', query: '', seen: {}, online: false, tick: null };

function stopTeacher() {
  if (teacher.stop) teacher.stop();
  clearInterval(teacher.tick);
  teacher.stop = null;
}

async function openTeacher(restoreTo) {
  if (!teacherAuthed()) {
    const pass = await modal.open({
      title: 'Вход для учителя',
      text: 'Введите пароль, чтобы увидеть работы учеников.',
      placeholder: 'Пароль',
      type: 'password',
      ok: 'Войти',
      validate: async v => (await sha256(v)) === CFG.TEACHER_HASH ? null : 'Пароль неверный. Проверьте раскладку и регистр.'
    });
    if (!pass) return;
    try { sessionStorage.setItem('algebra_teacher', CFG.TEACHER_HASH); } catch { /* ignore */ }
  }
  teacher.view = restoreTo && restoreTo.view === 'detail' && restoreTo.sid ? 'detail' : 'list';
  teacher.sid = teacher.view === 'detail' ? restoreTo.sid : null;
  teacher.tree = null;
  teacher.seen = {};
  renderTeacherShell();
  renderTeacherBody();
  teacher.stop = db.stream(PATH, (tree, path) => {
    const sid = path.split('/').filter(Boolean)[0];
    if (sid && teacher.tree) teacher.seen[sid] = Date.now();
    teacher.tree = {};
    for (const [k, v] of Object.entries(tree || {})) { const w = normWork(v); if (w) teacher.tree[k] = w; }
    renderTeacherBody();
  }, online => {
    teacher.online = online;
    const el = document.getElementById('conn');
    if (el) { el.dataset.on = online; el.textContent = online ? 'Обновляется в реальном времени' : 'Нет связи с базой, переподключаюсь…'; }
  });
  teacher.tick = setInterval(renderTeacherBody, 15000);
}

function statusOf(sid, r) {
  if (r.finishedAt) return 'done';
  const last = Math.max(r.updatedAt || 0, teacher.seen[sid] || 0);
  return Date.now() - last < LIVE_MS ? 'live' : 'idle';
}
const STATUS_TEXT = { done: 'Завершил', live: 'Решает сейчас', idle: 'Не завершил' };

function renderTeacherShell() {
  app.className = 'sheet teacher';
  app.innerHTML = `
    <header class="bar">
      <div>
        <p class="bar-name">Работы учеников</p>
        <p class="conn" id="conn" data-on="${teacher.online}">Подключаюсь…</p>
      </div>
      <button class="btn ghost small" data-action="logout">Выйти</button>
    </header>
    <div class="tools" id="tools">
      <input type="search" id="search" placeholder="Поиск по фамилии" value="${esc(teacher.query)}">
      <div class="chips" role="group" aria-label="Фильтр">
        ${[['all', 'Все'], ['live', 'Решают сейчас'], ['done', 'Завершили'], ['idle', 'Не завершили']].map(([k, t]) =>
          `<button class="chip${teacher.filter === k ? ' on' : ''}" data-action="filter" data-f="${k}">${t}</button>`).join('')}
      </div>
    </div>
    <div id="tbody"><p class="empty">Загружаю работы…</p></div>
    ${REMOTE ? '' : `<p class="note-local">База данных не подключена: видны только работы, выполненные в этом браузере.</p>`}
  `;
  document.getElementById('search').addEventListener('input', e => { teacher.query = e.target.value; renderTeacherBody(); });
}

function renderTeacherBody() {
  const body = document.getElementById('tbody');
  saveView({ v: 'teacher', tv: teacher.view, sid: teacher.sid, filter: teacher.filter, query: teacher.query });
  if (!body || teacher.tree === null) return;
  document.getElementById('tools').hidden = teacher.view !== 'list';
  if (teacher.view === 'detail') return renderDetail(body);
  const q = teacher.query.trim().toLowerCase();
  const rows = Object.entries(teacher.tree)
    .map(([sid, r]) => ({ sid, r, st: statusOf(sid, r) }))
    .filter(x => teacher.filter === 'all' || x.st === teacher.filter)
    .filter(x => !q || x.r.name.toLowerCase().includes(q))
    .sort((a, b) => (b.st === 'live') - (a.st === 'live') || (b.r.startedAt || 0) - (a.r.startedAt || 0));
  const total = Object.keys(teacher.tree).length;
  if (!rows.length) {
    body.innerHTML = `<p class="empty">${total ? 'По этому фильтру работ нет.' : 'Работ пока нет. Отправьте ученикам ссылку на тест — их работы появятся здесь, как только они начнут.'}</p>`;
    return;
  }
  body.innerHTML = `<ul class="works">${rows.map(({ sid, r, st }) => {
    const score = r.score || 0, n = r.total || r.qs.length;
    const when = st === 'done'
      ? `Сдал ${fmtDate(r.finishedAt)}${r.startedAt ? `, ${fmtDuration(r.finishedAt - r.startedAt)}` : ''}`
      : st === 'live'
        ? `Начал в ${fmtTime(r.startedAt)}, сейчас на задании ${(r.current || 0) + 1}`
        : `Начал ${fmtDate(r.startedAt)}, не сдал`;
    return `<li><button class="work" data-action="open" data-sid="${esc(sid)}">
      <span class="dot ${st}" title="${STATUS_TEXT[st]}"></span>
      <span class="work-main">
        <span class="work-name">${esc(r.name)}</span>
        <span class="work-when">${when}</span>
      </span>
      <span class="mini" aria-hidden="true">${r.qs.map((_, i) => {
        const a = (r.answers || {})[i];
        return `<i class="${a ? (a.ok ? 'ok' : 'bad') : ''}"></i>`;
      }).join('')}</span>
      <span class="work-score"><b>${score}</b>/${n}</span>
    </button></li>`;
  }).join('')}</ul>`;
}

function renderDetail(body) {
  const r = teacher.tree[teacher.sid];
  if (!r) {
    body.innerHTML = `<p class="empty">Работа удалена.</p><p><button class="btn ghost" data-action="back">К списку работ</button></p>`;
    return;
  }
  const st = statusOf(teacher.sid, r);
  const s = r;
  const n = r.total || r.qs.length;
  const scrollY = window.scrollY;
  body.innerHTML = `
    <div class="detail-head">
      <button class="btn ghost small" data-action="back">К списку работ</button>
      <h2>${esc(r.name)}</h2>
      <p class="detail-status"><span class="dot ${st}"></span>${STATUS_TEXT[st]}${st === 'live' ? ` — на задании ${(r.current || 0) + 1}` : ''}</p>
      <dl class="facts">
        <div><dt>Начал</dt><dd>${fmtDate(r.startedAt)}</dd></div>
        <div><dt>Сдал</dt><dd>${r.finishedAt ? fmtDate(r.finishedAt) : '—'}</dd></div>
        <div><dt>Верно</dt><dd><b>${r.score || 0}</b> из ${n}</dd></div>
        <div><dt>Отвечено</dt><dd>${r.answered || 0} из ${n}</dd></div>
      </dl>
      ${navHtml(s, st === 'live' ? (r.current || 0) : -1, false)}
    </div>
    ${r.qs.map((_, i) => questionHtml(s, i, 'teacher')).join('')}
    <footer class="pager">
      <button class="btn ghost" data-action="back">К списку работ</button>
      <button class="btn danger" data-action="delete">Удалить работу</button>
    </footer>`;
  window.scrollTo(0, scrollY);
}

// ───────── обработка кликов ─────────
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  switch (act) {
    case 'student': return startStudent();
    case 'resume': return resumeStudent();
    case 'teacher': return openTeacher(null);
    case 'home': return renderHome();
    case 'answer': return answer(+b.dataset.k);
    case 'go': return goTo(+b.dataset.i);
    case 'prev': return goTo(session.current - 1);
    case 'next': return goTo(session.current + 1);
    case 'finish': return finish();
    case 'logout':
      try { sessionStorage.removeItem('algebra_teacher'); } catch { /* ignore */ }
      return renderHome();
    case 'filter':
      teacher.filter = b.dataset.f;
      app.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
      return renderTeacherBody();
    case 'open':
      teacher.view = 'detail'; teacher.sid = b.dataset.sid;
      renderTeacherBody();
      return window.scrollTo(0, 0);
    case 'back':
      teacher.view = 'list';
      renderTeacherBody();
      return window.scrollTo(0, 0);
    case 'delete': {
      const r = teacher.tree[teacher.sid];
      if (!r || !confirm(`Удалить работу «${r.name}»? Её нельзя будет восстановить.`)) return;
      try { await db.del(`${PATH}/${teacher.sid}`); } catch { alert('Не удалось удалить: нет связи с базой.'); return; }
      teacher.view = 'list';
      return renderTeacherBody();
    }
  }
});

document.addEventListener('keydown', e => {
  if (!session || !app.classList.contains('test') || !modal.el.hidden || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') goTo(session.current + 1);
  if (e.key === 'ArrowLeft') goTo(session.current - 1);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session && !session.finished && app.classList.contains('test')) sync();
});

restore();
})();
