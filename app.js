/* app.js - de hele app: startscherm, kalender, training, mobiliteit, voortgang, instellingen. */

const STORE_KEY = 'schema-app-v1';
const VERSIE = '7';
const DAY_MS = 86400000;

let state = load();
let view = { name: 'vandaag' };
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
    routines: DEFAULT_ROUTINES.map(r => Object.assign({}, r)),
    events: [],       // losse afspraken
    goals: DEFAULT_GOALS.map(g => Object.assign({ log: [] }, g)),
    offdays: {},      // dagen waarop iets vervalt
    notes: {},        // losse dingen die je doorgeeft
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
  { name: 'vandaag', label: 'Vandaag', icon: 'home' },
  { name: 'agenda', label: 'Agenda', icon: 'cal' },
  { name: 'doelen', label: 'Doelen', icon: 'chart' },
  { name: 'profiel', label: 'Meer', icon: 'user' }
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

/* ================= agenda: tijd en blokken ================= */

function toMin(t) {
  const p = String(t).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}
function toTijd(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function duurTekst(min) {
  if (min < 60) return min + ' min';
  const u = Math.floor(min / 60), r = min % 60;
  return u + ' uur' + (r ? ' ' + r : '');
}

function routinesOn(d) {
  const uit = (state.offdays && state.offdays[dateKey(d)]) || [];
  if (uit.indexOf('alles') !== -1) return [];
  return state.routines.filter(r => r.days.indexOf(d.getDay()) !== -1 && uit.indexOf(r.id) === -1);
}
function eventsOn(d) {
  const k = dateKey(d);
  return state.events.filter(e => e.date === k);
}

/* Alles wat vaststaat op een dag, op volgorde van tijd. */
function blocksOn(d) {
  const uit = [];
  routinesOn(d).forEach(r => uit.push({
    van: toMin(r.start), tot: toMin(r.end), titel: r.title, kind: r.kind,
    energie: r.energie || 0, vast: true, id: r.id
  }));
  eventsOn(d).forEach(e => uit.push({
    van: toMin(e.start || '12:00'), tot: toMin(e.end || e.start || '13:00'), titel: e.title,
    kind: e.kind, energie: e.kind === 'sociaal' ? -1 : 0, vast: false, id: e.id, note: e.note
  }));
  return uit.sort((a, b) => a.van - b.van);
}

/* De gaten tussen die blokken, van opstaan tot slapen. */
function gapsOn(d, minLengte) {
  const blokken = blocksOn(d).slice().sort((a, b) => a.van - b.van);
  const gaten = [];
  let cursor = toMin(DAG_START);
  const eind = toMin(DAG_EIND);

  /* Vandaag beginnen we niet in het verleden. */
  if (dateKey(d) === todayKey()) {
    const nu = new Date().getHours() * 60 + new Date().getMinutes();
    cursor = Math.max(cursor, Math.ceil(nu / 15) * 15);
  }

  blokken.forEach(b => {
    if (b.van > cursor) gaten.push({ van: cursor, tot: Math.min(b.van, eind) });
    cursor = Math.max(cursor, b.tot);
  });
  if (cursor < eind) gaten.push({ van: cursor, tot: eind });

  /* Een gat voor school telt niet mee, daar ga je niks in doen. */
  const eersteVast = blokken.filter(b => b.vast && b.van <= toMin('09:30')).map(b => b.van).sort((a, b) => a - b)[0];

  return gaten
    .map(g => ({
      van: g.van, tot: g.tot, lengte: g.tot - g.van,
      naSport: naZwaarBlok(blokken, g.van),
      vroeg: eersteVast !== undefined && g.tot <= eersteVast
    }))
    .filter(g => g.lengte >= (minLengte || 20));
}

/* Zit er vlak voor dit gat iets waar je moe van wordt? */
function naZwaarBlok(blokken, start) {
  return blokken.some(b => b.energie <= -2 && start - b.tot >= 0 && start - b.tot < 60);
}

/* ================= doelen ================= */

function goalById(id) { return state.goals.find(g => g.id === id) || null; }

function goalLog(g) { return g.log || (g.log = []); }

function doneThisWeek(g) {
  const mon = mondayOf(today());
  return goalLog(g).filter(x => { const n = daysBetween(mon, parseKey(x.date)); return n >= 0 && n < 7; });
}

function daysSince(g) {
  const log = goalLog(g);
  if (!log.length) return 7;
  const laatste = log.map(x => x.date).sort().pop();
  return daysBetween(parseKey(laatste), today());
}

function daysUntil(datum) {
  if (!datum) return null;
  return daysBetween(today(), parseKey(datum));
}

/* Hoe hard iets nu roept. Hoger is eerder aan de beurt. */
function goalScore(g) {
  if (!g.actief) return -1;
  let score = 1;
  const tekort = Math.max(0, (g.perWeek || 1) - doneThisWeek(g).length);
  score += tekort * 2.2;
  score += Math.min(daysSince(g), 14) * 0.35;

  const dagen = daysUntil(g.deadline);
  if (dagen !== null) {
    if (dagen < 0) score += 6;
    else if (dagen <= 30) score += (30 - dagen) / 4;
  }
  if (g.prio === 'hoog') score += 3;
  if (g.prio === 'laag') score -= 2;
  if (goalLog(g).some(x => x.date === todayKey())) score -= 5;
  return score;
}

function goalReason(g) {
  const tekort = Math.max(0, (g.perWeek || 1) - doneThisWeek(g).length);
  const dagen = daysUntil(g.deadline);
  if (!goalLog(g).length) return 'hier ben je nog niet aan begonnen';
  if (dagen !== null && dagen <= 14) return dagen < 0 ? 'deadline is voorbij' : 'nog ' + plural(dagen, 'dag', 'dagen') + ' tot je deadline';
  if (daysSince(g) >= 10) return 'ligt al ' + daysSince(g) + ' dagen stil';
  if (tekort > 0) return tekort + ' van de ' + g.perWeek + ' keer nog te gaan deze week';
  return 'loopt lekker, extra rondje mag';
}

/* ================= de dagplanner ================= */

/* Alles wat vandaag zou kunnen, met een reden erbij. */
function candidates(d) {
  const lijst = [];
  const k = dateKey(d);
  if (state.flags.rustdagen && state.flags.rustdagen[k]) return lijst;

  const w = workoutForDate(d);
  if (w && !sessionOn(k)) {
    lijst.push({
      soort: 'gym', id: w.id, titel: w.title,
      minuten: w.type === 'gym' ? 75 : 60,
      score: 7, reden: 'staat vandaag in je schema', zwaar: true
    });
  }

  const overgeslagen = (state.flags.skips && state.flags.skips[k]) || [];
  state.goals.filter(g => g.actief && overgeslagen.indexOf(g.id) === -1).forEach(g => {
    const s = goalScore(g);
    if (s <= 0) return;
    lijst.push({
      soort: 'doel', id: g.id, titel: g.title, minuten: g.minutes || 30,
      score: s, reden: goalReason(g), zwaar: false
    });
  });

  const zwaarVandaag = blocksOn(d).some(b => b.energie <= -2) || !!sessionOn(k);
  if (zwaarVandaag && !state.mobility.some(m => m.date === k)) {
    const routine = MOBILITY[sessionOn(k) && String(sessionOn(k).workoutId).indexOf('benen') !== -1 ? 0 : 1];
    lijst.push({
      soort: 'mobiliteit', id: routine.id, titel: 'Mobiliteit: ' + routine.title.toLowerCase(),
      minuten: 15, score: 3, zwaar: false,
      reden: routine.exercises.slice(0, 3).join(', ').toLowerCase() + ' en meer, ' + routine.seconds + 's per kant'
    });
  }

  return lijst.sort((a, b) => b.score - a.score);
}

/* Zet de kandidaten in de gaten van je dag. Gym eerst, die staat in je schema. */
function planDay(d) {
  const gaten = gapsOn(d, 20).map(g => Object.assign({}, g));
  const alles = candidates(d);
  const plan = [];

  const zwaarDag = blocksOn(d).some(b => b.energie <= -2);
  const maxLos = zwaarDag ? 2 : 3;
  let losMinuten = 0;
  let los = 0;

  /* Gym en mobiliteit horen bij je week, die plaats ik eerst. */
  alles.filter(c => c.soort === 'gym' || c.soort === 'mobiliteit').forEach(c => plaats(c, c.soort === 'gym'));
  alles.filter(c => c.soort !== 'gym' && c.soort !== 'mobiliteit').forEach(c => {
    if (los >= maxLos || losMinuten >= 150) return;
    if (plaats(c, false)) { los++; losMinuten += c.minuten; }
  });

  function plaats(c, vast) {
    const passend = gaten.filter(g =>
      g.lengte >= c.minuten + 10 &&
      !g.vroeg &&
      !(c.zwaar && g.naSport)
    );
    /* Liever laat op de dag dan tussendoor, behalve als het niet anders kan. */
    const gat = passend.sort((a, b) => a.van - b.van)[vast ? passend.length - 1 : 0] || passend[0];
    if (!gat) return false;
    plan.push({
      van: gat.van, tot: gat.van + c.minuten,
      titel: c.titel, soort: c.soort, id: c.id, reden: c.reden, minuten: c.minuten
    });
    gat.van += c.minuten + 10;
    gat.lengte = gat.tot - gat.van;
    return true;
  }

  return plan.sort((a, b) => a.van - b.van);
}

/* Blokken en plan door elkaar, zoals je dag er echt uitziet. */
function dagLijn(d) {
  const rijen = blocksOn(d).map(b => ({
    van: b.van, tot: b.tot, titel: b.titel, kind: b.kind, vast: true, id: b.id, evId: b.evId, note: b.note
  }));
  const plan = planDay(d);
  plan.forEach(p => rijen.push({
    van: p.van, tot: p.tot, titel: p.titel, kind: p.soort, vast: false,
    id: p.id, reden: p.reden, minuten: p.minuten
  }));

  /* Gym en mobiliteit horen altijd zichtbaar te zijn, ook als je dag vol zit. */
  candidates(d).filter(c => c.soort === 'gym' || c.soort === 'mobiliteit').forEach(c => {
    if (plan.some(p => p.soort === c.soort)) return;
    rijen.push({
      van: toMin(DAG_EIND), tot: toMin(DAG_EIND), titel: c.titel, kind: c.soort, vast: false,
      id: c.id, minuten: c.minuten, geenTijd: true,
      reden: c.soort === 'gym' ? 'past er vandaag niet meer bij, kort houden of morgen doen' : c.reden
    });
  });

  return rijen.sort((a, b) => a.van - b.van);
}

/* ================= wat de app opmerkt ================= */

function nudges() {
  const uit = [];
  const morgen = addDays(today(), 1);

  /* afspraken die eraan komen */
  eventsOn(morgen).forEach(e => {
    uit.push({ toon: 'info', tekst: 'Morgen ' + e.title.toLowerCase() + ' om ' + (e.start || '?') + '.' });
  });

  /* botsingen tussen een afspraak en je vaste week */
  [0, 1, 2, 3, 4, 5, 6].forEach(n => {
    const d = addDays(today(), n);
    const vast = routinesOn(d);
    eventsOn(d).forEach(e => {
      const ev = { van: toMin(e.start || '12:00'), tot: toMin(e.end || e.start || '13:00') };
      vast.forEach(r => {
        if (ev.van < toMin(r.end) && ev.tot > toMin(r.start)) {
          uit.push({
            toon: 'let op',
            tekst: e.title + ' loopt door ' + r.title.toLowerCase() + ' heen op ' + DAY_NAMES[d.getDay()] + '.',
            actie: r.kind === 'sport' ? null : null
          });
        }
      });
    });
  });

  /* gym die door een afspraak in de knel komt */
  const gymDagen = [0, 1, 2, 3, 4, 5, 6].map(n => addDays(today(), n))
    .filter(d => workoutForDate(d) && !sessionOn(dateKey(d)));
  gymDagen.slice(0, 3).forEach(d => {
    if (gapsOn(d, 75).length === 0) {
      const vrij = gymDagen.find(x => daysBetween(d, x) > 0 && gapsOn(x, 75).length);
      uit.push({
        toon: 'let op',
        tekst: 'Op ' + DAY_NAMES[d.getDay()] + ' past je gym er niet meer bij' +
          (vrij ? '. Schuif hem naar ' + DAY_NAMES[vrij.getDay()] + '.' : '. Hou het die dag kort of sla hem over.')
      });
    }
  });

  /* doelen die stilliggen */
  state.goals.filter(g => g.actief && daysSince(g) >= 10 && goalLog(g).length).forEach(g => {
    uit.push({ toon: 'stil', tekst: g.title + ' heb je ' + daysSince(g) + ' dagen niet aangeraakt.' });
  });

  /* deadlines */
  state.goals.filter(g => g.actief && g.deadline).forEach(g => {
    const n = daysUntil(g.deadline);
    if (n !== null && n >= 0 && n <= 14 && doneThisWeek(g).length < (g.perWeek || 1)) {
      uit.push({ toon: 'let op', tekst: g.title + ': nog ' + plural(n, 'dag', 'dagen') + ' en je loopt achter op je eigen ritme.' });
    }
  });

  /* wedstrijd morgen */
  if (routinesOn(morgen).some(r => /wedstrijd/i.test(r.title))) {
    uit.push({ toon: 'info', tekst: 'Morgen wedstrijd. Hou het vanavond rustig, geen zware benen.' });
  }

  return uit.slice(0, 4);
}

/* ================= wat je intypt ================= */

/* Je typt een zin, de app probeert er iets mee te doen. */
function verwerkZin(tekst) {
  const t = tekst.toLowerCase().trim();
  if (!t) return null;

  const datum = vindDatum(t);
  const tijden = vindTijden(t);

  /* dagen die vervallen */
  if (/(\bgeen\b|\bvrij\b|\buitval\b|\bafgelast\b|\bvervalt\b|niet naar)/.test(t)) {
    const welke = /school|les/.test(t) ? 'school' : /hockey|training|wedstrijd/.test(t) ? 'sport' : /werk/.test(t) ? 'werk' : null;
    const dag = datum || todayKey();
    state.offdays = state.offdays || {};
    const raken = welke ? state.routines.filter(r => r.kind === welke).map(r => r.id) : ['alles'];
    state.offdays[dag] = (state.offdays[dag] || []).concat(raken);
    save();
    return { tekst: (welke ? welke : 'alles') + ' staat uit op ' + formatDate(dag) + ', ik plan die tijd opnieuw in.', herstel: { soort: 'offday', dag: dag } };
  }

  /* ziek of kapot */
  if (/(\bziek\b|\bkapot\b|geblesseerd|\bgriep\b)/.test(t)) {
    const dag = datum || todayKey();
    state.offdays = state.offdays || {};
    state.offdays[dag] = ['alles'];
    state.flags.rustdagen = state.flags.rustdagen || {};
    state.flags.rustdagen[dag] = true;
    save();
    return { tekst: 'Rustdag op ' + formatDate(dag) + '. Ik stel niks zwaars voor.', herstel: { soort: 'offday', dag: dag } };
  }

  /* nieuw doel */
  if (/(nieuw doel|ik wil|ga ik|wil ik gaan|doel:)/.test(t)) {
    const naam = tekst.replace(/^(nieuw doel[:,]?|ik wil( gaan)?|ik ga|doel:)\s*/i, '').trim();
    if (naam.length > 1) {
      const g = {
        id: 'g' + Date.now(), title: naam.charAt(0).toUpperCase() + naam.slice(1),
        kind: /leren|koken|taal|gitaar/.test(t) ? 'leren' : 'maken',
        perWeek: 2, minutes: 30, deadline: '', prio: 'normaal', actief: true, log: []
      };
      state.goals.push(g);
      save();
      return { tekst: g.title + ' staat erbij. Hoe belangrijk is het?', vraagPrio: g.id };
    }
  }

  /* iets wat elke week terugkomt hoort in je vaste week */
  if (tijden && /\b(elke|iedere|altijd|wekelijks|standaard)\b/.test(t)) {
    const dag = vindWeekdag(t);
    if (dag !== null) {
      const soort = /werk|bijbaan/.test(t) ? 'werk' : /hockey|training|sport|zwem/.test(t) ? 'sport'
        : /les|school|bijles/.test(t) ? 'school' : 'anders';
      const r = {
        id: 'r' + Date.now(), title: netteTitel(tekst), kind: soort, days: [dag],
        start: tijden.van, end: tijden.tot, energie: soort === 'sport' ? -2 : -1
      };
      state.routines.push(r);
      save();
      return { tekst: r.title + ' staat nu elke ' + DAY_NAMES[dag] + ' in je week, ' + r.start + ' tot ' + r.end + '.' };
    }
  }

  /* iets met een tijd erin is een afspraak */
  if (tijden) {
    const dag = datum || todayKey();
    const soort = /werk/.test(t) ? 'werk' : /feest|verjaardag|borrel|vrienden|film|stappen/.test(t) ? 'sociaal'
      : /tandarts|ortho|dokter|kapper|huisarts/.test(t) ? 'afspraak'
      : /toets|so|proefwerk|repetitie|deadline/.test(t) ? 'school' : 'afspraak';
    const e = {
      id: 'e' + Date.now(), title: netteTitel(tekst), kind: soort,
      date: dag, start: tijden.van, end: tijden.tot, note: ''
    };
    state.events.push(e);
    save();
    return { tekst: e.title + ' staat in je agenda op ' + formatDate(dag) + ', ' + e.start + ' tot ' + e.end + '.', herstel: { soort: 'event', id: e.id }, botsing: e };
  }

  /* de rest bewaren we als notitie bij de dag */
  const dag = datum || todayKey();
  state.notes = state.notes || {};
  state.notes[dag] = (state.notes[dag] || []).concat([tekst.trim()]);
  save();
  return { tekst: 'Genoteerd bij ' + formatDate(dag) + '. Zet er een tijd bij als het ook in je dag moet staan.' };
}

function netteTitel(tekst) {
  let s = tekst.replace(/^\s*(ik\s+(heb|ga|moet|werk)?)\s*/i, m => /werk/i.test(m) ? 'werk ' : '').replace(/\b(van|tot|om|op)\s*\d{1,2}([:.]\d{2})?\b/gi, ' ')
    .replace(/\b(vandaag|morgen|overmorgen|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/gi, ' ')
    .replace(/\b(elke|iedere|altijd|wekelijks|standaard)\b/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[ ,.-]+|[ ,.-]+$/g, '').trim();
  if (!s) s = 'Afspraak';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function vindWeekdag(t) {
  for (const naam in WOORDEN.dagen) {
    if (new RegExp('\\b' + naam + '\\b').test(t)) return WOORDEN.dagen[naam];
  }
  return null;
}

function vindDatum(t) {
  if (/overmorgen/.test(t)) return dateKey(addDays(today(), 2));
  if (/morgen/.test(t)) return dateKey(addDays(today(), 1));
  if (/vandaag|vanavond|vanmiddag|straks|nu/.test(t)) return todayKey();

  for (const naam in WOORDEN.dagen) {
    if (new RegExp('\\b' + naam + '\\b').test(t)) {
      const doelDag = WOORDEN.dagen[naam];
      for (let i = 1; i <= 7; i++) {
        const d = addDays(today(), i);
        if (d.getDay() === doelDag) return dateKey(d);
      }
    }
  }
  const m = t.match(/\b(\d{1,2})[-\/](\d{1,2})\b/);
  if (m) {
    const d = new Date(today().getFullYear(), Number(m[2]) - 1, Number(m[1]));
    if (daysBetween(today(), d) < -1) d.setFullYear(d.getFullYear() + 1);
    return dateKey(d);
  }
  return null;
}

function vindTijden(t) {
  const reeks = t.match(/(\d{1,2})([:.](\d{2}))?\s*(?:tot|-|\/)\s*(\d{1,2})([:.](\d{2}))?/);
  if (reeks) {
    const van = uur(reeks[1], reeks[3]);
    let tot = uur(reeks[4], reeks[6]);
    if (toMin(tot) <= toMin(van)) tot = '23:59';   /* loopt door tot na middernacht */
    return { van: van, tot: tot };
  }
  const los = t.match(/(?:om|vanaf)\s*(\d{1,2})([:.](\d{2}))?/);
  if (los) {
    const van = uur(los[1], los[3]);
    return { van: van, tot: toTijd(Math.min(toMin(van) + 60, 23 * 60 + 59)) };
  }
  return null;
}

function uur(u, m) {
  return String(Math.min(23, Number(u))).padStart(2, '0') + ':' + String(m ? Number(m) : 0).padStart(2, '0');
}

/* ================= ik heb nu tijd ================= */

function nuTijd(minuten) {
  const nu = new Date().getHours() * 60 + new Date().getMinutes();
  const opties = candidates(today())
    .filter(c => c.minuten <= minuten)
    .slice(0, 4);

  if (!opties.length) {
    return showModal('<h2>Even niks</h2><p class="dim">Voor ' + minuten + ' minuten heb ik niks staan. Prima moment om niks te doen.</p>' +
      '<button class="btn accent" data-close="1">Ook goed</button>');
  }

  let h = '<h2>' + minuten + ' minuten</h2><p class="dim small">Op volgorde van wat het hardst roept.</p><ul class="rows">';
  opties.forEach((c, i) => {
    h += '<li><span class="vak ' + c.soort + '">' + (i + 1) + '</span>' +
      '<span class="main"><span class="name">' + esc(c.titel) + '</span><br><span class="meta">' + esc(c.reden) + '</span></span>' +
      '<span class="right">' + c.minuten + ' min</span></li>';
  });
  h += '</ul>';
  const beste = opties[0];
  if (beste.soort === 'gym') h += '<button class="btn accent" data-start="' + beste.id + '">' + beste.titel + ' beginnen</button>';
  else if (beste.soort === 'mobiliteit') h += '<button class="btn accent" data-mob="' + beste.id + '">' + beste.titel + ' starten</button>';
  else h += '<button class="btn accent" data-logdoel="' + beste.id + '|' + beste.minuten + '">' + beste.titel + ', ik doe het</button>';
  h += '<button class="btn ghost slim" data-close="1">Later</button>';
  showModal(h);
}

function zegIets() {
  const veld = el('zeg');
  const tekst = veld ? veld.value.trim() : '';
  if (!tekst) return;
  const uit = verwerkZin(tekst);
  if (veld) veld.value = '';
  render();
  if (!uit) return;
  if (uit.vraagPrio) {
    return showModal('<h2>' + esc(uit.tekst) + '</h2>' +
      PRIO.map(p => '<button class="btn' + (p.id === 'hoog' ? ' accent' : '') + '" data-zetprio="' + uit.vraagPrio + '|' + p.id + '">' + esc(p.label) + '</button>').join(''));
  }
  if (uit.botsing) {
    toast(uit.tekst);
    return vertelOverBotsing(uit.botsing);
  }
  toast(uit.tekst);
}

function vraagTijd() {
  showModal('<h2>Hoeveel tijd heb je?</h2>' +
    '<div class="tijdkeuze">' + [20, 30, 45, 60, 90].map(m =>
      '<button data-nutijd="' + m + '">' + m + '<span>min</span></button>').join('') + '</div>' +
    '<button class="btn ghost slim" data-close="1">Laat maar</button>');
}

/* ================= kleine stukjes die overal terugkomen ================= */

function card(soort, label, titel, onder, knoppen) {
  return '<div class="card ' + soort + '">' +
    (label ? '<span class="pill' + (soort === 'accent' ? '' : ' grey') + '">' + esc(label) + '</span>' : '') +
    '<h2 class="hero-title">' + esc(titel) + '</h2>' +
    (onder ? '<p class="dim small">' + esc(onder) + '</p>' : '') +
    (knoppen || '') + '</div>';
}

function statRow(items) {
  return '<div class="stats">' + items.map(i =>
    '<div class="stat"><div class="v">' + i.v + '</div><div class="k">' + esc(i.k) + '</div></div>').join('') + '</div>';
}

function groet() {
  const u = new Date().getHours();
  const naam = state.profile.naam ? ' ' + state.profile.naam : '';
  if (u < 6) return 'Nog wakker' + naam + '?';
  if (u < 12) return 'Goedemorgen' + naam;
  if (u < 18) return 'Middag' + naam;
  return 'Avond' + naam;
}

function laatsteGewicht() {
  if (!state.weights.length) return null;
  return state.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).pop();
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
  return { count: inWeek.length, vol: inWeek.reduce((n, s) => n + sessionVolume(s), 0) };
}

function streakWeeks() {
  let n = 0;
  for (let i = 0; i < 52; i++) {
    const mon = addDays(mondayOf(today()), -7 * i);
    const c = state.sessions.filter(s => { const x = daysBetween(mon, parseKey(s.date)); return x >= 0 && x < 7; }).length;
    if (c >= 2) n++;
    else if (i > 0) break;
  }
  return n;
}

function repsText(e) {
  if (e.warmupOnly) return e.sets + ' sets warming-up';
  return e.sets + ' x ' + e.min + '-' + e.max;
}

function phaseLine() {
  if (currentPhase() === 'triathlon') {
    const w = weeksToGo();
    return '<span class="pill">Triathlon week ' + triathlonWeek() + ' van 10</span>' +
      '<span class="small dim">' + esc(goalLabel(state.goal.type)) + ' over ' + plural(w, 'week', 'weken') + '</span>';
  }
  return '<span class="pill grey">Krachtfase</span><span class="small dim">gym staat op schema</span>';
}

/* ================= kleuren ================= */

/* ma, di of ma-vr, net wat past. */
function dagenLabel(days) {
  const sorted = days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const namen = sorted.map(d => DAY_SHORT[d]);
  if (sorted.length >= 3) {
    const nrs = sorted.map(d => (d + 6) % 7);
    const opeenvolgend = nrs.every((n, i) => i === 0 || n === nrs[i - 1] + 1);
    if (opeenvolgend) return namen[0] + '-' + namen[namen.length - 1];
  }
  return namen.join(' ');
}

function kleurVoor(kind) {
  return (KLEUREN[kind] || KLEUREN.anders).hex;
}
function zacht(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

/* Een blok in je dag, met de tekst in de kleur van het soort. */
function blokRij(r, compact) {
  const hex = kleurVoor(r.kind);
  const stijl = 'background:' + zacht(hex, r.vast ? 0.14 : 0.2) + ';border-left:3px solid ' + hex;
  let knoppen = '';
  if (!r.vast && !compact) {
    if (r.kind === 'gym') knoppen = '<button class="mini-btn" data-start="' + r.id + '">beginnen</button>';
    else if (r.kind === 'mobiliteit') knoppen = '<button class="mini-btn" data-mob="' + r.id + '">starten</button>';
    else knoppen = '<button class="mini-btn" data-logdoel="' + r.id + '|' + r.minuten + '">gedaan</button>';
    knoppen += '<button class="mini-btn stil" data-skipdoel="' + r.id + '">niet nu</button>';
  }
  return '<li class="dagrij">' +
    '<span class="uur">' + (r.geenTijd ? '<span class="dim">los</span>' : toTijd(r.van) + '<br><span class="dim tiny">' + toTijd(r.tot) + '</span>') + '</span>' +
    '<span class="blok' + (r.vast ? '' : ' voorstel') + '" style="' + stijl + '"' + (r.evId ? ' data-afspraak="' + r.evId + '"' : '') + '>' +
    '<span class="btitel" style="color:' + hex + '">' + esc(r.titel) + '</span>' +
    (r.reden ? '<span class="bmeta">' + esc(r.reden) + '</span>' : '') +
    (r.note ? '<span class="bmeta">' + esc(r.note) + '</span>' : '') +
    (knoppen ? '<span class="knoppen">' + knoppen + '</span>' : '') +
    '</span></li>';
}

function dagBlokkenHtml(d, compact) {
  const rijen = dagLijn(d);
  if (!rijen.length) return leeg('Lege dag.');
  return '<ul class="dagijst">' + rijen.map(r => blokRij(r, compact)).join('') + '</ul>';
}

/* ================= vandaag ================= */

function screenVandaag() {
  const d = today();
  let h = topbar(groet(), formatLong(todayKey()));

  h += '<div class="snelrij">' +
    '<button class="snel" data-vraagtijd="1"><b>Ik heb nu tijd</b><span>wat kan ik doen?</span></button>' +
    '<button class="snel" data-nieuwafspraak="' + todayKey() + '"><b>Afspraak</b><span>erbij zetten</span></button>' +
    '</div>';

  h += '<div class="veld invoer"><input type="text" id="zeg" placeholder="Iets wat ik moet weten? Typ het hier.">' +
    '<button class="btn accent slim" data-zeg="1">Zeggen</button></div>';

  nudges().forEach(n => {
    h += '<div class="nudge ' + (n.toon === 'let op' ? 'warm' : '') + '">' + esc(n.tekst) + '</div>';
  });

  (state.notes && state.notes[todayKey()] || []).forEach(t => {
    h += '<div class="nudge">' + esc(t) + '</div>';
  });

  h += '<div class="section"><h2>Je dag</h2><span class="small dim">' + dagSamenvatting(d) + '</span></div>';
  h += dagBlokkenHtml(d);

  const gew = laatsteGewicht();
  h += statRow([
    { v: doelenDezeWeek(), k: 'doelen' },
    { v: weekStats().count, k: 'trainingen' },
    { v: gew ? fmtKg(gew.kg) : '&mdash;', k: 'kilo' }
  ]);
  return h;
}

function dagSamenvatting(d) {
  const vrij = gapsOn(d, 20).filter(g => !g.vroeg).reduce((n, g) => n + g.lengte, 0);
  if (state.flags.rustdagen && state.flags.rustdagen[dateKey(d)]) return 'rustdag';
  return vrij ? duurTekst(vrij) + ' vrij' : 'volle dag';
}

function doelenDezeWeek() {
  return state.goals.filter(g => g.actief).reduce((n, g) => n + doneThisWeek(g).length, 0);
}

function leeg(tekst) {
  return '<div class="card"><p class="dim small">' + esc(tekst) + '</p></div>';
}

/* ================= agenda ================= */

function screenAgenda() {
  const basis = view.month ? parseKey(view.month + '-01') : new Date(today().getFullYear(), today().getMonth(), 1);
  const dagen = new Date(basis.getFullYear(), basis.getMonth() + 1, 0).getDate();
  const voor = (new Date(basis.getFullYear(), basis.getMonth(), 1).getDay() + 6) % 7;
  const gekozen = view.sel || todayKey();
  const vorige = new Date(basis.getFullYear(), basis.getMonth() - 1, 1);
  const volgende = new Date(basis.getFullYear(), basis.getMonth() + 1, 1);

  let h = topbar(MONTH_NAMES[basis.getMonth()], String(basis.getFullYear()),
    '<button class="iconbtn" data-month="' + dateKey(vorige).slice(0, 7) + '">' + ICON.back + '</button>' +
    '<button class="iconbtn" data-vandaag="1">' + ICON.cal + '</button>' +
    '<button class="iconbtn" data-month="' + dateKey(volgende).slice(0, 7) + '" style="transform:rotate(180deg)">' + ICON.back + '</button>');

  h += '<div class="dagnamen">' + ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'].map(x => '<span>' + x + '</span>').join('') + '</div>';

  /* het raster, per week een rij met een dun lijntje erboven */
  h += '<div class="maand"><div class="week">';
  let cel = 0;
  for (let i = 0; i < voor; i++) { h += '<span class="dag leeg"></span>'; cel++; }
  for (let n = 1; n <= dagen; n++) {
    if (cel % 7 === 0 && cel > 0) h += '</div><div class="week">';
    const d = new Date(basis.getFullYear(), basis.getMonth(), n);
    const k = dateKey(d);
    const soorten = [];
    eventsOn(d).forEach(e => soorten.push(e.kind));
    if (workoutForDate(d) && !sessionOn(k)) soorten.push('gym');
    routinesOn(d).forEach(r => { if (r.kind !== 'school') soorten.push(r.kind); });
    const uniek = soorten.filter((x, i2) => soorten.indexOf(x) === i2).slice(0, 4);

    h += '<button class="dag' + (k === gekozen ? ' gekozen' : '') + '" data-day="' + k + '">' +
      '<span class="nr' + (k === todayKey() ? ' nu' : '') + '">' + n + '</span>' +
      '<span class="stipjes">' + uniek.map(s => '<i style="background:' + kleurVoor(s) + '"></i>').join('') + '</span></button>';
    cel++;
  }
  while (cel % 7 !== 0) { h += '<span class="dag leeg"></span>'; cel++; }
  h += '</div></div>';

  /* de gekozen dag eronder */
  const d = parseKey(gekozen);
  h += '<div class="section"><h2>' + esc(formatLong(gekozen)) + '</h2>' +
    '<button class="link" data-nieuwafspraak="' + gekozen + '">erbij</button></div>';
  const rijen = dagLijn(d);
  h += rijen.length
    ? '<ul class="dagijst">' + rijen.map(r => blokRij(r, gekozen !== todayKey())).join('') + '</ul>'
    : leeg('Niks op deze dag.');

  (state.notes && state.notes[gekozen] || []).forEach(t => { h += '<div class="nudge">' + esc(t) + '</div>'; });

  const komend = state.events
    .filter(e => daysBetween(today(), parseKey(e.date)) > 0)
    .sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 5);
  if (komend.length) {
    h += '<div class="section"><h2>Komt eraan</h2></div><div class="card tight"><ul class="rows">' +
      komend.map(e => '<li data-afspraak="' + e.id + '">' +
        '<span class="vak" style="background:' + zacht(kleurVoor(e.kind), 0.2) + ';color:' + kleurVoor(e.kind) + '">' +
        DAY_SHORT[parseKey(e.date).getDay()] + '</span>' +
        '<span class="main"><span class="name">' + esc(e.title) + '</span><br>' +
        '<span class="meta">' + esc(formatDate(e.date)) + ', ' + esc(e.start || '') + '</span></span>' +
        '<span class="right">wijzig</span></li>').join('') + '</ul></div>';
  }

  h += '<div class="section"><h2>Vaste week</h2><button class="link" data-nieuweroutine="1">erbij</button></div>';
  h += '<div class="card tight"><ul class="rows">' + (state.routines.length ? state.routines.map(r =>
    '<li data-routine="' + r.id + '">' +
    '<span class="vak breed" style="background:' + zacht(kleurVoor(r.kind), 0.2) + ';color:' + kleurVoor(r.kind) + '">' +
    esc(dagenLabel(r.days)) + '</span>' +
    '<span class="main"><span class="name">' + esc(r.title) + '</span><br>' +
    '<span class="meta">' + r.start + ' tot ' + r.end + '</span></span>' +
    '<span class="right">wijzig</span></li>').join('') :
    '<li><span class="main"><span class="meta">Nog niks vasts. Zet je school en trainingen erin.</span></span></li>') +
    '</ul></div>';
  return h;
}
/* ================= doelen ================= */

function screenDoelen() {
  const doelen = state.goals.slice().sort((a, b) => goalScore(b) - goalScore(a));
  let h = topbar('Doelen', 'op volgorde van wat nu telt',
    '<button class="iconbtn" data-nieuwdoel="">' + ICON.plus + '</button>');

  if (!doelen.length) h += leeg('Nog niks. Zet er iets in, dan pas ik het in je week.');

  doelen.forEach(g => {
    const gedaan = doneThisWeek(g).length;
    const doel = g.perWeek || 1;
    const hex = kleurVoor(g.kind);
    const bolletjes = Array.from({ length: Math.max(doel, gedaan) }, (_, i) =>
      '<span class="vakje' + (i < gedaan ? ' aan' : '') + '" style="' + (i < gedaan ? 'background:' + hex : '') + '"></span>').join('');
    h += '<div class="card' + (g.actief ? '' : ' uit') + '">' +
      '<div class="cardhead"><h3>' + esc(g.title) + '</h3>' +
      '<span class="tag" style="background:' + zacht(hex, 0.2) + ';color:' + hex + '">' + esc(g.prio === 'hoog' ? 'hoog' : g.prio === 'laag' ? 'laag' : KIND_LABEL[g.kind] || g.kind) + '</span></div>' +
      '<div class="bollen">' + bolletjes + '<span class="small dim" style="margin-left:10px">' +
      gedaan + ' van ' + doel + ' deze week</span></div>' +
      '<p class="dim small" style="margin-top:10px">' + esc(g.actief ? goalReason(g) : 'staat op pauze') + '</p>' +
      (g.deadline ? '<p class="tiny dim">deadline ' + esc(formatDate(g.deadline)) + '</p>' : '') +
      '<div class="btn-row">' +
      '<button class="btn ghost slim" data-doeldetail="' + g.id + '">bekijken</button>' +
      '<button class="btn accent slim" data-logdoel="' + g.id + '|' + (g.minutes || 30) + '">' + (g.minutes || 30) + ' min gedaan</button>' +
      '</div></div>';
  });

  const w = workoutForDate(today());
  h += '<div class="section"><h2>Vast in je week</h2></div>';
  h += '<div class="card"><div class="cardhead"><h3>Gym</h3>' +
    '<span class="tag" style="background:' + zacht(kleurVoor('gym'), 0.2) + ';color:' + kleurVoor('gym') + '">4 per week</span></div>' +
    '<p class="dim small">' + (w ? 'Vandaag ' + w.title + '.' : 'Vandaag geen gym gepland.') + '</p>' +
    '<button class="btn ghost slim" data-naar="gym">Naar je schema</button></div>';
  return h;
}

/* ================= gym, als onderdeel van je week ================= */

function screenGym() {
  const d = today();
  const k = todayKey();
  const w = workoutForDate(d);
  const gedaan = sessionOn(k);

  let h = backbar('Gym', 'vier keer per week, ingepast in je dagen');
  h += '<div class="phaseline">' + phaseLine() + '</div>';

  if (state.active) {
    h += card('accent', 'Bezig', state.active.title, 'je was hier gebleven',
      '<button class="btn accent" data-resume="1">Verder gaan</button>' +
      '<button class="btn ghost dim slim" data-cancel="1">Weggooien</button>');
  } else if (gedaan) {
    h += card('accent', 'Klaar', gedaan.title, sessionSummaryLine(gedaan),
      '<button class="btn ghost" data-open-session="' + gedaan.id + '">Bekijken</button>');
  } else if (w) {
    const sets = w.type === 'gym' ? w.exercises.reduce((n, e) => n + e.sets, 0) : 0;
    h += card('accent', 'Vandaag', w.title,
      w.type === 'gym' ? w.exercises.length + ' oefeningen, ' + sets + ' sets' : cardioKm(w) + ' km ' + w.sport,
      '<button class="btn accent" data-start="' + w.id + '">Beginnen</button>' +
      '<button class="btn ghost dim slim" data-choose="' + k + '">Andere training</button>');
  } else {
    const nd = nextTrainingDate(d);
    h += card('', 'Rustdag', 'Geen gym vandaag',
      'Volgende is ' + workoutForDate(nd).title + ' op ' + DAY_NAMES[nd.getDay()] + '.',
      '<button class="btn" data-tab-mob="1">Mobiliteit doen</button>');
  }

  h += '<div class="section"><h2>Deze week</h2></div><div class="card tight"><ul class="rows">';
  const mon = mondayOf(d);
  for (let i = 0; i < 7; i++) {
    const dag = addDays(mon, i);
    const wo = workoutForDate(dag);
    if (!wo) continue;
    const s = sessionOn(dateKey(dag));
    const status = s ? 'gedaan' : (daysBetween(dag, d) > 0 ? 'gemist' : (dateKey(dag) === k ? 'vandaag' : 'staat klaar'));
    h += '<li><span class="idx' + (s ? ' done' : '') + '">' + DAY_SHORT[dag.getDay()] + '</span>' +
      '<span class="main"><span class="name">' + esc(wo.title) + '</span></span>' +
      '<span class="right">' + status + '</span></li>';
  }
  h += '</ul></div>';

  if (currentPhase() === 'triathlon') {
    const wk = weekKey(today());
    const aan = !!state.swim[wk];
    h += '<div class="card tight"><ul class="rows"><li data-swim="' + wk + '">' +
      '<span class="idx' + (aan ? ' done' : '') + '">Z</span>' +
      '<span class="main"><span class="name">Zwemmen deze week</span><br><span class="meta">' + esc(SWIM_TASK.detail) + '</span></span>' +
      '<span class="right">' + (aan ? 'gedaan' : 'afvinken') + '</span></li></ul></div>';
  }

  h += '<button class="btn" data-naar="voortgang">Voortgang en records</button>';
  h += '<button class="btn ghost" data-tab-mob="1">Mobiliteit</button>';
  return h;
}

/* ================= formulieren ================= */

let formDagen = [];

function formAfspraak(datum, id) {
  const e = id ? state.events.find(x => x.id === id) : null;
  formDagen = [];
  showModal('<h2>' + (e ? 'Afspraak wijzigen' : 'Nieuwe afspraak') + '</h2>' +
    '<div class="veld"><label for="a-titel">Wat</label><input id="a-titel" type="text" placeholder="tandarts, feestje bij Sem" value="' + esc(e ? e.title : '') + '"></div>' +
    '<div class="veld"><label for="a-kind">Soort</label><select id="a-kind">' +
    EVENT_KINDS.map(x => '<option value="' + x.id + '"' + (e && e.kind === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select></div>' +
    '<div class="veld"><label for="a-datum">Wanneer</label><input id="a-datum" type="date" value="' + esc(e ? e.date : datum) + '"></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="a-van">Van</label><input id="a-van" type="time" value="' + esc(e ? e.start : '') + '"></div>' +
    '<div class="veld"><label for="a-tot">Tot</label><input id="a-tot" type="time" value="' + esc(e ? e.end : '') + '"></div></div>' +
    '<div class="veld"><label for="a-note">Notitie</label><input id="a-note" type="text" placeholder="mag leeg" value="' + esc(e ? (e.note || '') : '') + '"></div>' +
    '<button class="btn accent" data-opslaanafspraak="' + (e ? e.id : '') + '">Opslaan</button>' +
    (e ? '<button class="btn ghost danger slim" data-verwijderafspraak="' + e.id + '">Weghalen</button>' : '') +
    '<button class="btn ghost slim" data-close="1">Annuleren</button>');
}

function opslaanAfspraak(id) {
  const titel = el('a-titel').value.trim();
  const datum = el('a-datum').value;
  if (!titel || !datum) return alert('Vul in wat het is en wanneer.');
  const van = el('a-van').value || '12:00';
  const tot = el('a-tot').value || toTijd(toMin(van) + 60);
  const nieuw = {
    id: id || 'e' + Date.now(), title: titel, kind: el('a-kind').value,
    date: datum, start: van, end: tot, note: el('a-note').value.trim()
  };
  state.events = state.events.filter(x => x.id !== nieuw.id).concat([nieuw]);
  save();
  closeModal();
  render();
  vertelOverBotsing(nieuw);
}

/* Meteen zeggen wat deze afspraak in de war schopt. */
function vertelOverBotsing(e) {
  const d = parseKey(e.date);
  const ev = { van: toMin(e.start), tot: toMin(e.end) };
  const botst = routinesOn(d).filter(r => ev.van < toMin(r.end) && ev.tot > toMin(r.start));
  const gym = workoutForDate(d) && !sessionOn(e.date) && gapsOn(d, 75).length === 0;
  if (!botst.length && !gym) return toast('Staat erin');
  let tekst = '';
  if (botst.length) tekst += 'Dit loopt door ' + botst.map(r => r.title.toLowerCase()).join(' en ') + ' heen. ';
  if (gym) tekst += 'Je gym past er die dag niet meer bij, schuif hem een dag op.';
  showModal('<h2>Even opletten</h2><p class="dim">' + esc(tekst) + '</p><button class="btn accent" data-close="1">Duidelijk</button>');
}

function formRoutine(id) {
  const r = id ? state.routines.find(x => x.id === id) : null;
  formDagen = r ? r.days.slice() : [];
  showModal('<h2>' + (r ? 'Vast blok wijzigen' : 'Vast blok erbij') + '</h2>' +
    '<div class="veld"><label for="r-titel">Wat</label><input id="r-titel" type="text" placeholder="bijbaan, muziekles" value="' + esc(r ? r.title : '') + '"></div>' +
    '<div class="veld"><label for="r-kind">Soort</label><select id="r-kind">' +
    EVENT_KINDS.map(x => '<option value="' + x.id + '"' + (r && r.kind === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select></div>' +
    '<div class="veld"><label>Welke dagen</label><div class="dagkiezer">' +
    [1, 2, 3, 4, 5, 6, 0].map(n => '<button class="' + (formDagen.indexOf(n) !== -1 ? 'on' : '') + '" data-dagtoggle="' + n + '">' + DAY_SHORT[n] + '</button>').join('') +
    '</div></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="r-van">Van</label><input id="r-van" type="time" value="' + esc(r ? r.start : '') + '"></div>' +
    '<div class="veld"><label for="r-tot">Tot</label><input id="r-tot" type="time" value="' + esc(r ? r.end : '') + '"></div></div>' +
    '<button class="btn accent" data-opslaanroutine="' + (r ? r.id : '') + '">Opslaan</button>' +
    (r ? '<button class="btn ghost danger slim" data-verwijderroutine="' + r.id + '">Weghalen</button>' : '') +
    '<button class="btn ghost slim" data-close="1">Annuleren</button>');
}

function opslaanRoutine(id) {
  const titel = el('r-titel').value.trim();
  const van = el('r-van').value, tot = el('r-tot').value;
  if (!titel || !formDagen.length || !van || !tot) return alert('Vul een naam, dagen en tijden in.');
  const kind = el('r-kind').value;
  const nieuw = {
    id: id || 'r' + Date.now(), title: titel, kind: kind, days: formDagen.slice(),
    start: van, end: tot, energie: kind === 'sport' ? -2 : -1
  };
  state.routines = state.routines.filter(x => x.id !== nieuw.id).concat([nieuw]);
  save();
  closeModal();
  render();
  toast('Vaste week bijgewerkt');
}

function formDoel(id) {
  const g = id ? goalById(id) : null;
  const soorten = ['maken', 'leren', 'school', 'sport', 'anders'];
  showModal('<h2>' + (g ? 'Doel wijzigen' : 'Nieuw doel') + '</h2>' +
    '<div class="veld"><label for="d-titel">Wat wil je doen</label><input id="d-titel" type="text" placeholder="leren koken, profielwerkstuk" value="' + esc(g ? g.title : '') + '"></div>' +
    '<div class="veld"><label for="d-kind">Soort</label><select id="d-kind">' +
    soorten.map(s => '<option value="' + s + '"' + (g && g.kind === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="d-week">Keer per week</label><input id="d-week" type="number" inputmode="numeric" value="' + (g ? g.perWeek : 2) + '"></div>' +
    '<div class="veld"><label for="d-min">Minuten per keer</label><input id="d-min" type="number" inputmode="numeric" value="' + (g ? g.minutes : 30) + '"></div></div>' +
    '<div class="veld"><label for="d-prio">Hoe belangrijk</label><select id="d-prio">' +
    PRIO.map(p => '<option value="' + p.id + '"' + (g && g.prio === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></div>' +
    '<div class="veld"><label for="d-deadline">Deadline, als die er is</label><input id="d-deadline" type="date" value="' + esc(g ? (g.deadline || '') : '') + '"></div>' +
    '<button class="btn accent" data-opslaandoel="' + (g ? g.id : '') + '">Opslaan</button>' +
    (g ? '<button class="btn ghost slim" data-pauzedoel="' + g.id + '">' + (g.actief ? 'Even op pauze' : 'Weer oppakken') + '</button>' +
         '<button class="btn ghost danger slim" data-verwijderdoel="' + g.id + '">Weghalen</button>' : '') +
    '<button class="btn ghost slim" data-close="1">Annuleren</button>');
}

function opslaanDoel(id) {
  const titel = el('d-titel').value.trim();
  if (!titel) return alert('Geef je doel een naam.');
  const oud = id ? goalById(id) : null;
  const nieuw = {
    id: id || 'g' + Date.now(), title: titel, kind: el('d-kind').value,
    perWeek: Math.max(1, Number(el('d-week').value) || 1),
    minutes: Math.max(10, Number(el('d-min').value) || 30),
    deadline: el('d-deadline').value, prio: el('d-prio').value, actief: oud ? oud.actief : true,
    log: oud ? oud.log : []
  };
  state.goals = state.goals.filter(x => x.id !== nieuw.id).concat([nieuw]);
  save();
  closeModal();
  render();
  toast(oud ? 'Bijgewerkt' : 'Staat erin, ik pas hem in je week');
}

function doelDetail(id) {
  const g = goalById(id);
  if (!g) return;
  const log = goalLog(g).slice(-8).reverse();
  const antwoorden = [];
  let h = '<h2>' + esc(g.title) + '</h2>' +
    '<p class="dim small">' + esc(goalReason(g)) + '. ' + (g.perWeek || 1) + ' keer per week, ' + (g.minutes || 30) + ' minuten.</p>';
  if (antwoorden.length) {
    h += '<div class="section"><h2>Wat je erover zei</h2></div><ul class="rows">' +
      antwoorden.map(c => '<li><span class="main"><span class="name">' + esc(c.antwoord) + '</span><br>' +
        '<span class="meta">' + esc(formatDate(c.date)) + '</span></span></li>').join('') + '</ul>';
  }
  if (log.length) {
    h += '<div class="section"><h2>Laatste keren</h2></div><ul class="rows">' +
      log.map(x => '<li><span class="main"><span class="name">' + esc(formatDate(x.date)) + '</span></span>' +
        '<span class="right">' + x.minutes + ' min</span></li>').join('') + '</ul>';
  }
  h += '<button class="btn accent" data-logdoel="' + g.id + '|' + (g.minutes || 30) + '">' + (g.minutes || 30) + ' minuten gedaan</button>';
  h += '<button class="btn ghost slim" data-nieuwdoel="' + g.id + '">Aanpassen</button>';
  h += '<button class="btn ghost slim" data-close="1">Sluiten</button>';
  showModal(h);
}

function logDoel(id, minuten) {
  const g = goalById(id);
  if (!g) return;
  goalLog(g).push({ date: todayKey(), minutes: Number(minuten) || g.minutes || 30 });
  save();
  closeModal();
  render();
  const rest = Math.max(0, (g.perWeek || 1) - doneThisWeek(g).length);
  toast(rest ? 'Genoteerd, nog ' + rest + ' deze week' : 'Genoteerd, deze week is rond');
}

function skipDoel(id) {
  state.flags.skips = state.flags.skips || {};
  const lijst = state.flags.skips[todayKey()] || [];
  if (lijst.indexOf(id) === -1) lijst.push(id);
  state.flags.skips[todayKey()] = lijst;
  save();
  render();
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
  if (!w || !state.active) return screenVandaag();
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
  if (!a) return screenVandaag();
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
  if (!a) return go('vandaag');
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
  go('vandaag');
  const last = state.sessions[state.sessions.length - 1];
  if (!state.mobility.some(m => m.date === last.date)) naTrainingMobiliteit(last);
  else toast('Opgeslagen: ' + last.title + ', ' + sessionSummaryLine(last));
}

/* Meteen na je training even losmaken, met de oefeningen erbij. */
function naTrainingMobiliteit(sessie) {
  const r = MOBILITY[String(sessie.workoutId).indexOf('benen') !== -1 ? 0 : 1];
  showModal('<h2>' + esc(sessie.title) + ' staat erin</h2>' +
    '<p class="dim small">' + esc(sessionSummaryLine(sessie)) + '. Nog even losmaken?</p>' +
    '<div class="card tight mt"><ul class="rows">' +
    r.exercises.map(x => '<li><span class="main"><span class="name">' + esc(x) + '</span></span>' +
      '<span class="right">' + r.seconds + 's per kant</span></li>').join('') + '</ul></div>' +
    '<button class="btn accent" data-mob="' + r.id + '">' + esc(r.title) + ' doen</button>' +
    '<button class="btn ghost slim" data-close="1">Nu even niet</button>');
}

function cancelSession() {
  if (!confirm('Deze training weggooien? Je invoer verdwijnt.')) return;
  state.active = null;
  save();
  stopRest();
  keepAwake(false);
  go('vandaag');
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

function rijtje(titel, waarde, actie) {
  return '<li' + (actie ? ' ' + actie : '') + '><span class="main"><span class="name">' + esc(titel) + '</span></span>' +
    '<span class="right">' + waarde + '</span></li>';
}

function screenProfiel() {
  chartData = {};
  const p = state.profile;
  const gew = laatsteGewicht();
  const versch = gewichtsVerschil();
  const lijst = state.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1);

  let h = topbar('Profiel', 'jij en je instellingen');

  /* wie je bent, meteen aan te passen */
  h += '<div class="card"><div class="cardhead"><h3>Jij</h3></div>' +
    '<div class="veld"><label for="p-naam">Naam</label>' +
    '<input id="p-naam" type="text" placeholder="je voornaam" value="' + esc(p.naam) + '" data-profiel="naam"></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="p-jaar">Geboortejaar</label>' +
    '<input id="p-jaar" type="number" inputmode="numeric" placeholder="2008" value="' + esc(p.geboortejaar) + '" data-profiel="geboortejaar"></div>' +
    '<div class="veld"><label for="p-lengte">Lengte in cm</label>' +
    '<input id="p-lengte" type="number" inputmode="numeric" placeholder="182" value="' + esc(p.lengte) + '" data-profiel="lengte"></div>' +
    '</div><p class="tiny dim mt">Wordt opgeslagen terwijl je typt.</p></div>';

  /* gewicht */
  h += '<div class="card"><div class="cardhead"><h3>Gewicht</h3>' +
    (gew ? '<span class="small dim">' + esc(formatDate(gew.date)) + '</span>' : '') + '</div>';
  if (gew) {
    h += '<div class="bigrow"><div><div class="big">' + fmtKg(gew.kg) + '<span class="unitbig">kg</span></div>' +
      '<div class="dim small">' + (versch
        ? (versch.verschil >= 0 ? '+' : '') + fmtKg(versch.verschil) + ' kg sinds ' + formatDate(versch.sinds)
        : 'eerste meting') + '</div></div></div>';
    if (lijst.length > 1) {
      chartData['c-gew'] = { points: lijst.map(x => ({ x: parseKey(x.date).getTime(), y: x.kg, label: formatDate(x.date) })) };
      h += '<canvas data-chart="c-gew"></canvas>';
    }
  } else {
    h += '<p class="dim small">Weeg jezelf een keer per week, op hetzelfde moment.</p>';
  }
  h += '<div class="invoerrij"><input type="number" inputmode="decimal" step="0.1" placeholder="kg vandaag" id="w-kg">' +
    '<button class="btn accent" data-addweight="1">' + ICON.plus + '</button></div></div>';

  /* instellingen */
  const s = state.settings;
  h += '<div class="card"><div class="cardhead"><h3>Instellingen</h3></div>' +
    '<div class="veld"><label for="r1">Rust bij de eerste twee oefeningen</label>' + restSelect('r1', 'rest1', s.rest1) + '</div>' +
    '<div class="veld"><label for="r2">Rust bij de rest</label>' + restSelect('r2', 'rest2', s.rest2) + '</div>' +
    '<div class="check' + (s.sound ? ' on' : '') + '" data-sound="1" style="margin-top:14px">' +
    '<span class="box">' + ICON.check + '</span><span class="main"><span class="name">Piepje als de rust voorbij is</span></span></div></div>';

  /* gegevens */
  h += '<div class="card"><div class="cardhead"><h3>Je gegevens</h3></div>' +
    '<p class="dim small">Alles staat op dit apparaat. Maak af en toe een back-up.</p>' +
    '<button class="btn slim" data-backup="1">Back-up kopieren</button>' +
    '<button class="btn slim" data-import="1">Back-up terugzetten</button>' +
    '<button class="btn ghost danger slim" data-wipe="1">Alles wissen</button></div>';

  h += '<div class="card tight"><ul class="rows">' +
    '<li data-uitleg="1"><span class="main"><span class="name">Hoe ik je dag plan</span></span><span class="right">lezen</span></li>' +
    '<li data-naar="gym"><span class="main"><span class="name">Gym en schema</span></span><span class="right">open</span></li>' +
    '</ul></div>';

  h += '<p class="tiny dim" style="text-align:center;margin:18px 0">versie ' + VERSIE + '</p>';
  return h;
}

/* Kort en eerlijk uitleggen wat de app doet met je dag. */
function toonUitleg() {
  showModal('<h2>Hoe ik je dag plan</h2>' +
    '<div class="info-line"><b>Eerst je vaste dingen</b>School, hockey en wat je zelf in je vaste week zet, plus je afspraken. Daar komt niks overheen.</div>' +
    '<div class="info-line"><b>Dan de gaten</b>Alles tussen 07:00 en 22:30 dat overblijft. Het gat voor school sla ik over, daar ga je toch niks doen.</div>' +
    '<div class="info-line"><b>Gym gaat voor</b>Staat er gym in je schema, dan krijgt die het laatste grote gat van je dag. Niet vlak na hockey.</div>' +
    '<div class="info-line"><b>Daarna je doelen</b>Op volgorde van hoeveel je nog te gaan hebt deze week, hoe lang iets stilligt, hoe dichtbij je deadline is en welke prioriteit je gaf. Hoog telt zwaarder, laag lichter.</div>' +
    '<div class="info-line"><b>En je energie</b>Op een dag met hockey of een wedstrijd zet ik er hoogstens twee dingen bij in plaats van drie, en nooit iets zwaars in het uur na het sporten.</div>' +
    '<div class="info-line"><b>Na de gym</b>Dan komt er mobiliteit bij, met de oefeningen die bij je training passen.</div>' +
    '<button class="btn accent" data-close="1">Duidelijk</button>');
}

function formProfiel() {
  const p = state.profile;
  showModal('<h2>Over jou</h2>' +
    '<div class="veld"><label for="p-naam">Naam</label><input id="p-naam" type="text" value="' + esc(p.naam) + '" data-profiel="naam"></div>' +
    '<div class="tweekolom">' +
    '<div class="veld"><label for="p-jaar">Geboortejaar</label><input id="p-jaar" type="number" inputmode="numeric" placeholder="2008" value="' + esc(p.geboortejaar) + '" data-profiel="geboortejaar"></div>' +
    '<div class="veld"><label for="p-lengte">Lengte in cm</label><input id="p-lengte" type="number" inputmode="numeric" placeholder="182" value="' + esc(p.lengte) + '" data-profiel="lengte"></div></div>' +
    '<button class="btn accent" data-close="1">Klaar</button>');
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
  go('vandaag');
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
    vandaag: screenVandaag, agenda: screenAgenda, doelen: screenDoelen, profiel: screenProfiel,
    gym: screenGym, voortgang: screenVoortgang, mobiliteit: screenMobiliteit,
    warmup: screenWarmup, training: screenTraining, mobrun: screenMobrun, afronden: screenAfronden
  };
  app.innerHTML = (screens[view.name] || screenVandaag)();
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
  if ((n = hit('naar'))) { closeModal(); return go(n.dataset.naar); }

  /* agenda */
  if ((n = hit('nieuwafspraak'))) return formAfspraak(n.dataset.nieuwafspraak, '');
  if ((n = hit('afspraak'))) return formAfspraak('', n.dataset.afspraak);
  if ((n = hit('opslaanafspraak'))) return opslaanAfspraak(n.dataset.opslaanafspraak);
  if ((n = hit('verwijderafspraak'))) {
    state.events = state.events.filter(x => x.id !== n.dataset.verwijderafspraak);
    save(); closeModal(); return render();
  }
  if ((n = hit('nieuweroutine'))) return formRoutine('');
  if ((n = hit('routine'))) return formRoutine(n.dataset.routine);
  if ((n = hit('opslaanroutine'))) return opslaanRoutine(n.dataset.opslaanroutine);
  if ((n = hit('verwijderroutine'))) {
    state.routines = state.routines.filter(x => x.id !== n.dataset.verwijderroutine);
    save(); closeModal(); return render();
  }
  if ((n = hit('dagtoggle'))) {
    const dag = Number(n.dataset.dagtoggle);
    const at = formDagen.indexOf(dag);
    if (at === -1) formDagen.push(dag); else formDagen.splice(at, 1);
    n.classList.toggle('on');
    return;
  }

  /* doelen */
  if ((n = hit('nieuwdoel'))) return formDoel(n.dataset.nieuwdoel || '');
  if ((n = hit('doeldetail'))) return doelDetail(n.dataset.doeldetail);
  if ((n = hit('opslaandoel'))) return opslaanDoel(n.dataset.opslaandoel);
  if ((n = hit('pauzedoel'))) {
    const g = goalById(n.dataset.pauzedoel);
    if (g) g.actief = !g.actief;
    save(); closeModal(); return render();
  }
  if ((n = hit('verwijderdoel'))) {
    if (!confirm('Dit doel weghalen?')) return;
    state.goals = state.goals.filter(x => x.id !== n.dataset.verwijderdoel);
    save(); closeModal(); return render();
  }
  if ((n = hit('logdoel'))) {
    const p = n.dataset.logdoel.split('|');
    return logDoel(p[0], p[1]);
  }
  if ((n = hit('skipdoel'))) return skipDoel(n.dataset.skipdoel);

  /* iets vertellen en tijd hebben */
  if ((n = hit('zeg'))) return zegIets();
  if ((n = hit('bewerkprofiel'))) return formProfiel();
  if ((n = hit('uitleg'))) return toonUitleg();
  if ((n = hit('vraagtijd'))) return vraagTijd();
  if ((n = hit('nutijd'))) return nuTijd(Number(n.dataset.nutijd));
  if ((n = hit('zetprio'))) {
    const p = n.dataset.zetprio.split('|');
    const g = goalById(p[0]);
    if (g) { g.prio = p[1]; save(); }
    closeModal();
    render();
    return toast('Genoteerd');
  }
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
    if (view.name === 'mobiliteit' || view.name === 'voortgang') return go('gym');
    if (view.name === 'training' || view.name === 'warmup') return go('gym');
    return go('vandaag');
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
  if ((n = hit('day'))) { closeModal(); return go('agenda', { sel: n.dataset.day, month: n.dataset.day.slice(0, 7) }); }

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
    return go('vandaag');
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

/* Het standaard werkblok stond er ten onrechte in. Eenmalig weghalen. */
if (!state.flags.werkWeg) {
  const werk = state.routines.find(r => r.id === 'werk');
  if (werk && werk.title === 'Werk' && werk.start === '09:00' && werk.end === '17:00') {
    state.routines = state.routines.filter(r => r.id !== 'werk');
  }
  state.flags.werkWeg = true;
  save();
}
save();
render();
