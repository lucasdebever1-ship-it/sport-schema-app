/* app.js - de hele app: startscherm, kalender, training, mobiliteit, voortgang, instellingen. */

const STORE_KEY = 'schema-app-v1';
const DAY_MS = 86400000;

let state = load();
let view = { name: 'home' };
let restTimer = null;   // { endsAt, total, label }
let mobTimer = null;    // loopt in het mobiliteitsscherm
let tickHandle = null;

/* ================= opslag ================= */

function defaultState() {
  return {
    startDate: dateKey(new Date()),
    goal: null,
    sessions: [],     // afgeronde trainingen
    active: null,     // training die nu bezig is
    warmup: {},       // { '2026-08-19': true }
    swim: {},         // { '2026-W34': true }
    mobility: [],     // [{ date, routine }]
    profile: { naam: '', geboortejaar: '', lengte: '' },
    weights: [],      // [{ date, kg }]
    flags: {},
    settings: { rest1: 180, rest2: 90, sound: true }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = Object.assign(defaultState(), JSON.parse(raw));
      s.settings = Object.assign(defaultState().settings, s.settings || {});
      return s;
    }
  } catch (e) {
    console.warn('Opslag onleesbaar, ik begin opnieuw.', e);
  }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Opslaan lukte niet. Zit je in een privevenster?');
  }
}

/* ================= datums ================= */

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseKey(k) {
  const p = k.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function daysBetween(a, b) { return Math.round((midnight(b) - midnight(a)) / DAY_MS); }
function today() { return new Date(); }
function todayKey() { return dateKey(today()); }
function addDays(d, n) { return new Date(midnight(d) + n * DAY_MS); }

function formatDate(key) {
  const d = parseKey(key);
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
}
function formatLong(key) {
  const d = parseKey(key);
  return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
}
/* Maandag is de eerste dag van de week. */
function mondayOf(d) {
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
}
function weekKey(d) {
  const mon = mondayOf(d);
  const jan1 = new Date(mon.getFullYear(), 0, 1);
  const week = Math.floor(daysBetween(mondayOf(jan1), mon) / 7) + 1;
  return mon.getFullYear() + '-W' + String(week).padStart(2, '0');
}

/* ================= fase en doel ================= */

function pruneGoal() {
  if (state.goal && daysBetween(today(), parseKey(state.goal.date)) < 0) {
    state.goal = null;
    state.flags.triIntroShown = false;
    save();
  }
}
function weeksToGo() {
  if (!state.goal) return null;
  return Math.ceil(daysBetween(today(), parseKey(state.goal.date)) / 7);
}
function currentPhase() {
  const w = weeksToGo();
  return w !== null && w <= TRIATHLON_WEEKS ? 'triathlon' : 'kracht';
}
function triathlonWeek() {
  const w = weeksToGo();
  if (w === null) return 1;
  return Math.min(TRIATHLON_WEEKS, Math.max(1, TRIATHLON_WEEKS - w + 1));
}
function goalLabel(type) {
  const g = GOAL_TYPES.find(x => x.id === type);
  return g ? g.label : type;
}

/* ================= schema ================= */

function schema() { return currentPhase() === 'triathlon' ? SCHEMA_TRIATHLON : SCHEMA_KRACHT; }
function workoutForDate(d) { return schema()[d.getDay()] || null; }
function workoutById(id) {
  const all = Object.values(SCHEMA_KRACHT).concat(Object.values(SCHEMA_TRIATHLON));
  return all.find(w => w.id === id) || null;
}
function nextTrainingDate(from) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (workoutForDate(d)) return d;
  }
  return null;
}
function cardioKm(w) {
  const week = triathlonWeek();
  const b = w.blocks.find(x => week >= x.from && week <= x.to);
  return b ? b.km : w.blocks[w.blocks.length - 1].km;
}
function exKey(name) { return EXERCISE_ALIAS[name] || name; }
function isBigLift(name) { return BIG_LIFTS.indexOf(exKey(name)) !== -1 || BIG_LIFTS.indexOf(name) !== -1; }
function infoFor(name) { return EXERCISE_INFO[exKey(name)] || null; }
function showsStartNote() { return daysBetween(parseKey(state.startDate), today()) < 14; }
function sessionOn(key) { return state.sessions.find(s => s.date === key) || null; }
function warmupDone(key) { return !!state.warmup[key]; }

/* ================= progressie ================= */

/* Alle keren dat je deze oefening deed, oudste eerst. */
function historyFor(name) {
  const key = exKey(name);
  const out = [];
  state.sessions.slice().sort((a, b) => a.ts - b.ts).forEach(s => {
    (s.entries || []).forEach(e => {
      if (exKey(e.name) !== key) return;
      const done = e.sets.filter(x => x.reps > 0);
      if (done.length) out.push({ date: s.date, ts: s.ts, workout: s.workoutId, sets: done });
    });
  });
  return out;
}

function topWeight(sets) { return sets.reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0); }
function totalReps(sets) { return sets.reduce((n, s) => n + (Number(s.reps) || 0), 0); }

/* Wat deed je de vorige keer, bij voorkeur op dezelfde trainingsdag. */
function lastPerformance(name, workoutId) {
  const hist = historyFor(name);
  if (!hist.length) return null;
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i].workout === workoutId) return hist[i];
  return hist[hist.length - 1];
}

/* Dubbele progressie: eerst reps omhoog, dan pas gewicht. */
function advice(ex, workoutId) {
  const hist = historyFor(ex.name).filter(h => h.workout === workoutId);
  if (!hist.length) {
    return { tone: 'new', text: 'Eerste keer, zoek je gewicht.',
             why: 'Pak iets waarmee ' + ex.max + ' reps net niet lukt.' };
  }
  const last = hist[hist.length - 1];
  const w = topWeight(last.sets);

  /* Drie trainingen op rij minder reps betekent deload. */
  if (hist.length >= 4) {
    const t = hist.slice(-4).map(h => totalReps(h.sets));
    if (t[1] < t[0] && t[2] < t[1] && t[3] < t[2]) {
      const nw = Math.round(w * 0.9 * 2) / 2;
      return { tone: 'deload', text: 'Terug naar ' + fmtKg(nw) + ' kg.',
               why: 'Je reps zakken drie keer op rij, dus je bent te moe. Even 10 procent eraf en opnieuw opbouwen.' };
    }
  }

  const allSets = last.sets.length >= ex.sets;
  const allTop = last.sets.every(s => Number(s.reps) >= ex.max);
  if (allSets && allTop) {
    const step = isBigLift(ex.name) ? 5 : 2.5;
    return { tone: 'up', text: 'Omhoog naar ' + fmtKg(w + step) + ' kg.',
             why: 'Vorige keer alle sets op ' + ex.max + ', dus het gewicht mag mee.' };
  }
  return { tone: 'hold', text: fmtKg(w) + ' kg, meer reps.',
           why: 'Eerst alle sets op ' + ex.max + ', daarna pas zwaarder.' };
}

function fmtKg(n) {
  const r = Math.round(n * 10) / 10;
  return String(r).replace('.', ',');
}

/* ================= kleine hulpjes voor de weergave ================= */

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function el(id) { return document.getElementById(id); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M13 16V8M18 16v-3"/></svg>',
  stretch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v5m0 0-4 8m4-8 4 8M6 10h12"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.3 14H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 2.3V2a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 3.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.6 1.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/></svg>'
};

const TABS = [
  { name: 'home', label: 'Start', icon: 'home' },
  { name: 'kalender', label: 'Kalender', icon: 'cal' },
  { name: 'voortgang', label: 'Voortgang', icon: 'chart' },
  { name: 'profiel', label: 'Profiel', icon: 'user' }
];

function topbar(title, sub, rightHtml) {
  return '<header class="topbar"><h1>' + esc(title) +
    (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1>' + (rightHtml || '') + '</header>';
}

function backbar(title, sub) {
  return '<header class="topbar"><button class="iconbtn" data-back="1">' + ICON.back + '</button>' +
    '<h1>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1></header>';
}

function renderTabs() {
  el('tabs').innerHTML = TABS.map(t =>
    '<button class="tab' + (view.name === t.name ? ' active' : '') + '" data-tab="' + t.name + '">' +
    ICON[t.icon] + '<span>' + t.label + '</span></button>'
  ).join('');
}

function go(name, params) {
  view = Object.assign({ name: name }, params || {});
  render();
}

/* ================= startscherm ================= */

/* Wat er deze week gepland stond en wat je ervan gedaan hebt. */
function weekPlan() {
  const mon = mondayOf(today());
  const dezeWeek = state.sessions.filter(s => {
    const x = daysBetween(mon, parseKey(s.date));
    return x >= 0 && x < 7;
  });
  const dagen = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const k = dateKey(d);
    const w = workoutForDate(d);
    const sessie = sessionOn(k);
    /* Deed je die training deze week op een andere dag, dan is hij ook af. */
    const elders = w && !sessie && dezeWeek.some(s => s.workoutId === w.id);
    let status;
    if (sessie) status = 'gedaan';
    else if (elders) status = 'ingehaald';
    else if (!w) status = HOCKEY_DAYS[d.getDay()] ? 'hockey' : 'leeg';
    else if (k === todayKey()) status = 'vandaag';
    else if (daysBetween(d, today()) > 0) status = 'gemist';
    else status = 'komt';
    dagen.push({ date: k, dag: d, workout: w, sessie: sessie, status: status });
  }
  return {
    dagen: dagen,
    gepland: dagen.filter(x => x.workout).length,
    gedaan: dagen.filter(x => x.status === 'gedaan' || x.status === 'ingehaald').length,
    gemist: dagen.filter(x => x.status === 'gemist')
  };
}

