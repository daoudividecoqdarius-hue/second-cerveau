/* Cerveau de l'app : rappels adaptatifs, mémoire longue durée, compréhension du français.
   Fonctions pures (sans écran) : on peut les tester et les réutiliser plus tard côté serveur. */
(function (root) {
  'use strict';
  const H = 3600e3, D = 24 * H;
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const norm = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- Fuseau horaire ----------
     Sur le téléphone, on utilise l'heure locale. Sur le serveur (qui tourne en UTC), on appelle setTZ('Europe/Paris'). */
  let TZ = null;
  const setTZ = z => { TZ = z; };
  function tzParts(ts) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p = {}; for (const x of f.formatToParts(ts)) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
  }
  function zonedToMs(y, m, d, hh, mm) {
    if (!TZ) return new Date(y, m - 1, d, hh, mm).getTime();
    const want = Date.UTC(y, m - 1, d, hh, mm); let g = want;
    for (let i = 0; i < 3; i++) { const p = tzParts(g); g += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); }
    return g;
  }

  /* ---------- Échéance ---------- */
  function dueAt(it) {
    if (!it.date) return null;
    const [y, m, d] = it.date.split('-').map(Number);
    const [hh, mm] = (it.time || '18:00').split(':').map(Number);
    return zonedToMs(y, m, d, hh, mm);
  }

  // Pas de rappel la nuit : on décale à 8h.
  function quiet(ts) {
    if (TZ) {
      const p = tzParts(ts);
      if (p.h >= 22) return zonedToMs(p.y, p.m, p.d + 1, 8, 0);
      if (p.h < 8) return zonedToMs(p.y, p.m, p.d, 8, 0);
      return ts;
    }
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

  /* ---------- Lecture de documents (billets, factures, convocations) ---------- */
  const MONTH_RE = MONTHS_ALT.join('|');
  const isoOk = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  function findDates(text, now) {
    const out = []; let m;
    const re1 = /(?<!\d)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/g;
    while ((m = re1.exec(text))) {
      let y = +m[3]; if (y < 100) y += 2000;
      if (isoOk(y, +m[2], +m[1])) out.push({ iso: `${y}-${pad(+m[2])}-${pad(+m[1])}`, idx: m.index });
    }
    const re2 = new RegExp(`(?<!\\d)(\\d{1,2})(?:er)?\\s+(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?`, 'gi');
    while ((m = re2.exec(text))) {
      const mon = MONTHS.indexOf(norm(m[2])) + 1; let y = m[3] ? +m[3] : now.getFullYear();
      if (!m[3] && new Date(y, mon - 1, +m[1]) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
      if (isoOk(y, mon, +m[1])) out.push({ iso: `${y}-${pad(mon)}-${pad(+m[1])}`, idx: m.index });
    }
    return out.sort((a, b) => a.idx - b.idx);
  }
  function extractDoc(raw, now = new Date()) {
    const text = String(raw).replace(/[ \t ]+/g, ' ');
    const low = norm(text), todayIso = dstr(now);
    let kind = 'doc';
    if (/\b(sncf|tgv|ouigo|inoui|intercites|billet|voiture\s*\d|train)\b/.test(low)) kind = 'train';
    else if (/\b(facture|echeance|montant|ttc|a payer|avis d'?imposition)\b/.test(low)) kind = 'facture';
    else if (/\b(convocation|rendez-vous|rdv|examen|partiel|entretien|inscription)\b/.test(low)) kind = 'rdv';
    const dates = findDates(text, now), future = dates.filter(d => d.iso >= todayIso);
    const tm = (from = 0) => { const r = /(?<![\d:])([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)(?!\d)/g; r.lastIndex = from; const x = r.exec(text); return x ? `${pad(+x[1])}:${x[2]}` : ''; };
    const amts = []; const ra = /(\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\d+)\s*(?:€|eur)/gi; let a;
    while ((a = ra.exec(text))) amts.push({ v: parseFloat(a[1].replace(/[ .](?=\d{3})/g, '').replace(',', '.')), idx: a.index });
    let amount = null;
    const tk = low.search(/(net a payer|total ttc|total|montant)/);
    if (amts.length) amount = (tk >= 0 && amts.find(x => x.idx >= tk) || amts.reduce((p, c) => c.v > p.v ? c : p)).v;
    const firstLine = (text.split('\n').map(s => s.trim()).find(s => s.length > 3) || '').slice(0, 60);
    let date = null, time = '', title = firstLine || 'Document', imp = 2;
    if (kind === 'train') {
      date = (future[0] || dates[0] || {}).iso || null;
      const dp = low.search(/depart/); time = tm(dp >= 0 ? dp : 0);
      const r = text.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{2,25}?)\s*(?:→|->|>|›|vers)\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{2,25})/);
      title = r ? `Train ${r[1].trim()} → ${r[2].trim()}` : 'Billet de train';
    } else if (kind === 'facture') {
      const kw = low.search(/(echeance|avant le|date limite|payable|a regler|a payer avant)/);
      const d = kw >= 0 ? future.find(x => x.idx >= kw && x.idx - kw < 80) : null;
      date = (d || future[0] || {}).iso || null; imp = 3;
      title = 'Payer la facture' + (amount != null ? ` (${amount.toFixed(2).replace('.', ',')} €)` : '') + (firstLine ? ` – ${firstLine.slice(0, 30)}` : '');
    } else if (kind === 'rdv') {
      date = (future[0] || dates[0] || {}).iso || null; time = tm(); title = firstLine || 'Rendez-vous';
    } else { date = (future[0] || {}).iso || null; time = tm(); }
    return { kind, title, date, time, amount, imp, dates: future.map(d => d.iso).slice(0, 5), notes: amount != null ? `Montant : ${amount.toFixed(2).replace('.', ',')} €` : '' };
  }

  /* ---------- Priorités automatiques ----------
     imp : 3 = haute, 2 = normale, 1 = basse. sure=false : je ne sais pas, il faut demander à l'utilisateur. */
  const HIGH_RE = /\b(examen|partiel|rendu|rendre|deadline|date limite|soutenance|dossier|facture|impot|impots|inscription|convocation|entretien|oral|devoir|contrat|visa|passeport|medecin|dentiste|rdv|rendez-vous|stage|candidature|loyer|assurance|attestation|remboursement|echeance|paiement|payer)\b/;
  const LOW_RE = /\b(ferie|feriee|veterans?|memorial|thanksgiving|columbus|labor day|independence day|halloween|saint-\w+|vacances|fete des|armistice|pentecote|ascension|assomption|toussaint|noel|jour de l'an|lundi de|black friday|st patrick|saint patrick|mardi gras|carnaval)\b/;
  const prioKey = t => norm(String(t)).replace(/\d+/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function autoPrio(title) {
    const t = norm(String(title)), h = t.match(HIGH_RE), l = t.match(LOW_RE);
    if (h && !l) return { imp: 3, sure: true, why: h[1] };
    if (l && !h) return { imp: 1, sure: true, why: l[1] };
    return { imp: 2, sure: false, why: '' };
  }

  const api = { autoPrio, prioKey, setTZ, tzParts, zonedToMs, extractDoc, findDates, dueAt, quiet, reminderPlan, shouldAlert, nextReminderAt, adjustRf, nextReview, reviewDue, parse, score, words, dstr, hm, pad, norm, REVIEW_DAYS, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
