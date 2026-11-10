/* Cerveau de l'app : rappels adaptatifs, mémoire longue durée, compréhension du français.
   Fonctions pures (sans écran) : on peut les tester et les réutiliser plus tard côté serveur. */
(function (root) {
  'use strict';
  const H = 3600e3, D = 24 * H;
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const norm = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- Échéance ---------- */
  function dueAt(it) {
    if (!it.date) return null;
    const [y, m, d] = it.date.split('-').map(Number);
    const [hh, mm] = (it.time || '18:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm).getTime();
  }

  // Pas de rappel la nuit : on décale à 8h.
  function quiet(ts) {
    const d = new Date(ts), h = d.getHours();
    if (h >= 22) { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
    else if (h < 8) d.setHours(8, 0, 0, 0);
    return d.getTime();
  }

  /* ---------- Rappels adaptatifs ----------
     rf = « facteur de réactivité » (0.5 à 2.2), appris au fil du temps.
     Plus rf est grand, plus les rappels commencent tôt et sont rapprochés. */
  const BASE = [72, 24, 6, 2, 0.5]; // heures avant l'échéance

  function reminderPlan(it, rf = 1) {
    const due = dueAt(it);
    if (due == null) return [];
    const imp = it.imp || 2;
    const sc = Math.max(0.4, rf * (imp === 3 ? 1.6 : imp === 1 ? 0.6 : 1));
    const pts = BASE.map(h => due - h * sc * H);
    pts.push(due);
    const gap = Math.min(24, Math.max(2, 8 / sc)) * H;   // relances si en retard
    for (let k = 1; k <= 10; k++) pts.push(due + k * gap);
    const sorted = pts.map(quiet).sort((a, b) => a - b);
    const out = [];
    for (const t of sorted) if (!out.length || t - out[out.length - 1] >= 45 * 60e3) out.push(t);
    return out;
  }

  function shouldAlert(it, rf, now) {
    if (it.done) return false;
    if (it.snoozeUntil) return now >= it.snoozeUntil;
    const last = it.lastNotified || it.created || 0;
    return reminderPlan(it, rf).some(t => t > last && t <= now);
  }

  function nextReminderAt(it, rf, now) {
    if (it.done) return null;
    if (it.snoozeUntil && it.snoozeUntil > now) return it.snoozeUntil;
    const last = Math.max(it.lastNotified || it.created || 0, now);
    return reminderPlan(it, rf).find(t => t > last) || null;
  }

  function adjustRf(rf, ev) {
    const f = { done_fast: 0.92, snooze: 1.15, ignored: 1.1, done_late: 1.05 }[ev] || 1;
    return Math.min(2.2, Math.max(0.5, +(rf * f).toFixed(3)));
  }

  /* ---------- Mémoire longue durée : « à revoir » espacé ---------- */
  const REVIEW_DAYS = [1, 3, 7, 14, 30, 60, 90, 180];
  function nextReview(stage, now) {
    const d = new Date(now + REVIEW_DAYS[Math.min(stage, REVIEW_DAYS.length - 1)] * D);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  const reviewDue = (it, now) => !it.done && !it.date && !!it.nextReview && it.nextReview <= now;

  /* ---------- Compréhension du français ---------- */
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const MONTHS_ALT = MONTHS.concat(['février', 'août', 'décembre']);
  const L = 'a-zàâäçéèêëîïôöûùüÿœ';
  const W = w => new RegExp(`(?<![${L}])(?:${w})(?![${L}])`, 'i');
  const PART = { matin: '09:00', soir: '19:00', 'après-midi': '15:00', 'apres-midi': '15:00' };
  const NUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };

  function parse(input, now = new Date()) {
    let s = ' ' + String(input).replace(/\s+/g, ' ').trim() + ' ';
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const plus = n => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
    let date = null, time = null, part = null, imp = 2, m;
    const take = re => { const x = s.match(re); if (x) s = s.replace(re, ' '); return x; };

    if ((m = take(W('dans\\s+(\\d+|un|une|deux|trois|quatre|cinq)\\s+(minutes?|min|heures?|h|jours?|semaines?|mois)')))) {
      const n = NUM[m[1].toLowerCase()] || parseInt(m[1], 10), u = m[2].toLowerCase();
      if (/^(min|h)/.test(u)) {
        const t = new Date(now.getTime() + n * (u.startsWith('min') ? 60e3 : H));
        date = dstr(t); time = hm(t);
      } else if (u.startsWith('j')) date = dstr(plus(n));
      else if (u.startsWith('s')) date = dstr(plus(7 * n));
      else { const d = new Date(base); d.setMonth(d.getMonth() + n); date = dstr(d); }
    }
    if ((m = take(W('(?:ce|cet)\\s+(soir|matin|apr[eè]s-midi)')))) { date = date || dstr(base); part = norm(m[1]); }
    if (take(W('apr[eè]s-demain|apres demain'))) date = dstr(plus(2));
    else if (take(W('demain'))) date = dstr(plus(1));
    else if (take(W("aujourd['’]hui"))) date = date || dstr(base);

    if (!date && (m = take(W('(?:(?:le|ce)\\s+)?(' + DAYS.join('|') + ')(?:\\s+prochain)?')))) {
      let diff = (DAYS.indexOf(m[1].toLowerCase()) - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      date = dstr(plus(diff));
    }
    if (!date && (m = take(W('(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(' + MONTHS_ALT.join('|') + ')')))) {
      let y = now.getFullYear();
      const mon = MONTHS.indexOf(norm(m[2])), day = +m[1];
      if (new Date(y, mon, day) < base) y++;
      date = dstr(new Date(y, mon, day));
    }
    if (!date && (m = take(/(?:le\s+)?(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/))) {
      let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      if (!m[3] && new Date(y, +m[2] - 1, +m[1]) < base) y++;
      date = dstr(new Date(y, +m[2] - 1, +m[1]));
    }

    if (!part && (m = take(W('matin|soir|apr[eè]s-midi')))) part = norm(m[0]);
    if ((m = take(/(?:(?<=\s)(?:à|a)\s*)?(?<![\d:])(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?!\d)/i))) {
      if (+m[1] < 24) time = `${pad(+m[1])}:${pad(+(m[2] || 0))}`;
    } else if (take(W('midi'))) time = '12:00';
    else if (take(W('minuit'))) time = '23:59';

    if (take(W('urgent(?:e)?|important(?:e)?|prioritaire'))) imp = 3;

    if (!time && part) time = PART[part];
    if (time && !date) {
      const [h, mi] = time.split(':').map(Number);
      const t = new Date(base); t.setHours(h, mi);
      date = dstr(t > now ? base : plus(1));
    }
    if (!date && part) date = dstr(base);

    s = s.replace(/\s+/g, ' ').trim()
      .replace(/^(?:s['’]il te pla[iî]t\s+)?(?:rappelle[- ]moi|rappelez[- ]moi|n['’]oublie pas|pense|penser)\s*(?:de\s+|d['’]|que\s+|à\s+)?/i, '')
      .replace(/^(?:note|ajoute|ajouter|retiens|mémo|memo)\s*(?:que\s+|de\s+|d['’]|:)?\s*/i, '')
      .replace(/^(?:pour|avant|le|la|à|de|d['’])\s+/i, '')
      .replace(/\s+(?:pour|avant|d['’]ici|à|le|de|vers|dès)$/i, '')
      .replace(/^[\s,.;:-]+|[\s,.;:!-]+$/g, '');
    const title = s ? s[0].toUpperCase() + s.slice(1) : '';
    return { title, date, time, imp };
  }

  /* ---------- Recherche floue dans la mémoire ---------- */
  const words = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length > 2);
  function score(q, it) {
    const a = new Set(words(q)), b = words(it.title + ' ' + (it.notes || ''));
    let n = 0; for (const w of b) if (a.has(w)) n++;
    return n;
  }

  const api = { dueAt, quiet, reminderPlan, shouldAlert, nextReminderAt, adjustRf, nextReview, reviewDue, parse, score, words, dstr, hm, pad, norm, REVIEW_DAYS, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