function heroCard() {
  const d = today();
  const k = todayKey();
  const w = workoutForDate(d);
  const done = sessionOn(k);
  const busy = state.active;

  if (busy) {
    const bw = workoutById(busy.workoutId);
    const gedaan = (busy.entries || []).filter(entryDone).length;
    return card('accent', 'Bezig',
      busy.title,
      (busy.date === k ? 'Vandaag' : formatDate(busy.date)) +
      (bw && bw.type === 'gym' ? ', ' + gedaan + ' van ' + bw.exercises.length + ' oefeningen gedaan' : ''),
      '<button class="btn accent" data-resume="1">Verder gaan</button>' +
      '<button class="btn ghost dim slim" data-cancel="1">Weggooien</button>');
  }

  if (done) {
    return card('accent', 'Klaar voor vandaag',
      done.title,
      sessionSummaryLine(done) + (done.note ? '. ' + done.note : ''),
      '<button class="btn ghost" data-open-session="' + done.id + '">Bekijken</button>');
  }

  if (!w) {
    const nd = nextTrainingDate(d);
    const nw = workoutForDate(nd);
    const wanneer = daysBetween(d, nd) === 1 ? 'morgen' : 'op ' + DAY_NAMES[nd.getDay()];
    return card('', HOCKEY_DAYS[d.getDay()] || 'Vrij',
      'Geen gym vandaag',
      'Volgende is ' + nw.title + ', ' + wanneer + '.',
      '<button class="btn" data-tab-mob="1">Mobiliteit doen</button>' +
      '<button class="btn ghost dim slim" data-choose="' + k + '">Toch trainen</button>');
  }

  let onder = '';
  if (w.type === 'gym') {
    const sets = w.exercises.reduce((n, e) => n + e.sets, 0);
    onder = w.exercises.length + ' oefeningen, ' + sets + ' sets';
    if (!warmupDone(k)) onder += ', warming-up nog niet gedaan';
  } else {
    onder = cardioKm(w) + ' km ' + w.sport + ', rustig tempo';
  }
  const extra = (w.startNote && showsStartNote()) ? '<div class="note">' + esc(w.startNote) + '</div>' : '';
  return card('accent', 'Vandaag', w.title, onder,
    extra + '<button class="btn accent" data-start="' + w.id + '">Beginnen</button>' +
    '<button class="btn ghost dim slim" data-choose="' + k + '">Andere training</button>');
}

/* Kaartje met een label, een titel, een regel eronder en knoppen. */
function card(soort, label, titel, onder, knoppen) {
  return '<div class="card ' + soort + '">' +
    (label ? '<span class="pill' + (soort === 'accent' ? '' : ' grey') + '">' + esc(label) + '</span>' : '') +
    '<h2 class="hero-title">' + esc(titel) + '</h2>' +
    (onder ? '<p class="dim small">' + esc(onder) + '</p>' : '') +
    (knoppen || '') + '</div>';
}

function weekStrip(plan) {
  return '<div class="calgrid">' + plan.dagen.map(x => {
    const isToday = x.date === todayKey();
    let cls = 'day' + (x.status === 'gedaan' ? ' done' : '') + (x.status === 'ingehaald' ? ' elders' : '') + (isToday ? ' today' : '');
    let dot = '';
    if (x.status === 'ingehaald') dot = '<span class="dot gym"></span>';
    else if (x.status === 'gemist') dot = '<span class="dot mis"></span>';
    else if (x.status === 'hockey') dot = '<span class="dot hockey"></span>';
    else if (x.workout && x.status !== 'gedaan') dot = '<span class="dot ' + x.workout.type + '"></span>';
    return '<button class="' + cls + '" data-day="' + x.date + '"><span class="tiny dim">' + DAY_SHORT[x.dag.getDay()] + '</span>' +
      '<span>' + x.dag.getDate() + '</span>' + dot + '</button>';
  }).join('') + '</div>';
}

function laatsteGewicht() {
  if (!state.weights.length) return null;
  return state.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).pop();
}

function statRow(items) {
  return '<div class="stats stats-' + items.length + '">' + items.map(i =>
    '<div class="stat"><div class="v">' + i.v + '</div><div class="k">' + esc(i.k) + '</div></div>').join('') + '</div>';
}

/* Een groet die past bij het moment van de dag. */
function groet() {
  const u = new Date().getHours();
  const naam = state.profile.naam ? ' ' + state.profile.naam : '';
  if (u < 6) return 'Nog wakker' + naam + '?';
  if (u < 12) return 'Goedemorgen' + naam;
  if (u < 18) return 'Middag' + naam;
  return 'Avond' + naam;
}

function screenHome() {
  const plan = weekPlan();
  const st = weekStats();
  const gew = laatsteGewicht();

  let h = topbar(groet(), formatLong(todayKey()));
  h += '<div class="phaseline">' + phaseLine() + '</div>';
  h += heroCard();

  h += '<div class="section"><h2>Deze week</h2><span class="small dim">' + plan.gedaan + ' van ' + plan.gepland + ' gedaan</span></div>';
  h += '<div class="card">' + weekStrip(plan);
  if (plan.gemist.length) {
    const m = plan.gemist[0];
    h += '<div class="miss"><span>' + esc(m.workout.title) + ' van ' + DAY_NAMES[m.dag.getDay()] + ' blijven liggen.</span>' +
      '<button data-start="' + m.workout.id + '">Inhalen</button></div>';
  }
  h += '</div>';

  const rij = streakWeeks();
  h += statRow([
    { v: st.count, k: st.count === 1 ? 'training' : 'trainingen' },
    { v: rij, k: rij === 1 ? 'week op rij' : 'weken op rij' },
    { v: gew ? fmtKg(gew.kg) : '&mdash;', k: 'jouw gewicht' }
  ]);

  h += '<div class="section"><h2>Verder</h2></div>';
  h += '<div class="card tight"><ul class="rows">' +
    '<li data-tab-mob="1"><span class="idx">' + ICON.stretch + '</span><span class="main"><span class="name">Mobiliteit</span>' +
    '<br><span class="meta">twee routines van een paar minuten</span></span><span class="right">open</span></li>' +
    swimRow() + '</ul></div>';
  return h;
}

function swimRow() {
  if (currentPhase() !== 'triathlon') return '';
  const wk = weekKey(today());
  const on = !!state.swim[wk];
  return '<li data-swim="' + wk + '"><span class="idx' + (on ? ' done' : '') + '">' + (on ? ICON.check : 'Z') + '</span>' +
    '<span class="main"><span class="name">Zwemmen deze week</span><br><span class="meta">' + esc(SWIM_TASK.detail) + '</span></span>' +
    '<span class="right">' + (on ? 'gedaan' : 'afvinken') + '</span></li>';
}

function phaseLine() {
  if (currentPhase() === 'triathlon') {
    const w = weeksToGo();
    return '<span class="pill">Triathlon week ' + triathlonWeek() + ' van 10</span>' +
      '<span class="small dim">' + esc(goalLabel(state.goal.type)) + ' over ' + plural(w, 'week', 'weken') + '</span>';
  }
  return '<span class="pill">Krachtfase</span><span class="small dim">bouwen aan spiermassa</span>';
}

function sessionSummaryLine(s) {
  if (s.type === 'cardio') return s.km + ' km in ' + s.minutes + ' minuten, zwaarte ' + s.rpe + ' van 10';
  const sets = s.entries.reduce((n, e) => n + e.sets.filter(x => x.reps > 0).length, 0);
  return sets + ' sets, ' + Math.round(sessionVolume(s)).toLocaleString('nl-NL') + ' kg getild';
}

function sessionVolume(s) {
  if (s.type !== 'gym') return 0;
  return s.entries.reduce((sum, e) =>
    sum + e.sets.reduce((n, x) => n + (Number(x.weight) || 0) * (Number(x.reps) || 0), 0), 0);
}

function weekStats() {
  const mon = mondayOf(today());
  const inWeek = state.sessions.filter(s => {
    const x = daysBetween(mon, parseKey(s.date));
    return x >= 0 && x < 7;
  });
  return {
    count: inWeek.length,
    vol: inWeek.reduce((n, s) => n + sessionVolume(s), 0),
    km: inWeek.filter(s => s.type === 'cardio').reduce((n, s) => n + Number(s.km || 0), 0)
  };
}

/* Hoeveel weken op rij je minstens twee keer traint. */
function streakWeeks() {
  let n = 0;
  for (let i = 0; i < 52; i++) {
    const mon = addDays(mondayOf(today()), -7 * i);
    const count = state.sessions.filter(s => { const x = daysBetween(mon, parseKey(s.date)); return x >= 0 && x < 7; }).length;
    if (count >= 2) n++;
    else if (i > 0) break;
  }
  return n;
}

/* ================= kalender ================= */

