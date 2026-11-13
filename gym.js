/* Lecture de l'export de Hevy (fichier CSV) : séances → { id, d (AAAA-MM-JJ), t (titre), m (minutes), e: [{ n, s: [[kg, reps], …] }] }
   Tout se passe sur le téléphone. Le format de l'export peut varier selon la langue de l'app Hevy : on repère les colonnes par leur nom. */
(function (root) {
  const MOIS = { jan: 1, janv: 1, feb: 2, fev: 2, febr: 2, mar: 3, mars: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function parseCsv(text) {                                      // CSV avec guillemets, séparateur « , » ou « ; »
    const first = text.split(/\r?\n/, 1)[0] || '', sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function parseWhen(s) {                                        // « 12 Nov 2026, 17:30 », « 12 nov. 2026 17:30 » ou ISO → { d, ms }
    s = String(s || '').trim(); if (!s) return null;
    const m = /(\d{1,2})\s+([A-Za-zéûôàè]{3,})\.?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})/.exec(s);
    if (m) { const mo = MOIS[norm(m[2]).slice(0, 4)] || MOIS[norm(m[2]).slice(0, 3)]; if (mo) { const ms = Date.UTC(+m[3], mo - 1, +m[1], +m[4], +m[5]); return { d: `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, ms }; } }
    const t = Date.parse(s); if (Number.isFinite(t)) { const x = new Date(t); return { d: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`, ms: t }; }
    return null;
  }
  function parseHevyCsv(text) {
    const rows = parseCsv(String(text || '').replace(/^﻿/, '')); if (rows.length < 2) throw new Error('fichier vide');
    const H = rows[0].map(norm), idx = (...names) => { for (const n of names) { const i = H.findIndex(h => h === n || h.includes(n)); if (i >= 0) return i; } return -1; };
    const iT = idx('title', 'titre'), iS = idx('start_time', 'start time', 'debut'), iE = idx('end_time', 'end time', 'fin'), iX = idx('exercise_title', 'exercise title', 'exercice'), iType = idx('set_type', 'set type', 'type de serie'),
      iKg = idx('weight_kg', 'poids (kg)', 'weight (kg)'), iLb = idx('weight_lbs', 'weight (lbs)'), iR = idx('reps', 'repetitions');
    if (iS < 0 || iX < 0 || (iKg < 0 && iLb < 0) || iR < 0) throw new Error("ce fichier ne ressemble pas à l'export de Hevy (colonnes manquantes)");
    const byW = new Map();
    for (const r of rows.slice(1)) {
      const st = parseWhen(r[iS]); if (!st) continue;
      if (iType >= 0 && /warm|echauff/.test(norm(r[iType]))) continue;
      const key = (iT >= 0 ? r[iT] : '') + '|' + r[iS];
      let w = byW.get(key); if (!w) { const en = iE >= 0 ? parseWhen(r[iE]) : null; w = { id: 'csv' + st.ms.toString(36) + norm(iT >= 0 ? r[iT] : '').slice(0, 6), d: st.d, t: (iT >= 0 ? r[iT] : 'Séance').slice(0, 60), m: en ? Math.max(0, Math.round((en.ms - st.ms) / 60000)) : 0, e: [], _x: new Map() }; byW.set(key, w); }
      const name = (r[iX] || '').slice(0, 50); if (!name) continue;
      let ex = w._x.get(name); if (!ex) { ex = { n: name, s: [] }; w._x.set(name, ex); w.e.push(ex); }
      const kg = iKg >= 0 && r[iKg] !== '' ? parseFloat(String(r[iKg]).replace(',', '.')) : (parseFloat(String(r[iLb]).replace(',', '.')) || 0) * 0.45359237;
      ex.s.push([Math.round((kg || 0) * 100) / 100, parseInt(r[iR], 10) || 0]);
    }
    const out = [...byW.values()].map(w => { delete w._x; return w; }).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 30);
    if (!out.length) throw new Error('aucune séance trouvée dans ce fichier');
    return out;
  }
  root.Gym = { parseCsv, parseHevyCsv, parseWhen };
  if (typeof module !== 'undefined') module.exports = root.Gym;
})(typeof window !== 'undefined' ? window : globalThis);
