/* Second Cerveau : interface, assistant et skills. Tout est local et gratuit. */
(function () {
  'use strict';
  const E = Engine, H = 3600e3, D = 24 * H;
  const $ = s => document.querySelector(s);
  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e[k] = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  /* ================= Données ================= */
  const KEY = 'orga.v2';
  let S = { items: [], events: [], rf: 1, chat: [], lastDigest: '', tts: false, off: [], gclient: '', migrated: false };
  function load() {
    try { const j = JSON.parse(localStorage.getItem(KEY)); if (j) S = { ...S, ...j }; } catch (e) {}
    try {
      if (!S.migrated) {
        const old = JSON.parse(localStorage.getItem('orga.tasks.v1') || '[]');
        old.forEach(t => S.items.push(mk({ title: t.title, date: t.date, time: t.time, cat: t.cat, done: !!t.done })));
        S.migrated = true;
      }
      const c = localStorage.getItem('orga.gclient'); if (c && !S.gclient) S.gclient = c;
    } catch (e) {}
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  function mk(o) {
    const now = Date.now();
    const it = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), title: '', notes: '', cat: 'Autre', imp: 2,
      done: false, created: now, lastNotified: 0, alertOpen: false, snoozeUntil: 0, stage: 0, alerts: 0, ...o };
    it.date = it.date || ''; it.time = it.time || '';
    if (!it.date) it.nextReview = E.nextReview(0, now);
    return it;
  }
  const today = () => E.dstr(new Date());
  const addDays = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  const open = () => S.items.filter(i => !i.done);
  const isLate = i => i.date && E.dueAt(i) < Date.now();

  function rel(ts) {
    const d = ts - Date.now(), a = Math.abs(d), m = Math.round(a / 60e3);
    const s = m < 60 ? `${m} min` : a < 48 * H ? `${Math.round(a / H)} h` : `${Math.round(a / D)} j`;
    return d >= 0 ? `dans ${s}` : `il y a ${s}`;
  }
  const dayLabel = ds => new Date(ds + 'T00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const when = i => i.date ? dayLabel(i.date) + (i.time ? ' · ' + i.time : '') : '';

  /* ================= Actions ================= */
  function complete(it) {
    const now = Date.now();
    it.done = true; it.doneAt = now;
    if (it.alertOpen) S.rf = E.adjustRf(S.rf, now - (it.lastAlertAt || now) < 2 * H ? 'done_fast' : 'done_late');
    it.alertOpen = false; it.snoozeUntil = 0;
    save(); render();
  }
  function reopen(it) { it.done = false; it.doneAt = 0; save(); render(); }
  function snooze(it, ts) {
    it.snoozeUntil = ts; it.alertOpen = false;
    S.rf = E.adjustRf(S.rf, 'snooze');
    save(); render();
  }
  const tonight = () => { const d = new Date(); d.setHours(19, 0, 0, 0); return d.getTime() > Date.now() + 30 * 60e3 ? d.getTime() : Date.now() + 3 * H; };
  const tomorrow9 = () => { const d = addDays(1); d.setHours(9, 0, 0, 0); return d.getTime(); };

  /* ================= Notifications ================= */
  async function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = navigator.serviceWorker && await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 1500))]);
      if (reg) return reg.showNotification(title, { body, tag, icon: 'icon.svg' });
    } catch (e) {}
    try { new Notification(title, { body, tag }); } catch (e) {}
  }
  function tick() {
    const now = Date.now(); let ch = false;
    for (const it of S.items) {
      if (it.done || !E.shouldAlert(it, S.rf, now)) continue;
      if (it.alertOpen) S.rf = E.adjustRf(S.rf, 'ignored');
      it.alertOpen = true; it.lastNotified = now; it.lastAlertAt = now; it.snoozeUntil = 0; it.alerts = (it.alerts || 0) + 1;
      ch = true;
      notify('À ne pas oublier', `${it.title} — ${isLate(it) ? 'en retard' : rel(E.dueAt(it))}`, it.id);
    }
    const h = new Date().getHours();
    if (S.lastDigest !== today() && h >= 8) {
      S.lastDigest = today(); ch = true;
      const txt = skillAgenda();
      say('Bonjour ! ' + txt, true);
      notify('Ta journée', txt.split('\n')[0], 'digest');
    }
    if (ch) { save(); render(); }
  }

  /* ================= Skills (assistant) ================= */
  const lines = arr => arr.map(i => '• ' + i.title + (i.time ? ` (${i.time})` : '')).join('\n');
  const byTime = (a, b) => (E.dueAt(a) || 0) - (E.dueAt(b) || 0);
  const dayItems = ds => [...open().filter(i => i.date === ds), ...S.events.filter(e => e.date === ds)].sort(byTime);
  const bestMatch = q => {
    const c = open().map(i => [E.score(q, i), i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
    return c.length ? c[0][1] : null;
  };
  const Q = /^(?:qu['’]est[- ]ce que|quoi|que |quel|ai-je|y a-t-il|montre|affiche|donne|liste|mon |ma |mes |c['’]est quoi|dis[- ]moi)/i;

  function skillAgenda() {
    const td = dayItems(today());
    const late = open().filter(isLate).length, rev = open().filter(i => E.reviewDue(i, Date.now())).length;
    let r = td.length ? `Aujourd'hui, ${td.length} chose${td.length > 1 ? 's' : ''} :\n${lines(td)}` : "Rien de prévu aujourd'hui. 🎉";
    if (late) r += `\n⚠️ ${late} en retard.`;
    if (rev) r += `\n💭 ${rev} idée${rev > 1 ? 's' : ''} à revoir dans « Mémoire ».`;
    return r;
  }

  const SKILLS = [
    { id: 'aide', icon: '❓', name: 'Aide', desc: 'Liste ce que je sais faire', ex: "Que sais-tu faire ?",
      match: t => /(?:que sais[- ]tu|tes (?:skills|comp[ée]tences|capacit[ée]s)|^aide$|^help$)/i.test(t),
      run: () => 'Voici mes compétences :\n' + SKILLS.filter(s => s.id !== 'ajouter').map(s => `${s.icon} ${s.name} : ${s.desc}\n   ex : « ${s.ex} »`).join('\n') + '\n\nSinon, écris simplement ce que tu veux retenir, je m’en occupe.' },
    { id: 'terminer', icon: '✅', name: 'Terminer', desc: 'Marque une tâche comme faite', ex: "J'ai fini le dossier de stage",
      match: t => /^(?:j['’]ai (?:fini|termin[ée]|fait|envoy[ée]|rendu|pay[ée])|c['’]est (?:fait|fini)|fini|termin[ée])\b/i.test(t),
      run: t => {
        const q = t.replace(/^(?:j['’]ai\s+)?(?:fini|termin[ée]|fait|envoy[ée]|rendu|pay[ée]|c['’]est (?:fait|fini))\s*(?:de\s+|d['’]|le\s+|la\s+|les\s+|l['’])?/i, '');
        const it = bestMatch(q || t);
        if (!it) return "Je n'ai pas trouvé cette tâche. Dis-moi son nom, ou coche-la dans « Aujourd'hui ».";
        complete(it); return `Bravo ! ✅ « ${it.title} » est terminé.`;
      } },
    { id: 'reporter', icon: '⏩', name: 'Reporter', desc: 'Décale une tâche à une autre date', ex: 'Repousse le dossier à lundi',
      match: t => /^(?:reporte|repousse|d[ée]cale|reculer?)\b/i.test(t),
      run: t => {
        const rest = t.replace(/^(?:reporte|repousse|d[ée]cale|reculer?)\s+/i, '');
        const p = E.parse(rest), it = bestMatch(p.title || rest);
        if (!it) return "Je n'ai pas trouvé cette tâche.";
        if (p.date) { it.date = p.date; it.time = p.time || it.time; }
        else { const d = addDays(1); it.date = E.dstr(d); }
        it.lastNotified = Date.now(); it.alertOpen = false; it.snoozeUntil = 0; save(); render();
        return `C'est décalé : « ${it.title} » → ${when(it)}`;
      } },
    { id: 'chercher', icon: '🔎', name: 'Retrouver', desc: 'Cherche dans toute ta mémoire', ex: 'Retrouve ce que j’avais noté sur le portail',
      match: t => /^(?:cherche|retrouve|trouve|qu['’]est[- ]ce que j['’]avais (?:not[ée]|dit)|rappelle[- ]moi ce que)/i.test(t),
      run: t => {
        const q = t.replace(/^(?:cherche|retrouve|trouve)\s*/i, '');
        const r = S.items.map(i => [E.score(q, i), i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 5).map(x => x[1]);
        return r.length ? 'J’ai retrouvé :\n' + r.map(i => `• ${i.title}${i.notes ? ' — ' + i.notes : ''}${i.done ? ' (fait)' : ''}${i.date ? ' · ' + when(i) : ''}`).join('\n') : "Rien trouvé là-dessus dans ta mémoire.";
      } },
    { id: 'compte', icon: '⏳', name: 'Compte à rebours', desc: 'Jours restants avant une échéance', ex: 'Combien de jours avant le 20 décembre ?',
      match: t => /combien (?:de )?(?:jours?|temps)|compte [àa] rebours|il reste combien/i.test(t),
      run: t => {
        const p = E.parse(t); let ds = p.date, name = '';
        if (!ds) { const it = bestMatch(t); if (it && it.date) { ds = it.date; name = ` pour « ${it.title} »`; } }
        if (!ds) return 'Dis-moi une date ou le nom d’une tâche datée.';
        const n = Math.round((new Date(ds + 'T00:00') - addDays(0)) / D);
        return n === 0 ? `C'est aujourd'hui${name} !` : n > 0 ? `Il reste ${n} jour${n > 1 ? 's' : ''}${name} (${dayLabel(ds)}).` : `C'était il y a ${-n} jour${-n > 1 ? 's' : ''}${name}.`;
      } },
    { id: 'focus', icon: '🎯', name: 'Minuteur focus', desc: 'Travaille en concentration, je te préviens', ex: 'Focus 25 minutes',
      match: t => /^(?:focus|minuteur|timer|pomodoro|chrono)\b/i.test(t),
      run: t => {
        const n = Math.min(180, parseInt((t.match(/(\d+)/) || [])[1], 10) || 25);
        setTimeout(() => { say(`⏰ Les ${n} minutes de focus sont finies ! Fais une pause.`, true); notify('Focus terminé', `${n} minutes écoulées`, 'focus'); }, n * 60e3);
        return `🎯 C'est parti pour ${n} minutes. Téléphone en silencieux, une seule tâche. Je te préviens à la fin (garde l'app ouverte).`;
      } },
    { id: 'bilan', icon: '📊', name: 'Bilan', desc: 'Ce que tu as accompli cette semaine', ex: 'Fais-moi le bilan de la semaine',
      match: t => /bilan|ce que j['’]ai fait cette semaine/i.test(t),
      run: () => {
        const since = Date.now() - 7 * D, f = S.items.filter(i => i.done && i.doneAt > since);
        return f.length ? `Cette semaine, tu as terminé ${f.length} chose${f.length > 1 ? 's' : ''} 💪\n${f.slice(0, 8).map(i => '• ' + i.title).join('\n')}` : "Rien de terminé cette semaine pour l'instant. On s'y met ?";
      } },
    { id: 'retard', icon: '⚠️', name: 'En retard', desc: 'Ce que tu as laissé passer', ex: "Qu'est-ce que j'ai oublié ?",
      match: t => Q.test(t) && /retard|oubli/i.test(t),
      run: () => {
        const late = open().filter(isLate).sort(byTime), rev = open().filter(i => E.reviewDue(i, Date.now()));
        let r = late.length ? `⚠️ En retard :\n${late.map(i => `• ${i.title} (${when(i)})`).join('\n')}` : 'Rien en retard 👌';
        if (rev.length) r += `\n\n💭 À revoir :\n${rev.map(i => '• ' + i.title).join('\n')}`;
        return r;
      } },
    { id: 'semaine', icon: '🗓', name: 'Ma semaine', desc: 'Les 7 prochains jours', ex: "Qu'est-ce que j'ai cette semaine ?",
      match: t => Q.test(t) && /semaine|prochains jours|demain/i.test(t),
      run: () => {
        let out = [];
        for (let k = 0; k < 7; k++) { const ds = E.dstr(addDays(k)), l = dayItems(ds); if (l.length) out.push(`${dayLabel(ds)} :\n${lines(l)}`); }
        return out.length ? out.join('\n\n') : 'Semaine tranquille : rien de prévu.';
      } },
    { id: 'maintenant', icon: '🧭', name: 'Par quoi commencer', desc: 'Je choisis la priorité pour toi', ex: 'Par quoi je commence ?',
      match: t => /par quoi (?:je )?commence|que (?:dois|puis)-je faire (?:maintenant|d['’]abord)|je fais quoi|priorit[ée]s?\b/i.test(t),
      run: () => {
        const o = open().filter(i => i.date || i.alertOpen);
        o.sort((a, b) => (b.alertOpen - a.alertOpen) || ((isLate(b) - isLate(a))) || ((b.imp || 2) - (a.imp || 2)) || byTime(a, b));
        const it = o[0];
        if (!it) return "Rien d'urgent. Profites-en pour souffler, ou revois tes idées dans « Mémoire ».";
        return `Commence par : « ${it.title} »${it.date ? ` (${isLate(it) ? 'en retard, prévu ' : ''}${when(it)})` : ''}.\n💡 Astuce : fais juste la toute première petite étape (ouvrir le document, écrire la 1re phrase). Dis « focus 25 » si tu veux un minuteur.`;
      } },
    { id: 'agenda', icon: '📅', name: 'Mon programme', desc: 'Ta journée en un coup d’œil', ex: "Qu'est-ce que j'ai aujourd'hui ?",
      match: t => (Q.test(t) && /aujourd|journ[ée]e|programme|planning/i.test(t)) || /^(?:mon )?(?:programme|planning)\??$/i.test(t),
      run: () => skillAgenda() },
    { id: 'memo', icon: '💭', name: 'Mémo / idée', desc: 'Retient pour longtemps et te le ressort', ex: 'Idée : apprendre le piano',
      match: t => /^(?:id[ée]e|m[ée]mo|retiens|souviens[- ]toi|garde en m[ée]moire)\b/i.test(t),
      run: t => {
        const txt = t.replace(/^(?:id[ée]e|m[ée]mo|retiens|souviens[- ]toi|garde en m[ée]moire)\s*(?:que\s+|de\s+|d['’]|:)?\s*/i, '').trim() || t;
        S.items.unshift(mk({ title: txt[0].toUpperCase() + txt.slice(1), cat: 'Idée' })); save(); render();
        return `💭 Retenu : « ${txt} ». Je te le ressortirai demain, puis dans 3 jours, 1 semaine, 1 mois… tant que tu veux le garder.`;
      } },
    { id: 'ajouter', icon: '➕', name: 'Rappels', desc: 'Écris en français normal, je comprends la date', ex: 'Rappelle-moi de rendre le dossier vendredi à 14h', hidden: true,
      match: () => true,
      run: t => {
        const p = E.parse(t);
        if (!p.title) return "Je n'ai pas compris. Essaie : « Rappelle-moi d'appeler la banque demain à 10h ».";
        const it = mk({ title: p.title, date: p.date, time: p.time, imp: p.imp }); S.items.unshift(it); save(); render();
        if (!it.date) return `C'est noté : « ${it.title} » (sans date). Je te le ressortirai régulièrement dans « Mémoire ».`;
        const nx = E.nextReminderAt(it, S.rf, Date.now());
        return `C'est noté ✅ « ${it.title} » — ${when(it)}${it.imp === 3 ? ' (priorité haute)' : ''}.\n` + (nx ? `Premier rappel ${rel(nx)}, puis de plus en plus proches.` : 'Je te préviendrai au moment voulu.');
      } }
  ];
  const enabled = () => SKILLS.filter(s => !S.off.includes(s.id));

  function say(text, fromSystem) {
    S.chat.push({ r: 'a', t: text, ts: Date.now() }); S.chat = S.chat.slice(-60);
    if (S.tts && !fromSystem && 'speechSynthesis' in window) {
      try { const u = new SpeechSynthesisUtterance(text.replace(/[•📅⚠️💭✅🎯🧭]/gu, '')); u.lang = 'fr-FR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
    }
  }
  function ask(text) {
    text = text.trim(); if (!text) return;
    S.chat.push({ r: 'u', t: text, ts: Date.now() });
    const sk = enabled().find(s => s.match(text)) || SKILLS.find(s => s.id === 'ajouter');
    let r; try { r = sk.run(text); } catch (e) { r = "Oups, j'ai eu un souci : " + e.message; }
    say(r); save(); render();
  }

  /* ================= Google Agenda (lecture seule) ================= */
  let gtoken = null;
  const gmsg = t => { const n = $('#gmsg'); if (n) n.textContent = t; };
  function loadGis() {
    return new Promise((ok, ko) => {
      if (window.google && google.accounts) return ok();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = ok; s.onerror = ko; document.head.appendChild(s);
    });
  }
  async function gapi(url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + gtoken } });
    if (!r.ok) throw new Error('Erreur Google ' + r.status);
    return r.json();
  }
  async function fetchEvents() {
    gmsg('Chargement de ton agenda…');
    try {
      const min = addDays(0), max = addDays(14);
      const cals = (await gapi('https://www.googleapis.com/calendar/v3/users/me/calendarList')).items || [];
      const out = [];
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: min.toISOString(), timeMax: max.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
        const d = await gapi(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
        for (const e of d.items || []) {
          if (e.status === 'cancelled' || !e.start) continue;
          const s = e.start.dateTime ? new Date(e.start.dateTime) : null;
          out.push({ id: 'g' + c.id + e.id, title: e.summary || '(sans titre)', date: s ? E.dstr(s) : e.start.date, time: s ? E.hm(s) : '', cat: 'Agenda', ro: true, cal: c.summaryOverride || c.summary, done: false });
        }
      }
      S.events = out; save(); gmsg(`${out.length} événement(s) sur 14 jours.`); render();
    } catch (e) { gmsg('Échec : ' + e.message); }
  }
  async function connectGoogle() {
    if (!S.gclient) { gmsg("Colle d'abord ton ID client Google ci-dessus."); return; }
    try { await loadGis(); } catch (e) { gmsg('Impossible de joindre Google (internet ?).'); return; }
    google.accounts.oauth2.initTokenClient({
      client_id: S.gclient, scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: r => { if (r.access_token) { gtoken = r.access_token; fetchEvents(); } else gmsg('Connexion refusée.'); },
      error_callback: () => gmsg('Connexion annulée.')
    }).requestAccessToken();
  }

  /* ================= Vues ================= */
  let view = 'home';
  function row(it) {
    const ev = !!it.ro, late = !ev && !it.done && isLate(it);
    const left = ev ? el('span', { class: 'ico', text: '📅' })
      : el('button', { class: 'chk' + (it.done ? ' on' : ''), 'aria-label': 'Terminer', onclick: e => { e.stopPropagation(); it.done ? reopen(it) : complete(it); }, text: it.done ? '✓' : '' });
    const meta = el('div', { class: 'm' },
      el('span', { class: 'tag', text: it.cat }),
      it.date && el('span', { class: late ? 'late' : '', text: when(it) }),
      ev && it.cal && el('span', { text: it.cal }),
      !ev && !it.date && !it.done && it.nextReview && E.reviewDue(it, Date.now()) && el('span', { class: 'late', text: 'à revoir' }));
    return el('div', { class: 'row' + (it.done ? ' done' : ''), onclick: ev ? null : () => openSheet(it) },
      left, el('div', { class: 'b' }, el('div', { class: 'n', text: it.title }), meta), !ev && it.imp === 3 && !it.done && el('span', { class: 'dot', title: 'Haute' }));
  }
  const section = (title, items, cls) => items.length ? [el('h2', { class: cls || '', text: `${title} (${items.length})` }), ...items.map(row)] : [];

  function renderHome(v) {
    const now = Date.now(), td = today(), h = new Date().getHours();
    v.append(el('div', { class: 'top' },
      el('div', {}, el('div', { class: 'date', text: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }),
        el('h1', { text: h < 6 ? 'Bonne nuit 🌙' : h < 18 ? 'Bonjour 👋' : 'Bonsoir 🌆' }))));

    const all = [...open().filter(i => i.date), ...S.events.filter(e => e.date >= td)];
    const upcoming = all.filter(i => E.dueAt(i) >= now - 30 * 60e3 || isLate(i)).sort((a, b) => (isLate(b) - isLate(a)) || byTime(a, b));
    const nxt = upcoming.find(i => !i.ro && isLate(i)) || upcoming.find(i => E.dueAt(i) >= now - 30 * 60e3);
    const todayAll = S.items.filter(i => i.date === td), doneN = todayAll.filter(i => i.done).length, tot = todayAll.length;
    const pct = tot ? doneN / tot : 0, C = 2 * Math.PI * 26;
    const ring = el('div', { class: 'ring' });
    ring.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>`;
    ring.append(el('b', { text: tot ? `${doneN}/${tot}` : '—' }));
    v.append(el('div', { class: 'focus' },
      el('div', { class: 'l' }, el('small', { text: nxt ? (isLate(nxt) ? 'À rattraper' : 'Prochain rendez-vous') : 'Tout est calme' }),
        el('div', { class: 'big', text: nxt ? nxt.title : 'Rien d’urgent 🎉' }),
        el('div', { class: 'when', text: nxt ? `${when(nxt)} · ${rel(E.dueAt(nxt))}` : 'Ajoute ce qui te trotte dans la tête avec le bouton +' })),
      ring));

    for (const it of open().filter(i => i.alertOpen)) {
      v.append(el('div', { class: 'alert' },
        el('div', { class: 't', text: '🔔 ' + it.title }),
        el('div', { class: 'm', text: it.date ? `${when(it)} · ${isLate(it) ? 'en retard' : rel(E.dueAt(it))}` : 'À traiter' }),
        el('div', { class: 'chips' },
          el('button', { class: 'chip p', onclick: () => complete(it), text: '✓ Fait' }),
          el('button', { class: 'chip', onclick: () => snooze(it, now + H), text: '+1 h' }),
          el('button', { class: 'chip', onclick: () => snooze(it, tonight()), text: 'Ce soir' }),
          el('button', { class: 'chip', onclick: () => snooze(it, tomorrow9()), text: 'Demain' }))));
    }

    const dated = open().filter(i => i.date);
    const late = dated.filter(isLate).sort(byTime);
    const day = ds => [...dated.filter(i => i.date === ds && !isLate(i)), ...S.events.filter(e => e.date === ds)].sort(byTime);
    v.append(...section('En retard', late, 'red'));
    v.append(...section("Aujourd'hui", day(td)));
    const wk = []; for (let k = 1; k <= 7; k++) wk.push(...day(E.dstr(addDays(k))));
    v.append(...section('Cette semaine', wk));
    const later = dated.filter(i => i.date > E.dstr(addDays(7)) && !isLate(i)).sort(byTime);
    v.append(...section('Plus tard', later));
    v.append(...section('💭 À revoir', open().filter(i => E.reviewDue(i, now))));
    if (!S.items.length && !S.events.length) v.append(el('div', { class: 'empty', text: "Rien pour l'instant. Appuie sur + ou parle à l'assistant : « Rappelle-moi de… »" }));
  }

  function renderBrain(v) {
    v.append(el('div', { class: 'top' }, el('div', {}, el('div', { class: 'date', text: 'Tout ce que tu m’as confié' }), el('h1', { text: 'Mémoire 🧠' }))));
    const inp = el('input', { type: 'search', placeholder: 'Rechercher dans tout…', value: view_q });
    const out = el('div');
    const draw = () => {
      out.innerHTML = ''; const q = inp.value.trim(); view_q = q;
      const memos = open().filter(i => !i.date);
      const hits = q ? S.items.filter(i => E.score(q, i) > 0 || i.title.toLowerCase().includes(q.toLowerCase())) : null;
      if (hits) out.append(...(hits.length ? hits.map(row) : [el('div', { class: 'empty', text: 'Rien trouvé.' })]));
      else {
        for (const it of memos) {
          const due = E.reviewDue(it, Date.now());
          const box = el('div', {}, row(it));
          if (due) box.append(el('div', { class: 'chips', style: 'margin:-2px 0 10px 4px' },
            el('button', { class: 'chip p', onclick: () => { it.stage = (it.stage || 0) + 1; it.nextReview = E.nextReview(it.stage, Date.now()); save(); render(); }, text: 'Garder en tête' }),
            el('button', { class: 'chip', onclick: () => complete(it), text: 'Plus utile' }),
            el('button', { class: 'chip', onclick: () => openSheet(it), text: 'Donner une date' })));
          out.append(box);
        }
        if (!memos.length) out.append(el('div', { class: 'empty', text: 'Aucune idée en mémoire. Écris « Idée : … » à l’assistant.' }));
        const done = S.items.filter(i => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 15);
        out.append(...section('Terminé récemment', done));
      }
    };
    inp.oninput = draw; v.append(inp, el('p', { class: 'hint', text: 'Les idées sans date reviennent te voir à intervalles espacés (1 j, 3 j, 1 sem, 1 mois…) pour ne rien perdre.' }), out); draw();
  }
  let view_q = '';

  let rec = null;
  function renderChat(v) {
    v.append(el('div', { class: 'top' }, el('div', {}, el('div', { class: 'date', text: 'Gratuit · fonctionne hors ligne' }), el('h1', { text: 'Assistant 💬' }))));
    const chat = el('div', { class: 'chat' });
    if (!S.chat.length) S.chat.push({ r: 'a', t: "Salut ! Je suis ton second cerveau. Écris ou dis-moi ce que tu dois faire (« Rappelle-moi de… »), ou touche une compétence ci-dessous.", ts: Date.now() });
    for (const m of S.chat) chat.append(el('div', { class: 'msg ' + m.r, text: m.t }));
    v.append(chat);
    const sk = el('div', { class: 'skills' });
    for (const s of enabled().filter(x => !x.hidden)) sk.append(el('button', { class: 'chip', onclick: () => { input.value = s.ex; input.focus(); }, text: `${s.icon} ${s.name}` }));
    v.append(sk);
    const input = el('input', { type: 'text', placeholder: 'Écris ou parle…', id: 'chatin' });
    const send = () => { const t = input.value; input.value = ''; ask(t); };
    const mic = el('button', { class: 'mic', type: 'button', 'aria-label': 'Parler', text: '🎤' });
    mic.onclick = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { say("La dictée vocale n'est pas disponible ici. Utilise le micro du clavier iPhone 🎤 (en bas à droite du clavier).", true); render(); return; }
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false;
      rec.onresult = e => { input.value = e.results[0][0].transcript; send(); };
      rec.onend = () => { rec = null; mic.classList.remove('rec'); };
      rec.onerror = () => { rec = null; mic.classList.remove('rec'); say("Le micro n'est pas accessible ici. Utilise le micro du clavier iPhone 🎤 (en bas à droite du clavier).", true); render(); };
      mic.classList.add('rec'); try { rec.start(); } catch (e) {}
    };
    input.onkeydown = e => { if (e.key === 'Enter') send(); };
    v.append(el('div', { class: 'composer' }, mic, input, el('button', { class: 'send', type: 'button', onclick: send, 'aria-label': 'Envoyer', text: '➤' })));
    setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 0);
  }

  function renderSettings(v) {
    v.append(el('div', { class: 'top' }, el('div', {}, el('div', { class: 'date', text: 'Personnalise ton cerveau' }), el('h1', { text: 'Réglages ⚙️' }))));
    const perm = ('Notification' in window) ? Notification.permission : 'indisponible';
    v.append(el('div', { class: 'card' }, el('h3', { text: '🔔 Rappels' }),
      el('p', { text: `État : ${perm === 'granted' ? 'activés' : perm === 'denied' ? 'refusés (à changer dans les réglages iPhone)' : perm === 'default' ? 'pas encore activés' : 'non disponibles ici'}. Les rappels adaptent leur rythme à ta réactivité : réactivité apprise ×${S.rf.toFixed(2)} (${S.rf > 1.15 ? 'rappels plus tôt et plus fréquents' : S.rf < 0.85 ? 'rappels plus discrets' : 'rythme standard'}).` }),
      el('div', { class: 'chips' },
        perm === 'default' && el('button', { class: 'chip p', onclick: async () => { try { await Notification.requestPermission(); } catch (e) {} render(); }, text: 'Activer les notifications' }),
        el('button', { class: 'chip', onclick: () => { S.rf = 1; save(); render(); }, text: 'Réinitialiser le rythme' }))));

    const skc = el('div', { class: 'card' }, el('h3', { text: '🧩 Compétences de l’assistant' }), el('p', { text: 'Active ou désactive ce que l’assistant sait faire. Tout est gratuit et local.' }));
    for (const s of SKILLS.filter(x => !x.hidden)) {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !S.off.includes(s.id);
      cb.onchange = () => { S.off = cb.checked ? S.off.filter(x => x !== s.id) : [...S.off, s.id]; save(); };
      skc.append(el('label', { class: 'tog' }, el('span', {}, `${s.icon} ${s.name}`, el('small', { text: s.desc })), cb));
    }
    const tts = el('input', { type: 'checkbox' }); tts.checked = S.tts; tts.onchange = () => { S.tts = tts.checked; save(); };
    skc.append(el('label', { class: 'tog' }, el('span', {}, '🔊 Réponses à voix haute', el('small', { text: "L'assistant lit ses réponses" })), tts));
    v.append(skc);

    const cid = el('input', { type: 'text', placeholder: 'xxxx.apps.googleusercontent.com', value: S.gclient });
    v.append(el('div', { class: 'card' }, el('h3', { text: '📅 Google Agenda' }),
      el('p', { text: 'Lecture seule : ton agenda de cours s’affiche avec tes tâches.' }), cid,
      el('div', { class: 'chips', style: 'margin-top:10px' },
        el('button', { class: 'chip', onclick: () => { S.gclient = cid.value.trim(); save(); gmsg('ID enregistré.'); }, text: 'Enregistrer l’ID' }),
        el('button', { class: 'chip p', onclick: () => { S.gclient = cid.value.trim(); save(); connectGoogle(); }, text: 'Connecter' })),
      el('p', { id: 'gmsg', class: 'hint', text: S.events.length ? `${S.events.length} événement(s) en mémoire.` : '' })));

    const box = el('textarea', { rows: 3, id: 'backup', placeholder: 'Ta sauvegarde apparaît ici. Pour restaurer : colle-la ici puis touche « Restaurer ».' });
    const bmsg = el('p', { class: 'hint', text: '' });
    v.append(el('div', { class: 'card' }, el('h3', { text: '💾 Sauvegarde' }), el('p', { text: 'Tes données restent sur ce téléphone. Copie ta sauvegarde de temps en temps (dans Notes, par exemple).' }), box,
      el('div', { class: 'chips', style: 'margin-top:10px' },
        el('button', { class: 'chip', onclick: async () => {
          box.value = JSON.stringify({ items: S.items, rf: S.rf, off: S.off, tts: S.tts });
          box.select(); try { await navigator.clipboard.writeText(box.value); bmsg.textContent = 'Copié !'; } catch (e) { bmsg.textContent = 'Sélectionne le texte et copie-le.'; }
        }, text: 'Créer / copier' }),
        el('button', { class: 'chip', onclick: () => {
          try { const j = JSON.parse(box.value); if (!Array.isArray(j.items)) throw 0; S = { ...S, ...j }; save(); render(); }
          catch (e) { bmsg.textContent = 'Texte invalide.'; }
        }, text: 'Restaurer' })), bmsg));
  }

  function render() {
    const v = $('#view'); const keep = document.activeElement && document.activeElement.id === 'chatin';
    const scrollY = window.scrollY;
    v.innerHTML = '';
    ({ home: renderHome, brain: renderBrain, chat: renderChat, settings: renderSettings })[view](v);
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    $('#fab').hidden = view === 'chat' || view === 'settings';
    if (view !== 'chat') window.scrollTo(0, scrollY);
    if (keep) { const i = $('#chatin'); if (i) i.focus(); }
  }

  /* ================= Fiche d'édition ================= */
  let editing = null;
  function openSheet(it) {
    editing = it || null;
    $('#sheettitle').textContent = it ? 'Modifier' : 'Nouvelle entrée';
    $('#s-title').value = it ? it.title : ''; $('#s-date').value = it ? it.date : ''; $('#s-time').value = it ? it.time : '';
    $('#s-imp').value = it ? it.imp : 2; $('#s-cat').value = it ? it.cat : 'Autre'; $('#s-notes').value = it ? it.notes || '' : '';
    $('#s-del').hidden = !it; $('#sheetwrap').hidden = false;
    setTimeout(() => $('#s-title').focus(), 50);
  }
  const closeSheet = () => { $('#sheetwrap').hidden = true; editing = null; };
  $('#s-cancel').onclick = closeSheet;
  $('#sheetwrap').onclick = e => { if (e.target.id === 'sheetwrap') closeSheet(); };
  let delArmed = false;
  $('#s-del').onclick = () => {
    if (!editing) return;
    if (!delArmed) { delArmed = true; $('#s-del').textContent = 'Confirmer ?'; setTimeout(() => { delArmed = false; $('#s-del').textContent = 'Supprimer'; }, 3000); return; }
    delArmed = false; $('#s-del').textContent = 'Supprimer';
    S.items = S.items.filter(i => i.id !== editing.id); save(); closeSheet(); render();
  };
  $('#sheet').onsubmit = e => {
    e.preventDefault();
    let title = $('#s-title').value.trim(), date = $('#s-date').value, time = $('#s-time').value, imp = +$('#s-imp').value;
    if (!date && !time) { const p = E.parse(title); if (p.title && (p.date || p.time)) { title = p.title; date = p.date || ''; time = p.time || ''; if (p.imp === 3) imp = 3; } }
    const f = { title, date, time, imp, cat: $('#s-cat').value, notes: $('#s-notes').value.trim() };
    if (editing) {
      if (f.date !== editing.date || f.time !== editing.time) { editing.lastNotified = Date.now(); editing.alertOpen = false; editing.snoozeUntil = 0; }
      Object.assign(editing, f);
      if (!editing.date && !editing.nextReview) editing.nextReview = E.nextReview(0, Date.now());
    } else S.items.unshift(mk(f));
    save(); closeSheet(); render();
  };
  $('#fab').onclick = () => openSheet(null);
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { view = b.dataset.v; render(); window.scrollTo(0, 0); });

  /* ================= Démarrage ================= */
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 30000);
  tick(); render();
  window.__app = { get S() { return S; }, ask, render, tick, mk, setView: v => { view = v; render(); } }; // utile pour les tests
})();