function screenKalender() {
  const base = view.month ? parseKey(view.month + '-01') : new Date(today().getFullYear(), today().getMonth(), 1);
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day pad"></div>';
  for (let n = 1; n <= days; n++) {
    const d = new Date(base.getFullYear(), base.getMonth(), n);
    const k = dateKey(d);
    const s = sessionOn(k);
    const w = workoutForDate(d);
    let cls = 'day';
    if (s) cls += ' done';
    if (k === todayKey()) cls += ' today';
    if (view.sel === k) cls += ' sel';
    let dot = '';
    if (!s && w) dot = '<span class="dot ' + w.type + '"></span>';
    else if (!s && HOCKEY_DAYS[d.getDay()]) dot = '<span class="dot hockey"></span>';
    cells += '<button class="' + cls + '" data-day="' + k + '"><span>' + n + '</span>' + dot + '</button>';
  }

  const monthKey = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0');
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  let h = topbar('Kalender', 'Wat je deed en wat er aankomt');
  h += '<div class="card"><div class="calhead">' +
    '<button class="iconbtn" data-month="' + dateKey(prev).slice(0, 7) + '">' + ICON.back + '</button>' +
    '<span class="m">' + MONTH_NAMES[base.getMonth()] + ' ' + base.getFullYear() + '</span>' +
    '<button class="iconbtn" data-month="' + dateKey(next).slice(0, 7) + '" style="transform:rotate(180deg)">' + ICON.back + '</button></div>' +
    '<div class="caldow">' + ['ma','di','wo','do','vr','za','zo'].map(x => '<span>' + x + '</span>').join('') + '</div>' +
    '<div class="calgrid">' + cells + '</div>' +
    '<div class="legend"><span><i style="background:var(--accent)"></i>gym</span>' +
    '<span><i style="background:var(--blauw)"></i>duurtraining</span>' +
    '<span><i style="background:var(--lila)"></i>hockey</span>' +
    '<span><i style="background:var(--accent)"></i>gevuld is afgerond</span></div></div>';
  h += dayDetail(view.sel || todayKey());
  h += '<input type="hidden" value="' + monthKey + '">';
  return h;
}

function dayDetail(k) {
  const d = parseKey(k);
  const s = sessionOn(k);
  let h = '<div class="section"><h2>' + esc(formatLong(k)) + '</h2></div>';

  const mob = state.mobility.filter(m => m.date === k);
  const verleden = daysBetween(today(), d) <= 0;

  if (s) {
    h += '<div class="card"><h3>' + esc(s.title) + '</h3><p class="dim small">' + esc(sessionSummaryLine(s)) + '</p>';
    if (s.note) h += '<div class="note grey">' + esc(s.note) + '</div>';
    if (s.type === 'gym') {
      h += '<ul class="rows mt">' + s.entries.filter(e => e.sets.some(x => x.reps > 0)).map(e =>
        '<li><span class="main"><span class="name">' + esc(e.name) + '</span></span>' +
        '<span class="right">' + e.sets.filter(x => x.reps > 0).map(x => fmtKg(x.weight) + 'x' + x.reps).join('  ') + '</span></li>'
      ).join('') + '</ul>';
    }
    h += '<button class="btn ghost slim" data-reopen="' + s.id + '">Aanpassen</button>';
    h += '<button class="btn ghost slim" data-choose="' + k + '">Nog een training op deze dag</button></div>';
    if (mob.length) h += '<div class="card tight"><ul class="rows">' + mob.map(m =>
      '<li><span class="main"><span class="name">Mobiliteit: ' + esc(m.title) + '</span></span></li>').join('') + '</ul></div>';
    return h;
  }

  const w = workoutForDate(d);
  if (!w) {
    h += '<div class="card"><h3>' + (HOCKEY_DAYS[d.getDay()] || 'Rustdag') + '</h3>' +
      '<p class="dim small">Geen gym gepland. Goed moment voor mobiliteit.</p>';
    if (mob.length) h += '<p class="small">Mobiliteit gedaan: ' + mob.map(m => esc(m.title)).join(', ') + '.</p>';
    if (verleden) h += '<button class="btn ghost slim" data-choose="' + k + '">Toch getraind, invullen</button>';
    h += '</div>';
    return h;
  }

  h += '<div class="card"><h3>' + esc(w.title) + '</h3>';
  if (w.type === 'gym') {
    h += '<ul class="rows mt">' + w.exercises.map(e =>
      '<li><span class="main"><span class="name">' + esc(e.name) + '</span></span><span class="right">' + repsText(e) + '</span></li>'
    ).join('') + '</ul>';
  } else {
    h += '<p class="dim small">' + cardioKm(w) + ' km ' + esc(w.sport) + '. ' + esc(w.hint) + '</p>';
  }
  if (verleden) {
    h += '<button class="btn accent" data-startdate="' + w.id + '|' + k + '">' +
      (k === todayKey() ? 'Start training' : 'Achteraf invullen') + '</button>';
    h += '<button class="btn ghost slim" data-choose="' + k + '">Andere training kiezen</button>';
  } else {
    h += '<p class="tiny dim">Staat gepland, je kunt hem starten op de dag zelf.</p>';
  }
  h += '</div>';
  if (mob.length) h += '<div class="card tight"><ul class="rows">' + mob.map(m =>
    '<li><span class="main"><span class="name">Mobiliteit: ' + esc(m.title) + '</span></span></li>').join('') + '</ul></div>';
  return h;
}

function repsText(e) {
  if (e.warmupOnly) return e.sets + ' sets warming-up';
  return e.sets + ' x ' + e.min + '-' + e.max;
}

/* ================= training starten ================= */

/* Je kunt elke training op elke dag doen, ook een dag terug invullen. */
function startWorkout(id, dateStr) {
  const w = workoutById(id);
  if (!w) return;
  const k = dateStr || todayKey();
  const same = state.active && state.active.date === k && state.active.workoutId === id;
  if (!same) {
    state.active = {
      date: k, workoutId: id, type: w.type, title: w.title, startedTs: Date.now(), note: '',
      entries: w.type === 'gym' ? w.exercises.map(e => newEntry(e, w.id)) : [],
      cardio: { km: '', minutes: '', rpe: '' }
    };
    save();
  }
  closeModal();
  if (w.type === 'gym' && k === todayKey() && !warmupDone(k)) go('warmup');
  else go('training', { i: 0 });
}

/* Het gewicht staat alvast ingevuld volgens het advies, zodat je alleen nog reps hoeft te tikken. */
function newEntry(ex, workoutId) {
  const start = suggestedWeight(ex, workoutId);
  return {
    name: ex.name,
    sets: Array.from({ length: ex.sets }, () => ({ weight: start === null ? '' : String(start), reps: '', done: false }))
  };
}

function suggestedWeight(ex, workoutId) {
  const hist = historyFor(ex.name).filter(h => h.workout === workoutId);
  if (!hist.length || ex.warmupOnly) return null;
  const w = topWeight(hist[hist.length - 1].sets);
  const a = advice(ex, workoutId);
  if (a.tone === 'up') return w + (isBigLift(ex.name) ? 5 : 2.5);
  if (a.tone === 'deload') return Math.round(w * 0.9 * 2) / 2;
  return w;
}

function activeWorkout() {
  return state.active ? workoutById(state.active.workoutId) : null;
}

/* Een afgeronde training weer openzetten om te verbeteren. */
function reopenSession(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  const w = workoutById(s.workoutId);
  state.sessions = state.sessions.filter(x => x.id !== id);
  state.active = {
    date: s.date, workoutId: s.workoutId, type: s.type, title: s.title, startedTs: Date.now(), note: s.note || '',
    entries: w && w.type === 'gym' ? w.exercises.map((ex, i) => {
      const old = (s.entries || []).find(e => exKey(e.name) === exKey(ex.name));
      const sets = (old ? old.sets : []).map(x => ({ weight: String(x.weight), reps: String(x.reps), done: true }));
      while (sets.length < ex.sets) sets.push({ weight: '', reps: '', done: false });
      return { name: ex.name, sets: sets };
    }) : [],
    cardio: { km: s.km || '', minutes: s.minutes || '', rpe: s.rpe || '' }
  };
  save();
  closeModal();
  go('training', { i: 0 });
}

/* Lijstje om zelf een training te kiezen, bijvoorbeeld als je een dag mist. */
function chooseWorkout(dateStr) {
  const k = dateStr || todayKey();
  const groups = [
    { title: 'Krachtfase', list: [1, 3, 5, 0].map(d => SCHEMA_KRACHT[d]) },
    { title: 'Triathlonfase', list: [1, 3, 5, 0].map(d => SCHEMA_TRIATHLON[d]) }
  ];
  let h = '<h2>Welke training?</h2><p class="dim small">Voor ' + esc(formatLong(k)) + '.</p>';
  groups.forEach(g => {
    h += '<div class="section"><h2>' + g.title + '</h2></div><ul class="rows">' + g.list.map(w =>
      '<li data-startdate="' + w.id + '|' + k + '"><span class="idx">' + (w.type === 'gym' ? 'G' : 'D') + '</span>' +
      '<span class="main"><span class="name">' + esc(w.title) + '</span></span>' +
      '<span class="right">kies</span></li>').join('') + '</ul>';
  });
  h += '<button class="btn ghost" data-close="1">Annuleren</button>';
  showModal(h);
}

/* ================= warming-up ================= */

function screenWarmup() {
  const k = todayKey();
  const checked = state.flags.warmupChecks && state.flags.warmupChecks[k] || [];
  let h = backbar('Warming-up', '5 minuten, voor de eerste oefening');
  h += '<div class="card tight">' + WARMUP.map((x, i) =>
    '<div class="check' + (checked.indexOf(i) !== -1 ? ' on' : '') + '" data-warm="' + i + '">' +
    '<span class="box">' + ICON.check + '</span><span class="main"><span class="name">' + esc(x.name) + '</span>' +
    '<br><span class="meta">' + esc(x.detail) + '</span></span></div>').join('') + '</div>';
  h += '<div class="note grey">Niet stil staan rekken vooraf, daar word je even slapper van. Bewegen is genoeg.</div>';
  h += '<button class="btn accent" data-warmdone="1">Klaar, naar de oefeningen</button>';
  h += '<button class="btn ghost dim" data-warmskip="1">Overslaan</button>';
  return h;
}

function toggleWarm(i) {
  const k = todayKey();
  state.flags.warmupChecks = state.flags.warmupChecks || {};
  const list = state.flags.warmupChecks[k] || [];
  const at = list.indexOf(i);
  if (at === -1) list.push(i); else list.splice(at, 1);
  state.flags.warmupChecks[k] = list;
  save();
  render();
}

/* ================= trainingsscherm ================= */

function restSeconds(index) {
  const s = state.settings;
  return index < 2 ? s.rest1 : s.rest2;
}

function entryDone(entry) { return entry.sets.some(s => s.done); }
function entryFull(entry) { return entry.sets.every(s => s.done); }

function exerciseChips(w, current) {
  return '<div class="chips">' + w.exercises.map((ex, n) => {
    const e = state.active.entries[n];
    let cls = 'chip' + (n === current ? ' now' : '') + (entryFull(e) ? ' done' : entryDone(e) ? ' part' : '');
    return '<button class="' + cls + '" data-goex="' + n + '">' + (n + 1) + '</button>';
  }).join('') + '</div>';
}

function screenTraining() {
  const w = activeWorkout();
  if (!w || !state.active) return screenHome();
  if (w.type === 'cardio') return screenCardio(w);

  const i = Math.min(view.i || 0, w.exercises.length - 1);
  const ex = w.exercises[i];
  const entry = state.active.entries[i];
  const last = lastPerformance(ex.name, w.id);
  const sub = (state.active.date === todayKey() ? '' : formatDate(state.active.date) + ', ') +
    'oefening ' + (i + 1) + ' van ' + w.exercises.length;

  let h = backbar(w.title, sub);
  h += exerciseChips(w, i);

  h += '<div style="display:flex;align-items:flex-start;gap:10px">' +
    '<h2 class="hero-title" style="flex:1">' + esc(ex.name) + '</h2>' +
    '<button class="iconbtn" data-info="' + esc(ex.name) + '">' + ICON.info + '</button></div>';
  h += '<p class="dim small" style="margin-bottom:12px">' + repsText(ex) + (last ? ' &middot; vorige keer ' + fmtKg(topWeight(last.sets)) + ' kg' : '') + '</p>';

  if (ex.warmupOnly) {
    h += '<div class="note grey">Twee sets om warm te worden, niet tot falen.</div>';
  } else {
    const a = advice(ex, w.id);
    h += '<div class="note"><b>' + esc(a.text) + '</b><br><span style="opacity:.85">' + esc(a.why) + '</span></div>';
  }

  h += '<div class="card"><div class="sethead"><span class="setno">set</span><span class="field">gewicht</span>' +
    '<span class="field">reps</span><span class="prev">vorige keer</span><span class="tickpad"></span></div>' +
    entry.sets.map((s, n) => {
      const prev = last && last.sets[n] ? fmtKg(last.sets[n].weight) + ' kg x ' + last.sets[n].reps : 'geen data';
      return '<div class="setrow">' +
        '<span class="setno">' + (n + 1) + '</span>' +
        '<span class="field"><input type="number" inputmode="decimal" step="0.5" placeholder="kg" value="' + esc(s.weight) + '" data-in="weight" data-set="' + n + '"></span>' +
        '<span class="field"><input type="number" inputmode="numeric" placeholder="' + (ex.max || '') + '" value="' + esc(s.reps) + '" data-in="reps" data-set="' + n + '"></span>' +
        '<span class="prev">' + esc(prev) + '</span>' +
        '<button class="tick' + (s.done ? ' on' : '') + '" data-tick="' + n + '">' + ICON.check + '</button>' +
        '</div>';
    }).join('') +
    '<div class="setedit"><button data-addset="1">+ set erbij</button>' +
    (entry.sets.length > 1 ? '<button data-delset="1">set eraf</button>' : '') + '</div></div>';

  h += '<div class="btn-row">';
  if (i > 0) h += '<button class="btn ghost" data-goex="' + (i - 1) + '">Vorige</button>';
  h += '<button class="btn accent" data-goex="' + (i + 1) + '">' + (i + 1 < w.exercises.length ? 'Volgende' : 'Naar afronden') + '</button></div>';
  h += '<button class="btn ghost dim slim" data-skip="' + i + '">Oefening overslaan</button>';
  h += '<button class="btn ghost slim" data-afronden="1">Training afronden</button>';
  return h;
}

function screenCardio(w) {
  const c = state.active.cardio;
  let h = backbar(w.title, cardioKm(w) + ' km ' + w.sport);
  h += '<div class="note grey">' + esc(w.hint) + '</div>';
  h += '<div class="card">' +
    '<label for="c-km">Afstand in km</label><input id="c-km" type="number" inputmode="decimal" step="0.1" value="' + esc(c.km) + '" data-cardio="km">' +
    '<label for="c-min">Tijd in minuten</label><input id="c-min" type="number" inputmode="numeric" value="' + esc(c.minutes) + '" data-cardio="minutes">' +
    '<label>Hoe zwaar voelde het, 1 tot 10</label><div class="rpe">' +
    Array.from({ length: 10 }, (_, n) => '<button class="' + (String(c.rpe) === String(n + 1) ? 'on' : '') + '" data-rpe="' + (n + 1) + '">' + (n + 1) + '</button>').join('') +
    '</div></div>';
  h += '<button class="btn accent" data-afronden="1">Training afronden</button>';
  return h;
}

/* Laatste scherm voor je opslaat: kloppen de cijfers, en wil je er iets bij schrijven. */
function screenAfronden() {
  const a = state.active;
  if (!a) return screenHome();
  let h = backbar('Afronden', a.title + ', ' + formatDate(a.date));

  if (a.type === 'gym') {
    const rows = a.entries.map((e, n) => {
      const done = e.sets.filter(s => Number(s.reps) > 0);
      return '<li data-goex="' + n + '"><span class="idx' + (done.length ? ' done' : '') + '">' + (n + 1) + '</span>' +
        '<span class="main"><span class="name">' + esc(e.name) + '</span></span>' +
        '<span class="right">' + (done.length ? done.map(s => fmtKg(s.weight) + 'x' + s.reps).join('  ') : 'niet gedaan') + '</span></li>';
    }).join('');
    h += '<div class="card tight"><ul class="rows">' + rows + '</ul></div>';
    h += '<p class="tiny dim">Tik een oefening aan om er nog iets bij te zetten.</p>';
  } else {
    h += '<div class="card"><p>' + esc(a.cardio.km || '?') + ' km in ' + esc(a.cardio.minutes || '?') + ' minuten, zwaarte ' + esc(a.cardio.rpe || '?') + '/10.</p></div>';
  }

  h += '<label for="note">Notitie, mag leeg blijven</label>' +
    '<input id="note" type="text" placeholder="voelde zwaar, schouder zeurt, weinig geslapen" value="' + esc(a.note || '') + '" data-note="1">';
  h += '<button class="btn accent" data-finish="1">Opslaan</button>';
  h += '<button class="btn ghost dim slim" data-cancel="1">Training weggooien</button>';
  return h;
}

/* ================= invoer ================= */

function setField(n, field, value) {
  state.active.entries[view.i || 0].sets[n][field] = value;
  save();
}

function currentEntry() { return state.active.entries[view.i || 0]; }

function tickSet(n) {
  const i = view.i || 0;
  const ex = activeWorkout().exercises[i];
  const entry = state.active.entries[i];
  const s = entry.sets[n];
  s.done = !s.done;

  if (s.done) {
    if (!s.reps) s.reps = String(ex.max || '');
    /* De volgende sets krijgen hetzelfde gewicht, reps vul je zelf of met het vinkje. */
    entry.sets.slice(n + 1).forEach(next => {
      if (!next.done && !next.reps) next.weight = s.weight;
    });
    checkRecord(ex.name, s);
    startRest(restSeconds(i), 'Rust na set ' + (n + 1));
  }
  save();
  render();
}

function addSet() {
  const entry = currentEntry();
  const laatste = entry.sets[entry.sets.length - 1];
  entry.sets.push({ weight: laatste ? laatste.weight : '', reps: '', done: false });
  save();
  render();
}

function removeSet() {
  const entry = currentEntry();
  if (entry.sets.length > 1) entry.sets.pop();
  save();
  render();
}

function skipExercise(i) {
  state.active.entries[i].sets.forEach(s => { s.weight = ''; s.reps = ''; s.done = false; });
  save();
  const w = activeWorkout();
  go('training', { i: Math.min(i + 1, w.exercises.length - 1) });
}

/* ================= records ================= */

function bestWeight(name) {
  return historyFor(name).reduce((m, h) => Math.max(m, topWeight(h.sets)), 0);
}

function checkRecord(name, set) {
  const w = Number(set.weight) || 0;
  if (!w) return;
  const best = bestWeight(name);
  if (best > 0 && w > best) toast('Record: ' + fmtKg(w) + ' kg bij ' + exKey(name));
}

function toast(text) {
  let t = el('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.className = 'show';
  clearTimeout(toast.handle);
  toast.handle = setTimeout(() => { t.className = ''; }, 2600);
}

/* ================= rusttimer ================= */

function startRest(seconds, label) {
  restTimer = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label };
  drawRest();
  if (!tickHandle) tickHandle = setInterval(tick, 250);
}
function stopRest() { restTimer = null; drawRest(); }

function tick() {
  drawRest();
  drawMobility();
  if (!restTimer && !mobTimer) { clearInterval(tickHandle); tickHandle = null; }
}

function drawRest() {
  const box = el('rest');
  if (!restTimer) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const left = Math.max(0, Math.round((restTimer.endsAt - Date.now()) / 1000));
  if (left === 0 && !restTimer.beeped) { restTimer.beeped = true; beep(); }
  const pct = Math.max(0, (left / restTimer.total) * 100);
  box.classList.remove('hidden');
  box.innerHTML = '<div class="line"><span class="t' + (left === 0 ? ' ready' : '') + '">' + mmss(left) + '</span>' +
    '<span class="lbl">' + esc(left === 0 ? 'Rust voorbij, volgende set' : restTimer.label) + '</span>' +
    '<button data-rest="plus">+30s</button><button data-rest="stop">Klaar</button></div>' +
    '<div class="progress"><i style="width:' + pct + '%"></i></div>';
}

function mmss(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

/* Kort piepje zodat je het hoort met je telefoon in je zak. */
function beep() {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* geluid mag mislukken */ }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { }
}

/* Scherm aan houden tijdens de training, zodat het niet steeds uitvalt. */
let wakeLock = null;
function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      navigator.wakeLock.request('screen').then(l => { wakeLock = l; }, () => { });
    } else if (!on && wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* niet elke browser kan dit */ }
}

/* ================= afronden ================= */

function finishSession() {
  const a = state.active;
  if (!a) return go('home');
  const w = workoutById(a.workoutId);

  if (a.type === 'cardio') {
    if (!a.cardio.km || !a.cardio.minutes) { alert('Vul afstand en tijd in.'); return; }
    state.sessions.push({
      id: 's' + Date.now(), date: a.date, ts: parseKey(a.date).getTime(), type: 'cardio',
      workoutId: a.workoutId, title: w.title, sport: w.sport, phase: currentPhase(), note: a.note || '',
      km: Number(a.cardio.km), minutes: Number(a.cardio.minutes), rpe: Number(a.cardio.rpe) || null
    });
  } else {
    const entries = a.entries.map(e => ({
      name: e.name,
      sets: e.sets.filter(s => Number(s.reps) > 0).map(s => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) }))
    })).filter(e => e.sets.length);
    if (!entries.length && !confirm('Je hebt niks ingevuld. Toch opslaan?')) return;
    state.sessions.push({
      id: 's' + Date.now(), date: a.date, ts: parseKey(a.date).getTime(), type: 'gym',
      workoutId: a.workoutId, title: w.title, phase: currentPhase(), note: a.note || '',
      minutes: Math.round((Date.now() - a.startedTs) / 60000), entries: entries
    });
  }
  state.active = null;
  save();
  stopRest();
  keepAwake(false);
  go('home');
  const last = state.sessions[state.sessions.length - 1];
  toast('Opgeslagen: ' + last.title + ', ' + sessionSummaryLine(last));
}

function cancelSession() {
  if (!confirm('Deze training weggooien? Je invoer verdwijnt.')) return;
  state.active = null;
  save();
  stopRest();
  keepAwake(false);
  go('home');
}

/* ================= mobiliteit ================= */

function screenMobiliteit() {
  let h = backbar('Mobiliteit', 'voor rustdagen en na hockey');
  h += '<div class="note grey">' + esc(MOBILITY_WHY) + '</div>';
  h += MOBILITY.map(r =>
    '<div class="card"><h3>' + esc(r.title) + '</h3>' +
    '<p class="dim small">' + r.exercises.length + ' oefeningen, ' + r.seconds + ' seconden per kant, ongeveer ' +
    Math.round(r.exercises.length * r.seconds * 2 / 60) + ' minuten.</p>' +
    '<ul class="rows mt">' + r.exercises.map(x => '<li><span class="main"><span class="name">' + esc(x) + '</span></span><span class="right">' + r.seconds + 's</span></li>').join('') + '</ul>' +
    '<button class="btn accent" data-mob="' + r.id + '">Start routine</button></div>').join('');

  const recent = state.mobility.slice(-5).reverse();
  if (recent.length) {
    h += '<div class="section"><h2>Laatste keren</h2></div><div class="card tight"><ul class="rows">' +
      recent.map(m => '<li><span class="main"><span class="name">' + esc(m.title) + '</span></span><span class="right">' + esc(formatDate(m.date)) + '</span></li>').join('') +
      '</ul></div>';
  }
  return h;
}

function startMobility(id) {
  const r = MOBILITY.find(x => x.id === id);
  mobTimer = { id: id, ex: 0, side: 0, endsAt: Date.now() + r.seconds * 1000, seconds: r.seconds, paused: false, left: r.seconds };
  if (!tickHandle) tickHandle = setInterval(tick, 250);
  go('mobrun');
}

function screenMobrun() {
  if (!mobTimer) return screenMobiliteit();
  const r = MOBILITY.find(x => x.id === mobTimer.id);
  const name = r.exercises[mobTimer.ex];
  let h = backbar(r.title, 'Oefening ' + (mobTimer.ex + 1) + ' van ' + r.exercises.length);
  h += '<div class="card" style="text-align:center;padding-top:26px">' +
    '<h2 class="hero-title" style="font-size:26px">' + esc(name) + '</h2>' +
    '<div class="timer-side">' + (r.perSide ? (mobTimer.side === 0 ? 'linkerkant' : 'rechterkant') : 'vasthouden') + '</div>' +
    '<div class="timer-big" id="mob-t">' + mmss(mobTimer.left) + '</div>' +
    '<div class="progress"><i id="mob-p" style="width:100%"></i></div>' +
    '<div class="btn-row">' +
    '<button class="btn ghost" data-mobctl="pause">' + (mobTimer.paused ? 'Verder' : 'Pauze') + '</button>' +
    '<button class="btn accent" data-mobctl="next">Volgende</button></div></div>';
  h += '<button class="btn ghost dim slim" data-mobctl="stop">Stoppen</button>';
  return h;
}

function drawMobility() {
  if (!mobTimer || view.name !== 'mobrun') return;
  if (!mobTimer.paused) mobTimer.left = Math.max(0, Math.round((mobTimer.endsAt - Date.now()) / 1000));
  const t = el('mob-t');
  if (t) t.textContent = mmss(mobTimer.left);
  const p = el('mob-p');
  if (p) p.style.width = (mobTimer.left / mobTimer.seconds * 100) + '%';
  if (mobTimer.left === 0 && !mobTimer.paused) { beep(); nextMobility(); }
}

function nextMobility() {
  const r = MOBILITY.find(x => x.id === mobTimer.id);
  if (r.perSide && mobTimer.side === 0) mobTimer.side = 1;
  else { mobTimer.side = 0; mobTimer.ex++; }
  if (mobTimer.ex >= r.exercises.length) {
    state.mobility.push({ date: todayKey(), routine: r.id, title: r.title });
    save();
    mobTimer = null;
    go('mobiliteit');
    showModal('<h2>Routine klaar</h2><p class="dim">' + esc(r.title) + ' afgerond. Genoteerd.</p><button class="btn accent" data-close="1">Sluiten</button>');
    return;
  }
  mobTimer.left = mobTimer.seconds;
  mobTimer.endsAt = Date.now() + mobTimer.seconds * 1000;
  render();
}

function mobControl(what) {
  if (!mobTimer) return;
  if (what === 'next') return nextMobility();
  if (what === 'stop') { mobTimer = null; return go('mobiliteit'); }
  if (mobTimer.paused) { mobTimer.paused = false; mobTimer.endsAt = Date.now() + mobTimer.left * 1000; }
  else mobTimer.paused = true;
  render();
}

/* ================= voortgang ================= */

let chartData = {};

function allTrackedExercises() {
  const namen = {};
  state.sessions.forEach(s => (s.entries || []).forEach(e => { namen[exKey(e.name)] = true; }));
  return Object.keys(namen).sort();
}

function weekBars() {
  const weken = [];
  for (let i = 7; i >= 0; i--) {
    const mon = addDays(mondayOf(today()), -7 * i);
    const n = state.sessions.filter(s => { const x = daysBetween(mon, parseKey(s.date)); return x >= 0 && x < 7; }).length;
    weken.push({ label: mon.getDate() + '/' + (mon.getMonth() + 1), n: n });
  }
  const max = Math.max(3, ...weken.map(w => w.n));
  const gem = weken.reduce((a, b) => a + b.n, 0) / weken.length;
  return '<div class="card"><div class="cardhead"><h3>Trainingen per week</h3>' +
    '<span class="small dim">gemiddeld ' + fmtKg(Math.round(gem * 10) / 10) + '</span></div>' +
    '<div class="bars">' + weken.map(w => '<div class="b' + (w.n ? ' on' : '') + '" style="height:' + Math.round(w.n / max * 100) + '%"></div>').join('') + '</div>' +
    '<div class="barlabels">' + weken.map(w => '<span>' + w.label + '</span>').join('') + '</div></div>';
}

function segmented(huidig, opties) {
  return '<div class="seg">' + opties.map(o =>
    '<button class="' + (o.id === huidig ? 'on' : '') + '" data-vtab="' + o.id + '">' + esc(o.label) + '</button>').join('') + '</div>';
}

function screenVoortgang() {
  chartData = {};
  const deel = view.deel || 'oefeningen';
  let h = topbar('Voortgang', 'wat je opbouwt');
  h += weekBars();
  h += segmented(deel, [
    { id: 'oefeningen', label: 'Oefeningen' },
    { id: 'records', label: 'Records' },
    { id: 'log', label: 'Logboek' }
  ]);

  if (deel === 'oefeningen') h += deelOefeningen();
  else if (deel === 'records') h += deelRecords();
  else h += deelLog();
  return h;
}

function deelOefeningen() {
  const namen = allTrackedExercises();
  if (!namen.length) return leeg('Hier komen je lijnen te staan, zodra je een training hebt afgerond.');

  const gekozen = namen.indexOf(view.ex) !== -1 ? view.ex : namen[0];
  const hist = historyFor(gekozen);
  chartData['c-ex'] = { points: hist.map(x => ({ x: x.ts, y: topWeight(x.sets), label: formatDate(x.date) })) };

  const eerste = topWeight(hist[0].sets);
  const nu = topWeight(hist[hist.length - 1].sets);
  const groei = nu - eerste;

  let h = '<div class="card"><select data-exsel="1">' +
    namen.map(n => '<option' + (n === gekozen ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' +
    '<div class="bigrow"><div><div class="big">' + fmtKg(nu) + '<span class="unitbig">kg</span></div>' +
    '<div class="dim small">' + (groei > 0 ? '+' + fmtKg(groei) + ' kg sinds ' + formatDate(hist[0].date) : 'je startgewicht') + '</div></div></div>' +
    '<canvas data-chart="c-ex"></canvas></div>';

  h += '<div class="section"><h2>Laatste keren</h2></div><div class="card tight"><ul class="rows">' +
    hist.slice(-6).reverse().map(x =>
      '<li><span class="main"><span class="name">' + esc(formatDate(x.date)) + '</span></span>' +
      '<span class="right">' + x.sets.map(s => fmtKg(s.weight) + 'x' + s.reps).join('  ') + '</span></li>').join('') +
    '</ul></div>';
  return h;
}

function deelRecords() {
  const recs = allTrackedExercises().map(n => {
    const hist = historyFor(n);
    const kg = hist.reduce((m, x) => Math.max(m, topWeight(x.sets)), 0);
    const wanneer = hist.filter(x => topWeight(x.sets) === kg).pop();
    return { name: n, kg: kg, date: wanneer ? wanneer.date : '' };
  }).filter(r => r.kg > 0).sort((a, b) => b.kg - a.kg);

  if (!recs.length) return leeg('Je zwaarste sets komen hier vanzelf te staan.');
  return '<div class="card tight"><ul class="rows">' + recs.map(r =>
    '<li><span class="main"><span class="name">' + esc(r.name) + '</span><br><span class="meta">' + esc(formatDate(r.date)) + '</span></span>' +
    '<span class="right"><strong>' + fmtKg(r.kg) + ' kg</strong></span></li>').join('') + '</ul></div>';
}

function deelLog() {
  const lijst = state.sessions.slice().sort((a, b) => b.ts - a.ts);
  if (!lijst.length) return leeg('Nog geen trainingen afgerond.');
  let h = '<div class="card tight"><ul class="rows">' + lijst.slice(0, 40).map(s =>
    '<li data-open-session="' + s.id + '"><span class="idx done">' + (s.type === 'gym' ? 'G' : 'D') + '</span>' +
    '<span class="main"><span class="name">' + esc(s.title) + '</span><br><span class="meta">' + esc(sessionSummaryLine(s)) +
    (s.note ? ' &middot; ' + esc(s.note) : '') + '</span></span>' +
    '<span class="right">' + esc(formatDate(s.date)) + '</span></li>').join('') + '</ul></div>';
  h += '<button class="btn" data-export="1">' + ICON.copy + ' Kopieer laatste 4 weken</button>';
  return h;
}

function leeg(tekst) {
  return '<div class="card"><p class="dim small">' + esc(tekst) + '</p></div>';
}

/* Lijngrafiek met de hand op canvas, zonder library. */
function drawCharts() {
  document.querySelectorAll('canvas[data-chart]').forEach(c => {
    const d = chartData[c.dataset.chart];
    if (!d || !d.points.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    const pad = { l: 30, r: 10, t: 12, b: 20 };
    const ys = d.points.map(p => p.y);
    const min = Math.min(...ys), max = Math.max(...ys);
    const lo = min === max ? min - 1 : min - (max - min) * 0.15;
    const hi = min === max ? max + 1 : max + (max - min) * 0.15;
    const px = i => pad.l + (d.points.length === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (d.points.length - 1));
    const py = v => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);

    /* twee rustige hulplijnen */
    g.strokeStyle = '#241E1A'; g.lineWidth = 1;
    [pad.t, h - pad.b].forEach(y => { g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); });
    g.fillStyle = '#796E62'; g.font = '11px ui-rounded,-apple-system,sans-serif'; g.textAlign = 'right';
    g.fillText(Math.round(max), pad.l - 8, py(max) + 4);
    if (min !== max) g.fillText(Math.round(min), pad.l - 8, py(min) + 4);

    /* vlak onder de lijn */
    const vlak = g.createLinearGradient(0, pad.t, 0, h - pad.b);
    vlak.addColorStop(0, 'rgba(255,138,76,.24)');
    vlak.addColorStop(1, 'rgba(255,138,76,0)');
    g.beginPath();
    d.points.forEach((p, i) => { const x = px(i), y = py(p.y); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.lineTo(px(d.points.length - 1), h - pad.b);
    g.lineTo(px(0), h - pad.b);
    g.closePath();
    g.fillStyle = vlak; g.fill();

    g.strokeStyle = '#FF8A4C'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    d.points.forEach((p, i) => { const x = px(i), y = py(p.y); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();

    /* alleen het laatste punt markeren, dat houdt het rustig */
    const laatste = d.points.length - 1;
    g.fillStyle = '#FF8A4C';
    g.beginPath(); g.arc(px(laatste), py(d.points[laatste].y), 4.5, 0, Math.PI * 2); g.fill();

    g.fillStyle = '#796E62'; g.textAlign = 'left';
    g.fillText(d.points[0].label, pad.l, h - 4);
    if (d.points.length > 1) { g.textAlign = 'right'; g.fillText(d.points[laatste].label, w - pad.r, h - 4); }
  });
}

/* ================= profiel ================= */

function leeftijd() {
  const j = Number(state.profile.geboortejaar);
  if (!j) return null;
  return today().getFullYear() - j;
}

function gewichtsVerschil() {
  const lijst = state.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  if (lijst.length < 2) return null;
  const nu = lijst[lijst.length - 1];
  const grens = dateKey(addDays(today(), -30));
  const oud = lijst.filter(x => x.date <= grens).pop() || lijst[0];
  return { verschil: nu.kg - oud.kg, sinds: oud.date };
}

function screenProfiel() {
  chartData = {};
  const p = state.profile;
  const gew = laatsteGewicht();
  const versch = gewichtsVerschil();

  let h = topbar('Profiel', 'jij, je doel en je gegevens');

  h += '<div class="card"><div class="cardhead"><h3>Over jou</h3></div>' +
    '<div class="veld"><label for="p-naam">Naam</label><input id="p-naam" type="text" placeholder="je voornaam" value="' + esc(p.naam) + '" data-profiel="naam"></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="p-jaar">Geboortejaar</label><input id="p-jaar" type="number" inputmode="numeric" placeholder="2008" value="' + esc(p.geboortejaar) + '" data-profiel="geboortejaar"></div>' +
    '<div class="veld"><label for="p-lengte">Lengte in cm</label><input id="p-lengte" type="number" inputmode="numeric" placeholder="180" value="' + esc(p.lengte) + '" data-profiel="lengte"></div>' +
    '</div>' + (leeftijd() ? '<p class="tiny dim">' + leeftijd() + ' jaar.</p>' : '') + '</div>';

  /* gewicht bijhouden */
  const lijst = state.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  if (lijst.length) chartData['c-gew'] = { points: lijst.map(x => ({ x: parseKey(x.date).getTime(), y: x.kg, label: formatDate(x.date) })) };
  h += '<div class="card"><div class="cardhead"><h3>Lichaamsgewicht</h3>' +
    (gew ? '<span class="small dim">' + esc(formatDate(gew.date)) + '</span>' : '') + '</div>';
  if (gew) {
    h += '<div class="bigrow"><div><div class="big">' + fmtKg(gew.kg) + '<span class="unitbig">kg</span></div>' +
      '<div class="dim small">' + (versch
        ? (versch.verschil >= 0 ? '+' : '') + fmtKg(versch.verschil) + ' kg sinds ' + formatDate(versch.sinds)
        : 'eerste meting') + '</div></div></div>';
    if (lijst.length > 1) h += '<canvas data-chart="c-gew"></canvas>';
  } else {
    h += '<p class="dim small">Weeg jezelf een keer per week, op hetzelfde moment. Aankomen mag rustig gaan, ongeveer een halve kilo per week is genoeg om spieren te bouwen.</p>';
  }
  h += '<div class="invoerrij"><input type="number" inputmode="decimal" step="0.1" placeholder="kg vandaag" id="w-kg">' +
    '<button class="btn accent" data-addweight="1">' + ICON.plus + '</button></div>';
  if (lijst.length) {
    h += '<ul class="rows mt">' + lijst.slice(-4).reverse().map(x =>
      '<li><span class="main"><span class="name">' + fmtKg(x.kg) + ' kg</span></span>' +
      '<span class="right">' + esc(formatDate(x.date)) + ' <button class="mini" data-delweight="' + x.date + '">wis</button></span></li>').join('') + '</ul>';
  }
  h += '</div>';

  /* doel en fase */
  h += '<div class="card"><div class="cardhead"><h3>Doel</h3><span class="pill' + (currentPhase() === 'kracht' ? ' grey' : '') + '">' + (currentPhase() === 'kracht' ? 'Krachtfase' : 'Triathlonfase') + '</span></div>';
  if (state.goal) {
    const w = weeksToGo();
    h += '<p>' + esc(goalLabel(state.goal.type)) + ' op ' + esc(formatLong(state.goal.date)) + '.</p>' +
      '<p class="dim small">Nog ' + plural(w, 'week', 'weken') + '. ' +
      (currentPhase() === 'triathlon' ? 'Je traint nu voor de afstand.' : 'Vanaf tien weken ervoor schakelt de app om.') + '</p>' +
      '<button class="btn ghost danger slim" data-goal="remove">Doel weghalen</button>';
  } else {
    h += '<p class="dim small">Zonder doel blijf je kracht opbouwen. Vul je een wedstrijddatum in, dan schakelt de app tien weken van tevoren om.</p>' +
      '<div class="veld"><label for="goal-type">Wat</label><select id="goal-type">' +
      GOAL_TYPES.map(g => '<option value="' + g.id + '">' + esc(g.label) + '</option>').join('') + '</select></div>' +
      '<div class="veld"><label for="goal-date">Wanneer</label><input type="date" id="goal-date"></div>' +
      '<button class="btn accent slim" data-goal="add">Opslaan</button>';
  }
  h += '</div>';

  /* cijfers */
  const weken = state.sessions.length ? Math.max(1, Math.ceil(daysBetween(parseKey(state.sessions.slice().sort((a, b) => a.ts - b.ts)[0].date), today()) / 7)) : 0;
  h += statRow([
    { v: state.sessions.length, k: state.sessions.length === 1 ? 'training' : 'trainingen' },
    { v: weken, k: weken === 1 ? 'week bezig' : 'weken bezig' },
    { v: state.mobility.length, k: 'keer mobiliteit' }
  ]);

  h += '<div class="section"><h2>Oefening opzoeken</h2></div><div class="card tight"><ul class="rows">' +
    Object.keys(EXERCISE_INFO).map(n =>
      '<li data-info="' + esc(n) + '"><span class="main"><span class="name">' + esc(n) + '</span></span>' +
      '<span class="right">' + ICON.info + '</span></li>').join('') + '</ul></div>';

  const s = state.settings;
  h += '<div class="section"><h2>Instellingen</h2></div><div class="card">' +
    '<div class="veld"><label for="r1">Rust bij de eerste twee oefeningen</label>' + restSelect('r1', 'rest1', s.rest1) + '</div>' +
    '<div class="veld"><label for="r2">Rust bij de rest</label>' + restSelect('r2', 'rest2', s.rest2) + '</div>' +
    '<div class="check' + (s.sound ? ' on' : '') + '" data-sound="1" style="margin-top:14px">' +
    '<span class="box">' + ICON.check + '</span><span class="main"><span class="name">Piepje als de rust voorbij is</span></span></div></div>';

  h += '<div class="section"><h2>Je gegevens</h2></div><div class="card">' +
    '<p class="dim small">Alles staat op dit apparaat. Maak af en toe een back-up, dan raak je niks kwijt en kun je het op je laptop terugzetten.</p>' +
    '<button class="btn slim" data-backup="1">Back-up kopieren</button>' +
    '<button class="btn slim" data-import="1">Back-up terugzetten</button>' +
    '<button class="btn slim" data-export="1">Samenvatting voor Claude</button>' +
    '<button class="btn ghost danger slim" data-wipe="1">Alles wissen</button></div>';
  return h;
}

function addWeight() {
  const veld = el('w-kg');
  const kg = Number(String(veld.value).replace(',', '.'));
  if (!kg || kg < 20 || kg > 250) return alert('Vul je gewicht in kilo in.');
  state.weights = state.weights.filter(x => x.date !== todayKey());
  state.weights.push({ date: todayKey(), kg: Math.round(kg * 10) / 10 });
  save();
  render();
  toast('Gewicht opgeslagen');
}

function addGoal() {
  const type = el('goal-type').value;
  const datum = el('goal-date').value;
  if (type === 'geen') { state.goal = null; save(); return render(); }
  if (!datum) return alert('Vul een datum in.');
  if (daysBetween(today(), parseKey(datum)) < 0) return alert('Die datum is al geweest.');
  state.goal = { type: type, date: datum };
  state.flags.triIntroShown = false;
  save();
  render();
}

function restSelect(id, sleutel, waarde) {
  const opties = [60, 90, 120, 150, 180, 210, 240, 300];
  return '<select id="' + id + '" data-setting="' + sleutel + '">' +
    opties.map(o => '<option value="' + o + '"' + (Number(waarde) === o ? ' selected' : '') + '>' + mmss(o) + ' minuten</option>').join('') +
    '</select>';
}

/* ================= back-up ================= */

function copyBackup() {
  copyText(JSON.stringify(state), 'Back-up gekopieerd', 'Plak dit in een notitie of stuur het naar jezelf. Met "Back-up terugzetten" zet je het op een ander apparaat terug.');
}

function importBackup() {
  showModal('<h2>Back-up terugzetten</h2><p class="dim small">Plak hier de tekst van je back-up. Wat er nu in de app staat wordt vervangen.</p>' +
    '<textarea id="imp" style="width:100%;height:140px;background:var(--surface-2);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:10px;font-size:12px"></textarea>' +
    '<button class="btn accent" data-doimport="1">Terugzetten</button><button class="btn ghost" data-close="1">Annuleren</button>');
}

function doImport() {
  const txt = el('imp').value.trim();
  if (!txt) return alert('Er staat niets in het vak.');
  let data;
  try { data = JSON.parse(txt); } catch (e) { return alert('Dit is geen geldige back-up.'); }
  if (!data || !Array.isArray(data.sessions)) return alert('Dit lijkt geen back-up van deze app.');
  if (!confirm('Terugzetten? Je huidige gegevens worden vervangen.')) return;
  state = Object.assign(defaultState(), data);
  state.settings = Object.assign(defaultState().settings, data.settings || {});
  save();
  closeModal();
  go('home');
  toast(state.sessions.length + ' trainingen teruggezet');
}

/* ================= export ================= */

function buildExport() {
  const from = addDays(today(), -28);
  const list = state.sessions.filter(s => daysBetween(from, parseKey(s.date)) >= 0).sort((a, b) => a.ts - b.ts);
  const lines = [];
  lines.push('Trainingsoverzicht laatste 4 weken');
  lines.push('Fase: ' + currentPhase() + (state.goal ? ' (doel ' + goalLabel(state.goal.type) + ' op ' + state.goal.date + ', nog ' + weeksToGo() + ' weken)' : ' (geen doel ingesteld)'));
  lines.push('Trainingen: ' + list.length);
  lines.push('');

  list.forEach(s => {
    lines.push(s.date + '  ' + s.title);
    if (s.type === 'cardio') {
      lines.push('  ' + s.km + ' km in ' + s.minutes + ' min, zwaarte ' + (s.rpe || '?') + '/10');
    } else {
      s.entries.forEach(e => lines.push('  ' + e.name + ': ' + e.sets.map(x => fmtKg(x.weight) + 'kg x ' + x.reps).join(', ')));
    }
    lines.push('');
  });

  /* Waar je vastloopt: oefeningen waar het gewicht al 3 keer niet omhoog ging. */
  const stuck = [];
  allTrackedExercises().forEach(n => {
    const h = historyFor(n).slice(-3);
    if (h.length === 3 && topWeight(h[0].sets) >= topWeight(h[2].sets)) {
      stuck.push(n + ' staat op ' + fmtKg(topWeight(h[2].sets)) + ' kg sinds ' + h[0].date);
    }
  });
  lines.push('Waar het niet vooruit gaat:');
  lines.push(stuck.length ? stuck.map(x => '- ' + x).join('\n') : '- niets opvallends');
  lines.push('');
  lines.push('Mobiliteit gedaan: ' + state.mobility.filter(m => daysBetween(from, parseKey(m.date)) >= 0).length + ' keer.');
  const g = laatsteGewicht();
  if (g) {
    const v = gewichtsVerschil();
    lines.push('Lichaamsgewicht: ' + fmtKg(g.kg) + ' kg' + (v ? ' (' + (v.verschil >= 0 ? '+' : '') + fmtKg(v.verschil) + ' kg sinds ' + v.sinds + ')' : ''));
  }
  if (state.profile.geboortejaar || state.profile.lengte) {
    lines.push('Profiel: ' + (leeftijd() ? leeftijd() + ' jaar' : '') + (state.profile.lengte ? ', ' + state.profile.lengte + ' cm' : ''));
  }
  return lines.join('\n');
}

function copyExport() {
  copyText(buildExport(), 'Gekopieerd', 'Plak het in een gesprek met Claude en vraag wat je moet aanpassen.');
}

/* Kopieren lukt niet in elke browser, daarom staat de tekst er ook gewoon bij. */
function copyText(text, titel, uitleg) {
  const done = () => showModal('<h2>' + esc(titel) + '</h2><p class="dim small">' + esc(uitleg) + '</p>' +
    '<textarea readonly style="width:100%;height:150px;background:var(--surface-2);color:var(--dim);border:1px solid var(--line);border-radius:12px;padding:10px;font-size:12px">' + esc(text) + '</textarea>' +
    '<button class="btn accent" data-close="1">Sluiten</button>');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallbackCopy);
  } else fallbackCopy();

  function fallbackCopy() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* dan kopieer je het met de hand */ }
    document.body.removeChild(ta);
    done();
  }
}

/* ================= modaal ================= */

function showModal(html) {
  el('modal-box').innerHTML = html;
  el('modal').classList.remove('hidden');
}
function closeModal() { el('modal').classList.add('hidden'); }

function showInfo(name) {
  const i = infoFor(name);
  if (!i) return;
  showModal('<h2>' + esc(exKey(name)) + '</h2>' +
    '<div class="info-line"><b>Spier</b>' + esc(i.spier) + '</div>' +
    '<div class="info-line"><b>Let op</b>' + esc(i.techniek) + '</div>' +
    '<div class="info-line"><b>Fout die je snel maakt</b>' + esc(i.fout) + '</div>' +
    '<button class="btn accent" data-close="1">Sluiten</button>');
}

function showSession(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  let h = '<h2>' + esc(s.title) + '</h2><p class="dim small">' + esc(formatLong(s.date)) + ', ' + esc(sessionSummaryLine(s)) + '</p>';
  if (s.type === 'gym') {
    h += '<ul class="rows mt">' + s.entries.map(e =>
      '<li><span class="main"><span class="name">' + esc(e.name) + '</span></span><span class="right">' +
      e.sets.map(x => fmtKg(x.weight) + 'x' + x.reps).join('  ') + '</span></li>').join('') + '</ul>';
  }
  if (s.note) h += '<div class="note grey">' + esc(s.note) + '</div>';
  h += '<button class="btn slim" data-reopen="' + s.id + '">Aanpassen</button>';
  h += '<button class="btn ghost danger slim" data-delsession="' + s.id + '">Verwijder deze training</button>';
  h += '<button class="btn accent" data-close="1">Sluiten</button>';
  showModal(h);
}

function maybeTriathlonIntro() {
  if (currentPhase() !== 'triathlon' || state.flags.triIntroShown) return;
  state.flags.triIntroShown = true;
  save();
  showModal('<h2>Je gaat naar de triathlonfase</h2><p class="dim">' + esc(TRIATHLON_INTRO) + '</p>' +
    '<button class="btn accent" data-close="1">Begrepen</button>');
}

/* ================= router ================= */

function render() {
  pruneGoal();
  const app = el('app');
  const screens = {
    home: screenHome, kalender: screenKalender, voortgang: screenVoortgang,
    mobiliteit: screenMobiliteit, profiel: screenProfiel,
    warmup: screenWarmup, training: screenTraining, mobrun: screenMobrun, afronden: screenAfronden
  };
  app.innerHTML = (screens[view.name] || screenHome)();
  keepAwake(view.name === 'training' || view.name === 'mobrun');
  renderTabs();
  drawCharts();
  drawRest();
  maybeTriathlonIntro();
}

/* ================= klikken en typen ================= */

function closestData(node, key) {
  while (node && node !== document.body) {
    if (node.dataset && node.dataset[key] !== undefined) return node;
    node = node.parentNode;
  }
  return null;
}

document.addEventListener('click', e => {
  const hit = k => closestData(e.target, k);
  let n;

  if ((n = hit('close'))) return closeModal();
  if ((n = hit('tab'))) { closeModal(); return go(n.dataset.tab); }
  if ((n = hit('tabMob'))) { closeModal(); return go('mobiliteit'); }
  if ((n = hit('vtab'))) return go('voortgang', { deel: n.dataset.vtab, ex: view.ex });
  if ((n = hit('addweight'))) return addWeight();
  if ((n = hit('delweight'))) {
    state.weights = state.weights.filter(x => x.date !== n.dataset.delweight);
    save(); return render();
  }
  if ((n = hit('back'))) {
    closeModal();
    if (view.name === 'mobrun') { mobTimer = null; return go('mobiliteit'); }
    if (view.name === 'afronden') return go('training', { i: 0 });
    return go('home');
  }

  /* trainingen starten en hervatten */
  if ((n = hit('start'))) return startWorkout(n.dataset.start);
  if ((n = hit('startdate'))) {
    const p = n.dataset.startdate.split('|');
    return startWorkout(p[0], p[1]);
  }
  if ((n = hit('choose'))) return chooseWorkout(n.dataset.choose);
  if ((n = hit('resume'))) return go('training', { i: 0 });
  if ((n = hit('reopen'))) return reopenSession(n.dataset.reopen);
  if ((n = hit('cancel'))) return cancelSession();

  /* kalender */
  if ((n = hit('month'))) return go('kalender', { month: n.dataset.month, sel: view.sel });
  if ((n = hit('day'))) { closeModal(); return go('kalender', { sel: n.dataset.day, month: n.dataset.day.slice(0, 7) }); }

  /* warming-up */
  if ((n = hit('warm'))) return toggleWarm(Number(n.dataset.warm));
  if ((n = hit('warmdone'))) { state.warmup[todayKey()] = true; save(); return go('training', { i: 0 }); }
  if ((n = hit('warmskip'))) return go('training', { i: 0 });

  /* in de training */
  if ((n = hit('tick'))) return tickSet(Number(n.dataset.tick));
  if ((n = hit('addset'))) return addSet();
  if ((n = hit('delset'))) return removeSet();
  if ((n = hit('goex'))) {
    const w = activeWorkout();
    const i = Number(n.dataset.goex);
    if (i >= w.exercises.length) return go('afronden');
    return go('training', { i: i });
  }
  if ((n = hit('skip'))) return skipExercise(Number(n.dataset.skip));
  if ((n = hit('afronden'))) return go('afronden');
  if ((n = hit('finish'))) return finishSession();
  if ((n = hit('rpe'))) { state.active.cardio.rpe = n.dataset.rpe; save(); return render(); }
  if ((n = hit('rest'))) {
    if (n.dataset.rest === 'stop') return stopRest();
    restTimer.endsAt += 30000; restTimer.total += 30; restTimer.beeped = false;
    return drawRest();
  }

  /* mobiliteit */
  if ((n = hit('mob'))) return startMobility(n.dataset.mob);
  if ((n = hit('mobctl'))) return mobControl(n.dataset.mobctl);

  /* uitleg en geschiedenis */
  if ((n = hit('info'))) return showInfo(n.dataset.info);
  if ((n = hit('openSession'))) return showSession(n.dataset.openSession);
  if ((n = hit('delsession'))) {
    if (!confirm('Deze training verwijderen?')) return;
    state.sessions = state.sessions.filter(x => x.id !== n.dataset.delsession);
    save(); closeModal(); return render();
  }
  if ((n = hit('swim'))) {
    state.swim[n.dataset.swim] = !state.swim[n.dataset.swim];
    save(); return render();
  }

  /* instellingen */
  if ((n = hit('goal'))) {
    if (n.dataset.goal === 'add') return addGoal();
    state.goal = null; state.flags.triIntroShown = false; save(); return render();
  }
  if ((n = hit('sound'))) { state.settings.sound = !state.settings.sound; save(); return render(); }
  if ((n = hit('export'))) return copyExport();
  if ((n = hit('backup'))) return copyBackup();
  if ((n = hit('import'))) return importBackup();
  if ((n = hit('doimport'))) return doImport();
  if ((n = hit('wipe'))) {
    if (!confirm('Alles wissen? Je trainingen, doel en geschiedenis verdwijnen.')) return;
    localStorage.removeItem(STORE_KEY);
    state = defaultState();
    save();
    return go('home');
  }
  if (e.target.id === 'modal') return closeModal();
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.in && state.active) return setField(Number(t.dataset.set), t.dataset.in, t.value);
  if (t.dataset.cardio && state.active) { state.active.cardio[t.dataset.cardio] = t.value; return save(); }
  if (t.dataset.note && state.active) { state.active.note = t.value; return save(); }
  if (t.dataset.profiel) { state.profile[t.dataset.profiel] = t.value; return save(); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.exsel) return go('voortgang', { ex: t.value, deel: 'oefeningen' });
  if (t.dataset.setting) { state.settings[t.dataset.setting] = Number(t.value); return save(); }
  if (t.dataset.cardio && state.active) { state.active.cardio[t.dataset.cardio] = t.value; save(); }
});

window.addEventListener('resize', drawCharts);

/* ================= start ================= */

if (state.active && state.active.date !== todayKey()) { state.active = null; }
save();
render();
