/* Second Cerveau : interface, assistant et skills. Tout est local et gratuit. */
(function () {
  'use strict';
  const VERSION = '2026.11.10-14';
  const API = 'https://second-cerveau-api.second-cerveau-api.workers.dev'; // ton serveur Cloudflare (adresse publique, sans secret)
  const DEFAULT_GCLIENT = '18600225788-ni03cjae4r7ugjrdr2pmmddkcrlgslqg.apps.googleusercontent.com'; // ID public, pas un secret
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
    if (!S.gclient) S.gclient = DEFAULT_GCLIENT;
    try {
      if (!S.migrated) {
        const old = JSON.parse(localStorage.getItem('orga.tasks.v1') || '[]');
        old.forEach(t => S.items.push(mk({ title: t.title, date: t.date, time: t.time, cat: t.cat, done: !!t.done })));
        S.migrated = true;
      }
      const c = localStorage.getItem('orga.gclient'); if (c && !S.gclient) S.gclient = c;
    } catch (e) {}
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} scheduleSync(); };
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
      if (!S.push) notify('À ne pas oublier', `${it.title} — ${isLate(it) ? 'en retard' : rel(E.dueAt(it))}`, it.id);   // si le serveur gère les rappels, pas de doublon
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
  /* Priorité d'un événement d'agenda : tes choix d'abord, puis mes règles, sinon je te demande. */
  function prioOf(e) {
    const d = S.prio && S.prio[E.prioKey(e.title)];
    if (d) return d;
    if (e.acct === 'ecole') return 'normal';
    const a = E.autoPrio(e.title);
    if (a.sure) return a.imp === 3 ? 'high' : 'low';
    return !e.time ? 'ask' : 'normal';             // événement sur toute la journée et inconnu : je demande
  }
  const visibleEvents = () => S.events.filter(e => prioOf(e) !== 'ignore');
  const dayItems = ds => [...open().filter(i => i.date === ds), ...visibleEvents().filter(e => e.date === ds)].sort(byTime);
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
    { id: 'priorite', icon: '⭐', name: 'Priorités', desc: "Je décide de l'importance, tu corriges", ex: 'Ignore Veterans Day',
      match: t => /^(?:ignore|masque|cache)\s+\S/i.test(t) || /\b(?:est|c['’]est)\s+(?:vraiment\s+)?(?:important|prioritaire|urgent)\b/i.test(t) || /\b(?:pas|plus)\s+(?:important|urgent|prioritaire)\b/i.test(t) || /^(?:qu['’]est[- ]ce qui est|c['’]est quoi)\s+(?:le plus\s+)?(?:important|prioritaire|urgent)/i.test(t),
      run: t => {
        if (/^(?:qu['’]est[- ]ce qui est|c['’]est quoi)\s+(?:le plus\s+)?(?:important|prioritaire|urgent)/i.test(t)) {
          const o = [...open().filter(i => i.date), ...visibleEvents().filter(e => e.date >= today() && prioOf(e) === 'high')].sort((a, b) => ((b.imp || 3) - (a.imp || 3)) || byTime(a, b)).slice(0, 6);
          return o.length ? "Voici l'essentiel :\n" + o.map(i => `• ${i.title} (${when(i)})`).join('\n') : "Rien d'important en vue.";
        }
        const ign = /^(?:ignore|masque|cache)\s+/i.test(t), low = /\b(?:pas|plus)\s+(?:important|urgent|prioritaire)\b/i.test(t);
        const q = t.replace(/^(?:ignore|masque|cache)\s+/i, '').replace(/\b(?:n['’]?est|c['’]?est|est)\s+(?:vraiment\s+|plus\s+|pas\s+)*(?:important|urgent|prioritaire)\b/gi, '').replace(/\b(?:pas|plus)\s+(?:important|urgent|prioritaire)\b/gi, '').trim();
        const level = ign ? 'ignore' : low ? 'low' : 'high';
        const it = bestMatch(q);
        if (it) { it.imp = level === 'high' ? 3 : 1; it.lastNotified = Date.now(); save(); render(); return `⭐ « ${it.title} » passe en priorité ${level === 'high' ? 'haute : tes rappels commenceront plus tôt' : 'basse : tes rappels seront plus discrets'}.`; }
        const ev = S.events.map(e => [E.score(q, e), e]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0])[0];
        if (ev) {
          S.prio = S.prio || {}; S.prio[E.prioKey(ev[1].title)] = level; save(); render();
          return level === 'ignore' ? `🔕 Compris : je ne t'afficherai plus « ${ev[1].title} » ni les événements du même nom.` : level === 'low' ? `👌 « ${ev[1].title} » passe en basse priorité (grisé, jamais mis en avant).` : `⭐ « ${ev[1].title} » est désormais important.`;
        }
        return "Je n'ai pas trouvé de quoi il s'agit. Redis-moi le nom exact de la tâche ou de l'événement.";
      } },
    { id: 'mails', icon: '📧', name: 'Mes mails', desc: 'Les mails qui demandent une action', ex: "Qu'ai-je reçu comme mails ?",
      match: t => /(?:mails?|e-?mails?|courriels?)/i.test(t) && /(?:qu['’]ai-je|qu['’]est[- ]ce que j['’]ai|j['’]ai (?:des|re[cç]u)|[àa] traiter|importants?|montre|liste|dernier)/i.test(t) && !/^(?:[ée]cris|r[ée]dige|pr[ée]pare|envoie)/i.test(t),
      run: () => {
        if (!S.srvToken) return "Le serveur n'est pas appairé : va dans Réglages.";
        if (!S.mailOn) return "Gmail n'est pas encore connecté. Va dans Réglages → Mails (Gmail) → Connecter.";
        const l = S.mail || [];
        return l.length ? `📧 ${l.length} mail${l.length > 1 ? 's' : ''} à traiter :\n` + l.slice(0, 8).map(m => `• ${m.title}${m.date ? ' → ' + dayLabel(m.date) : ''}`).join('\n') + '\n\nIls sont aussi sur ton écran d\'accueil, avec le bouton « Ajouter au planning ».' : 'Rien de particulier dans tes mails récents 👌';
      } },
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
    { id: 'mail', icon: '✉️', name: 'Écrire un mail', desc: 'Prépare un brouillon dans ton app Mail (tu envoies toi-même)', ex: 'Écris un mail à prof@univ.fr pour demander un délai',
      match: t => /^(?:[ée]cris|r[ée]dige|pr[ée]pare|envoie)(?:[- ]moi)?\s+(?:un\s+)?(?:mail|e-?mail|message)/i.test(t),
      run: t => {
        const to = (t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0];
        let sub = t.replace(/^(?:[ée]cris|r[ée]dige|pr[ée]pare|envoie)(?:[- ]moi)?\s+(?:un\s+)?(?:mail|e-?mail|message)\s*/i, '').replace(to, '').replace(/^\s*(?:à|a)\s+/i, '').replace(/^\s*(?:pour|afin de|au sujet de|à propos de|concernant)\s+/i, '').trim();
        sub = sub[0] ? sub[0].toUpperCase() + sub.slice(1) : 'Question';
        const body = `Bonjour,\n\nJe vous écris pour : ${sub.charAt(0).toLowerCase() + sub.slice(1)}.\n\nMerci d’avance pour votre retour.\n\nCordialement,`;
        return { text: `✉️ Brouillon prêt${to ? ' pour ' + to : ''} :\n\nObjet : ${sub}\n\n${body}\n\nTouche le bouton pour l'ouvrir dans Mail : tu pourras le modifier et c'est toi qui envoies.`, prop: { type: 'mail', to, subject: sub, body } };
      } },
    { id: 'ajouter', icon: '➕', name: 'Rappels', desc: 'Écris en français normal, je comprends la date', ex: 'Rappelle-moi de rendre le dossier vendredi à 14h', hidden: true,
      match: () => true,
      run: t => {
        const p = E.parse(t);
        if (!p.title) return "Je n'ai pas compris. Essaie : « Rappelle-moi d'appeler la banque demain à 10h ».";
        const ap = p.imp === 3 ? { sure: false } : E.autoPrio(p.title);
        const it = mk({ title: p.title, date: p.date, time: p.time, imp: ap.sure ? ap.imp : p.imp }); S.items.unshift(it); save(); render();
        const why = ap.sure ? `\n⭐ Priorité ${ap.imp === 3 ? 'haute' : 'basse'} : j'ai repéré « ${ap.why} ». Dis-moi si ce n'est pas bon (« ${it.title.split(' ').slice(0, 4).join(' ')} n'est pas important » pour la baisser).` : '';
        if (!it.date) return `C'est noté : « ${it.title} » (sans date). Je te le ressortirai régulièrement dans « Mémoire ».${why}`;
        const nx = E.nextReminderAt(it, S.rf, Date.now());
        return `C'est noté ✅ « ${it.title} » — ${when(it)}${it.imp === 3 ? ' (priorité haute)' : ''}.\n` + (nx ? `Premier rappel ${rel(nx)}, puis de plus en plus proches.` : 'Je te préviendrai au moment voulu.') + why;
      } }
  ];
  const enabled = () => SKILLS.filter(s => !S.off.includes(s.id));

  function say(text, fromSystem, prop) {
    S.chat.push({ r: 'a', t: text, ts: Date.now(), prop }); S.chat = S.chat.slice(-60);
    if (S.tts && !fromSystem && 'speechSynthesis' in window) {
      try { const u = new SpeechSynthesisUtterance(text.replace(/[•📅⚠️💭✅🎯🧭]/gu, '')); u.lang = 'fr-FR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
    }
  }
  /* ---------- Assistant IA : il connaît tes tâches et ton agenda, et PROPOSE des actions que tu valides ---------- */
  let aiBusy = false;
  const aiReady = () => !!(S.aiOn && S.srvToken && navigator.onLine !== false);
  function aiContext() {
    const td = today(), lim = E.dstr(addDays(21));
    const dated = open().filter(i => i.date).sort(byTime).slice(0, 40).map(i => ({ id: i.id, t: i.title.slice(0, 90), d: i.date, h: i.time, i: i.imp || 2, late: isLate(i) || undefined }));
    const ideas = open().filter(i => !i.date).slice(0, 10).map(i => ({ id: i.id, t: i.title.slice(0, 90), idea: true }));
    const evs = visibleEvents().filter(e => e.date >= td && e.date <= lim).sort(byTime).slice(0, 40).map(e => ({ t: e.title.slice(0, 90), d: e.date, h: e.time }));
    const mails = (S.mail || []).slice(0, 5).map(m => ({ t: (m.title || '').slice(0, 90), d: m.date || '' }));
    return { items: [...dated, ...ideas], events: evs, mails };
  }
  async function aiChat(text) {
    const url = (text.match(/https?:\/\/[^\s<>"')]+/) || [])[0];
    let page = null, msg = text;
    if (url) {                                                       // lecture de la page que TU as envoyée
      try { const p = await srv('/api/web', { url }); if (p.ok) page = p; else say('Je n’ai pas pu ouvrir cette page (' + p.reason + ').', true); } catch (e) {}
      if (text.replace(url, '').trim().length < 3) msg = 'Résume cette page en quelques phrases et dis-moi s’il y a des dates ou des choses à faire.';
    }
    const history = S.chat.filter(m => !m.tmp).slice(-8, -1).map(m => ({ r: m.r, t: m.t }));
    return srv('/api/ai/chat', { message: msg, history, context: aiContext(), page });
  }
  function applyAction(a) {
    if (a.type === 'add') { S.items.unshift(mk({ title: a.title, date: a.date, time: a.time, imp: a.importance, cat: 'Autre' })); return; }
    const it = S.items.find(i => i.id === a.id); if (!it) return;
    if (a.type === 'done') complete(it);
    else if (a.type === 'move') { it.date = a.date; it.time = a.time || ''; it.lastNotified = Date.now(); it.alertOpen = false; it.snoozeUntil = 0; }
  }
  function ask(text) {
    text = text.trim(); if (!text) return;
    S.chat.push({ r: 'u', t: text, ts: Date.now() });
    const ai = aiReady(), fallback = SKILLS.find(s => s.id === 'ajouter');
    const sk = enabled().find(s => s.id !== 'ajouter' && s.match(text) && !(ai && s.id === 'mail'));
    const runSkill = s => { let r; try { r = s.run(text); } catch (e) { r = "Oups, j'ai eu un souci : " + e.message; } if (r && typeof r === 'object') say(r.text, false, r.prop); else say(r); };
    if (sk || !ai) { runSkill(sk || fallback); save(); render(); return; }
    const tmp = { r: 'a', t: '💭 Je réfléchis…', ts: Date.now(), tmp: true }; S.chat.push(tmp); aiBusy = true; render();
    aiChat(text).then(r => {
      S.chat = S.chat.filter(m => m !== tmp); aiBusy = false;
      if (r && r.ok) say(r.reply, false, r.actions && r.actions.length ? { type: 'ai', actions: r.actions } : undefined);
      else { say('⚠️ L’IA ne répond pas pour l’instant (' + ((r && r.reason) || 'erreur') + '). Je fais au plus simple.', true); runSkill(fallback); }
      save(); render();
    }).catch(e => { S.chat = S.chat.filter(m => m !== tmp); aiBusy = false; say('⚠️ Pas de connexion avec le serveur. Je fais au plus simple.', true); runSkill(fallback); save(); render(); });
  }

  /* ---------- Documents : PDF et photos, lus sur le téléphone ---------- */
  const loadedLibs = {};
  function loadScript(url) {
    if (!loadedLibs[url]) loadedLibs[url] = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => ko(new Error('Chargement impossible (internet ?)')); document.head.appendChild(s); });
    return loadedLibs[url];
  }
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  async function ocr(source) {
    await loadScript(TESS);
    const r = await Tesseract.recognize(source, 'fra');
    return r.data.text || '';
  }
  async function readFile(file, quiet) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      await loadScript(PDFJS + 'pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let txt = '';
      const n = Math.min(pdf.numPages, 8);
      for (let p = 1; p <= n; p++) {
        const c = await (await pdf.getPage(p)).getTextContent();
        txt += c.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('') + '\n';
      }
      if (txt.replace(/\s/g, '').length < 40) {            // PDF scanné : on lit l'image
        if (!quiet) { say('Ce PDF est une image, je le lis comme une photo (ça peut prendre une minute)…', true); render(); }
        txt = '';
        for (let p = 1; p <= Math.min(n, 3); p++) {
          const page = await pdf.getPage(p), vp = page.getViewport({ scale: 2 });
          const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          txt += await ocr(cv) + '\n';
        }
      }
      return txt;
    }
    if (/^image\//.test(file.type)) { if (!quiet) { say('Je lis la photo (ça peut prendre une minute)…', true); render(); } return ocr(file); }
    throw new Error('Format non géré (PDF ou photo seulement).');
  }
  async function handleFile(file) {
    S.chat.push({ r: 'u', t: '📎 ' + file.name, ts: Date.now() });
    say('Je lis le document sur ton téléphone, rien n’est envoyé sur internet (sauf le chargement des outils de lecture).', true); render();
    try {
      const txt = await readFile(file);
      if (txt.replace(/\s/g, '').length < 15) { say("Je n'ai pas réussi à lire de texte. Essaie une photo plus nette, bien éclairée.", true); save(); render(); return; }
      const d = E.extractDoc(txt);
      const kinds = { train: '🚆 Billet de train', facture: '🧾 Facture', rdv: '📌 Convocation / rendez-vous', doc: '📄 Document' };
      const lines2 = [`${kinds[d.kind]} — voici ce que j'ai trouvé :`, `• ${d.title}`, d.date ? `• Date : ${dayLabel(d.date)}${d.time ? ' à ' + d.time : ''}` : '• Aucune date trouvée', d.notes && '• ' + d.notes].filter(Boolean);
      if (d.dates.length > 1) lines2.push('Autres dates vues : ' + d.dates.slice(1).map(dayLabel).join(', '));
      say(lines2.join('\n'), true, { type: 'task', title: d.title, date: d.date || '', time: d.time || '', imp: d.imp, notes: d.notes, cat: d.kind === 'facture' || d.kind === 'rdv' ? 'Admin' : 'Autre' });
    } catch (e) { say('Je n’ai pas pu lire ce document : ' + e.message, true); }
    save(); render();
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
      const min = addDays(0), max = addDays(30);
      const cals = (await gapi('https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=true&minAccessRole=reader&maxResults=250')).items || [];
      const prim = cals.find(c => c.primary), acct = prim ? prim.id : 'compte';
      const out = [], report = [];
      for (const c of cals) {
        let n = 0, token = '';
        for (let page = 0; page < 3; page++) {
          const q = new URLSearchParams({ timeMin: min.toISOString(), timeMax: max.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
          if (token) q.set('pageToken', token);
          const d = await gapi(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
          for (const e of d.items || []) {
            if (e.status === 'cancelled' || !e.start) continue;
            const s = e.start.dateTime ? new Date(e.start.dateTime) : null;
            out.push({ id: 'g' + c.id + e.id, title: e.summary || '(sans titre)', date: s ? E.dstr(s) : e.start.date, time: s ? E.hm(s) : '', cat: 'Agenda', ro: true, cal: c.summaryOverride || c.summary, acct, done: false });
            n++;
          }
          token = d.nextPageToken || ''; if (!token) break;
        }
        report.push({ name: c.summaryOverride || c.summary, n, hidden: !!c.hidden || c.selected === false });
      }
      S.events = S.events.filter(e => e.acct !== acct).concat(out);
      S.gacc = { ...(S.gacc || {}), [acct]: { ts: Date.now(), cals: report } };
      S.gsync = Date.now(); save();
      gmsg(`${acct} : ${cals.length} agenda(s), ${out.length} événement(s) sur 30 jours.`); render();
    } catch (e) { gmsg('Échec : ' + e.message); }
  }
  async function connectGoogle(another) {
    if (!S.gclient) { gmsg("Colle d'abord ton ID client Google ci-dessus."); return; }
    try { await loadGis(); } catch (e) { gmsg('Impossible de joindre Google (internet ?).'); return; }
    google.accounts.oauth2.initTokenClient({
      client_id: S.gclient, scope: 'https://www.googleapis.com/auth/calendar.readonly', prompt: another ? 'select_account' : '',
      callback: r => { if (r.access_token) { gtoken = r.access_token; fetchEvents(); } else gmsg('Connexion refusée.'); },
      error_callback: () => gmsg('Connexion annulée.')
    }).requestAccessToken();
  }

  /* ================= Serveur (rappels app fermée + planning école) ================= */
  async function srv(path, body) {
    const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + S.srvToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('Serveur ' + r.status);
    return r.json();
  }
  let syncTimer = null, syncing = false;
  function scheduleSync() { if (!S.srvToken) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncServer, 2500); }
  async function syncServer() {
    if (!S.srvToken || syncing || navigator.onLine === false) return;
    syncing = true;
    try {
      const items = S.items.map(i => ({ id: i.id, title: i.title, date: i.date, time: i.time, imp: i.imp, done: !!i.done, created: i.created, lastNotified: i.lastNotified, lastAlertAt: i.lastAlertAt, alertOpen: !!i.alertOpen, snoozeUntil: i.snoozeUntil }));
      const res = await srv('/api/sync', { items, rf: S.rf });
      let ch = false;
      for (const it of S.items) {
        const ts = res.alerts && res.alerts[it.id];
        if (ts && ts > (it.lastNotified || 0) && !it.done) { it.lastNotified = ts; it.lastAlertAt = ts; it.alertOpen = true; it.snoozeUntil = 0; it.alerts = (it.alerts || 0) + 1; ch = true; }
      }
      const ev = await srv('/api/events');
      const mapped = (ev.events || []).map(e => ({ id: 's' + e.id, title: e.title, date: e.date, time: e.time, endTime: e.endTime, loc: e.loc, cat: 'Cours', ro: true, cal: 'ESSEC', acct: 'ecole', done: false }));
      if (JSON.stringify(mapped) !== JSON.stringify(S.events.filter(e => e.acct === 'ecole'))) { S.events = S.events.filter(e => e.acct !== 'ecole').concat(mapped); ch = true; }
      try { const h = await (await fetch(API + '/api/health')).json(); S.aiOn = !!h.ai; } catch (e) {}   // l'IA est-elle disponible ?
      try {                                                           // messages envoyés depuis le Raccourci iPhone
        const ib = (await srv('/api/inbox')).list || [];
        if (ib.length) {
          for (const m of ib) {
            if (m.file) {                                              // PDF / photo partagé : lu sur le téléphone
              const ext = /pdf/.test(m.file.mime) ? 'pdf' : (m.file.mime.split('/')[1] || 'bin');
              let d = null;
              try {
                const r = await fetch(`${API}/api/inbox/file?id=${encodeURIComponent(m.id)}`, { headers: { Authorization: 'Bearer ' + S.srvToken } });
                if (!r.ok) throw new Error('fichier ' + r.status);
                const txt = await readFile(new File([await r.blob()], 'partage.' + ext, { type: m.file.mime }), true);
                if (txt.replace(/\s/g, '').length >= 15) d = E.extractDoc(txt);
              } catch (e) {}
              S.items.unshift(d
                ? mk({ title: d.title, date: d.date || '', time: d.time || '', notes: d.notes || '', cat: d.kind === 'facture' || d.kind === 'rdv' ? 'Admin' : 'Document', imp: d.imp || 2 })
                : mk({ title: 'Document reçu (illisible, à regarder)', cat: 'Document', imp: 2 }));
              continue;
            }
            let raw = (m.text || '').replace(/^﻿/, '').trim();
            if (/^BEGIN:VCARD/i.test(raw)) {                          // fiche contact partagée
              const g = re => ((raw.match(re) || [])[1] || '').trim();
              const nm = g(/^FN[^:\n]*:(.+)$/mi) || g(/^N[^:\n]*:(.+)$/mi).replace(/;+/g, ' ').trim(), tel = g(/^TEL[^:\n]*:(.+)$/mi), em = g(/^EMAIL[^:\n]*:(.+)$/mi), org = g(/^ORG[^:\n]*:(.+)$/mi).replace(/;/g, ' ');
              S.items.unshift(mk({ title: 'Contact : ' + (nm || 'sans nom'), notes: [org, tel && 'Tél : ' + tel, em && 'Mail : ' + em].filter(Boolean).join('\n'), cat: 'Contact', imp: 2 }));
              continue;
            }
            if (/^BEGIN:VCALENDAR/i.test(raw)) {                      // événement de calendrier partagé
              const g = re => ((raw.match(re) || [])[1] || '').trim(), d = g(/^DTSTART[^:\n]*:(\d{8})(?:T(\d{4}))?/mi), tt = (raw.match(/^DTSTART[^:\n]*:\d{8}T(\d{4})/mi) || [])[1] || '';
              S.items.unshift(mk({ title: g(/^SUMMARY[^:\n]*:(.+)$/mi) || 'Événement reçu', date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '', time: tt ? tt.slice(0, 2) + ':' + tt.slice(2) : '', notes: g(/^LOCATION[^:\n]*:(.+)$/mi), cat: 'Agenda', imp: 2 }));
              continue;
            }
            if (/^https?:\/\/\S+$/i.test(raw)) {                       // lien seul (page, article, plan)
              let host = raw; try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch (e) {}
              S.items.unshift(mk({ title: 'Lien : ' + host, notes: raw, cat: 'Lien', imp: 2 }));
              continue;
            }
            if (/^\s*(<!doctype html|<html)/i.test(raw)) raw = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
            m.text = raw;
            let ai = null;                                              // l'IA comprend le sens du message (sinon on retombe sur l'analyse simple)
            try { const a = await srv('/api/ai/message', { text: raw }); if (a && a.ok) ai = a; } catch (e) {}
            if (ai) {
              const kinds = { tache: 'Message', evenement: 'Agenda', reponse: 'Répondre', info: 'Info' };
              S.items.unshift(mk({ title: ai.title, date: ai.date, time: ai.time, imp: ai.importance, cat: kinds[ai.kind] || 'Message', ai: true,
                notes: [ai.summary, ai.who && 'De : ' + ai.who, '— Message d\'origine —\n' + raw.slice(0, 1500)].filter(Boolean).join('\n') }));
              continue;
            }
            const p = E.parse(m.text), title = (p.title || m.text).split('\n')[0].slice(0, 120), ap = E.autoPrio(m.text);
            S.items.unshift(mk({ title, notes: (m.from ? 'De : ' + m.from + '\n' : '') + m.text, cat: 'Message', date: p.date || '', time: p.time || '', imp: p.imp === 3 ? 3 : (ap.sure ? ap.imp : 2) }));
          }
          await srv('/api/inbox/ack', { ids: ib.map(m => m.id) }); ch = true;
        }
      } catch (e) {}
      try {                                                           // mails repérés par le serveur
        const ml = await srv('/api/mail/suggestions'), sig = JSON.stringify([ml.list, ml.connected, ml.error, ml.secretSet]);
        if (sig !== S.mailSig) { S.mail = ml.list; S.mailOn = ml.connected; S.mailErr = ml.error; S.mailSecret = ml.secretSet; S.mailSig = sig; ch = true; }
      } catch (e) {}
      S.srvSync = Date.now(); S.srvErr = '';
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
      if (ch) render();
      autoReadAtts();
    } catch (e) { S.srvErr = e.message; } finally { syncing = false; }
  }
  /* Pièces jointes : le serveur les transmet, c'est le téléphone qui les lit (rien n'est analysé ailleurs) */
  async function fetchAttachment(m, a) {
    const r = await fetch(`${API}/api/mail/attachment?mid=${encodeURIComponent(m.id)}&aid=${encodeURIComponent(a.aid)}`, { headers: { Authorization: 'Bearer ' + S.srvToken } });
    if (!r.ok) throw new Error('Pièce jointe indisponible (' + r.status + ')');
    const j = await r.json(), bin = atob(j.data.replace(/-/g, '+').replace(/_/g, '/'));
    return new File([Uint8Array.from(bin, c => c.charCodeAt(0))], a.name, { type: a.mime });
  }
  async function readMailAtts(m, force) {
    S.mailDoc = S.mailDoc || {};
    if (S.mailDoc[m.id] && !force) return;
    for (const a of (m.atts || [])) {
      try {
        const txt = await readFile(await fetchAttachment(m, a), true);
        if (txt.replace(/\s/g, '').length < 15) continue;
        const d = E.extractDoc(txt);
        S.mailDoc[m.id] = { name: a.name, kind: d.kind, title: d.title, date: d.date, time: d.time, amount: d.amount, notes: d.notes, imp: d.imp };
        return;
      } catch (e) { S.mailDocErr = e.message; }
    }
    S.mailDoc[m.id] = { name: ((m.atts || [])[0] || {}).name || '', none: true };
  }
  let attBusy = false;
  async function autoReadAtts() {                    // les PDF des mails importants sont lus automatiquement ; les photos, à la demande
    if (attBusy || !S.srvToken) return; attBusy = true;
    try {
      let ch = false;
      for (const m of (S.mail || []).slice(0, 4)) {
        if (!(m.atts || []).some(a => /pdf/i.test(a.mime)) || (S.mailDoc && S.mailDoc[m.id])) continue;
        await readMailAtts(m); ch = true;
      }
      if (ch) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} render(); }
    } catch (e) {} finally { attBusy = false; }
  }
  function dismissMail(m) {
    S.mail = (S.mail || []).filter(x => x.id !== m.id); S.mailSig = ''; if (S.mailDoc) delete S.mailDoc[m.id];
    save(); render(); srv('/api/mail/dismiss', { id: m.id }).catch(() => {});
  }
  async function connectGmail() {
    const msg = t => { const n = $('#mailmsg'); if (n) n.textContent = t; };
    try { const r = await srv('/api/google/auth-url', {}); location.href = r.url; }
    catch (e) { msg(S.mailSecret === false ? "Il manque le secret Google sur le serveur (voir le guide)." : 'Échec : ' + e.message); }
  }
  const b64key = k => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  async function enablePush() {
    const msg = t => { const n = $('#pushmsg'); if (n) n.textContent = t; };
    try {
      if (!S.srvToken) { msg("Le serveur n'est pas appairé : ouvre le lien d'appairage que je t'ai envoyé."); return; }
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { msg("Il faut ouvrir l'app depuis l'écran d'accueil (Partager → Sur l'écran d'accueil) pour recevoir des notifications."); return; }
      if (await Notification.requestPermission() !== 'granted') { msg('Notifications refusées. Active-les dans Réglages iPhone → Notifications → Cerveau.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch(API + '/api/vapid')).json();
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(key) });
      await srv('/api/push/subscribe', { subscription: sub.toJSON() });
      S.push = true; save(); render(); msg('✅ Rappels app fermée activés.');
    } catch (e) { msg('Échec : ' + e.message); }
  }
  async function testPush() {
    const msg = t => { const n = $('#pushmsg'); if (n) n.textContent = t; };
    try { const r = await srv('/api/push/test', {}); msg(r.sent ? 'Test envoyé. Ferme l’app : la notification arrive dans quelques secondes.' : "Aucun appareil abonné. Touche d'abord « Activer les rappels app fermée »."); }
    catch (e) { msg('Échec : ' + e.message); }
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
    const pr = ev ? prioOf(it) : '';
    return el('div', { class: 'row' + (it.done ? ' done' : '') + (pr === 'low' || (!ev && it.imp === 1 && !it.done) ? ' dim' : ''), onclick: ev ? null : () => openSheet(it) },
      left, el('div', { class: 'b' }, el('div', { class: 'n', text: it.title }), meta), ((!ev && it.imp === 3 && !it.done) || pr === 'high') && el('span', { class: 'dot', title: 'Haute' }));
  }
  const section = (title, items, cls) => items.length ? [el('h2', { class: cls || '', text: `${title} (${items.length})` }), ...items.map(row)] : [];

  function renderHome(v) {
    const now = Date.now(), td = today(), h = new Date().getHours();
    v.append(el('div', { class: 'top' },
      el('div', {}, el('div', { class: 'date', text: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }),
        el('h1', { text: h < 6 ? 'Bonne nuit 🌙' : h < 18 ? 'Bonjour 👋' : 'Bonsoir 🌆' }))));

    if (S.gacc && Object.keys(S.gacc).length && Date.now() - (S.gsync || 0) > 45 * 60e3) {
      v.append(el('button', { class: 'chip', style: 'margin-bottom:12px', onclick: () => connectGoogle(false), text: `🔄 Actualiser l'agenda (dernière synchro ${rel(S.gsync || 0)})` }));
    }
    const evs = visibleEvents();
    // Événements que je ne sais pas classer : je te demande ton avis (2 à la fois)
    const seen = new Set(), toAsk = [];
    for (const e of evs) { const k = E.prioKey(e.title); if (e.date >= td && prioOf(e) === 'ask' && !seen.has(k)) { seen.add(k); toAsk.push(e); } }
    for (const e of toAsk.slice(0, 2)) {
      const setP = lvl => { S.prio = S.prio || {}; S.prio[E.prioKey(e.title)] = lvl; save(); render(); };
      v.append(el('div', { class: 'alert', style: 'border-color:var(--acc)' },
        el('div', { class: 't', text: '🤔 Est-ce important pour toi ?' }),
        el('div', { class: 'm', text: `« ${e.title} » · ${dayLabel(e.date)}` }),
        el('div', { class: 'chips' },
          el('button', { class: 'chip p', onclick: () => setP('high'), text: '⭐ Important' }),
          el('button', { class: 'chip', onclick: () => setP('normal'), text: 'Normal' }),
          el('button', { class: 'chip', onclick: () => setP('ignore'), text: '🔕 Ignorer' }))));
    }
    const all = [...open().filter(i => i.date), ...evs.filter(e => e.date >= td && prioOf(e) !== 'low' && prioOf(e) !== 'ask')];
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

    for (const m of (S.mail || []).slice(0, 4)) {
      const doc = S.mailDoc && S.mailDoc[m.id], dd = doc && !doc.none && doc.date ? doc : null;
      const eur = x => x.toFixed(2).replace('.', ',') + ' €';
      const add = () => {
        S.items.unshift(mk({ title: dd && doc.kind !== 'doc' ? doc.title : m.title, date: (dd && dd.date) || m.date || (m.kind === 'reply' ? E.dstr(addDays(1)) : ''), time: (dd && dd.time) || m.time || '',
          imp: Math.max(m.imp, dd ? dd.imp : 0), cat: 'Mail',
          notes: [`Mail de ${m.from} : ${m.subject}`, doc && !doc.none && `Pièce jointe ${doc.name} : ${doc.notes || doc.title}`, m.amount != null && `Montant dans le mail : ${eur(m.amount)}`].filter(Boolean).join('\n') }));
        dismissMail(m);
      };
      v.append(el('div', { class: 'alert', style: 'border-color:var(--acc2)' },
        el('div', { class: 't', text: '📧 ' + m.title }),
        el('div', { class: 'm', text: (m.date ? `Date repérée : ${dayLabel(m.date)}${m.time ? ' à ' + m.time : ''}${m.amount != null ? ' · ' + eur(m.amount) : ''} · ` : '') + m.snippet }),
        doc && !doc.none && el('div', { class: 'm', text: `📎 ${doc.name} : ${doc.title}${doc.date ? ' · ' + dayLabel(doc.date) + (doc.time ? ' ' + doc.time : '') : ''}${doc.amount != null ? ' · ' + eur(doc.amount) : ''}` }),
        doc && doc.none && el('div', { class: 'm', text: `📎 ${doc.name || 'pièce jointe'} : illisible ou sans date` }),
        el('div', { class: 'chips' },
          el('button', { class: 'chip p', onclick: add, text: '➕ Ajouter au planning' }),
          (m.atts || []).length > 0 && (!doc || doc.none) && el('button', { class: 'chip', onclick: async e => { e.target.textContent = 'Lecture…'; await readMailAtts(m, true); save(); render(); }, text: '📎 Lire la pièce jointe' }),
          el('button', { class: 'chip', onclick: () => dismissMail(m), text: 'Ignorer' }))));
    }
    if ((S.mail || []).length > 4) v.append(el('p', { class: 'hint', text: `+ ${(S.mail || []).length - 4} autre(s) mail(s) à traiter. Traite ceux-ci pour voir la suite.` }));

    const dated = open().filter(i => i.date);
    const late = dated.filter(isLate).sort(byTime);
    const day = ds => [...dated.filter(i => i.date === ds && !isLate(i)), ...evs.filter(e => e.date === ds)].sort(byTime);
    v.append(...section('En retard', late, 'red'));
    v.append(...section("Aujourd'hui", day(td)));
    const wk = []; for (let k = 1; k <= 7; k++) wk.push(...day(E.dstr(addDays(k))));
    v.append(...section('Cette semaine', wk));
    const lim = E.dstr(addDays(7));
    const later = [...dated.filter(i => i.date > lim && !isLate(i)), ...evs.filter(e => e.date > lim)].sort(byTime).slice(0, 60);
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
    for (const m of S.chat) {
      if (m.tmp && !aiBusy) continue;
      const b = el('div', { class: 'msg ' + m.r, text: m.t });
      if (m.prop && m.prop.type === 'ai') {                            // actions proposées par l'IA : rien ne se fait sans ton bouton
        const row = el('div', { class: 'chips', style: 'margin-top:8px' });
        (m.prop.actions || []).forEach((a, k) => {
          const it = a.id ? S.items.find(i => i.id === a.id) : null;
          if (a.id && !it) return;
          if ((m.prop.doneIdx || []).includes(k)) { row.append(el('span', { class: 'hint', text: '✅ Fait' })); return; }
          if (a.type === 'mail') {
            const href = 'mailto:' + encodeURIComponent(a.to || '').replace('%40', '@') + '?subject=' + encodeURIComponent(a.subject || '') + '&body=' + encodeURIComponent(a.body);
            b.append(el('div', { class: 'hint', style: 'white-space:pre-wrap;margin-top:8px', text: (a.subject ? 'Objet : ' + a.subject + '\n\n' : '') + a.body }));
            row.append(el('a', { class: 'chip p', href, style: 'text-decoration:none', text: '✉️ Ouvrir dans Mail (tu relis et tu envoies)' }));
            return;
          }
          const label = a.type === 'add' ? `➕ ${a.title}${a.date ? ' · ' + dayLabel(a.date) + (a.time ? ' ' + a.time : '') : ''}`
            : a.type === 'done' ? `✅ Terminer « ${it.title.slice(0, 40)} »` : `📅 Déplacer « ${it.title.slice(0, 30)} » → ${dayLabel(a.date)}${a.time ? ' ' + a.time : ''}`;
          row.append(el('button', { class: 'chip p', onclick: () => { applyAction(a); (m.prop.doneIdx = m.prop.doneIdx || []).push(k); save(); render(); }, text: label }));
        });
        if (row.childNodes.length) b.append(row);
        chat.append(b); continue;
      }
      if (m.prop && m.prop.type === 'task') {
        b.append(el('div', { class: 'chips', style: 'margin-top:8px' },
          m.prop.added ? el('span', { class: 'hint', text: '✅ Ajouté à ton planning' })
            : el('button', { class: 'chip p', onclick: () => { S.items.unshift(mk({ title: m.prop.title, date: m.prop.date, time: m.prop.time, imp: m.prop.imp, notes: m.prop.notes, cat: m.prop.cat })); m.prop.added = true; save(); render(); }, text: '➕ Ajouter au planning' })));
      } else if (m.prop && m.prop.type === 'mail') {
        const href = 'mailto:' + encodeURIComponent(m.prop.to).replace('%40', '@') + '?subject=' + encodeURIComponent(m.prop.subject) + '&body=' + encodeURIComponent(m.prop.body);
        b.append(el('div', { class: 'chips', style: 'margin-top:8px' }, el('a', { class: 'chip p', href, style: 'text-decoration:none', text: '✉️ Ouvrir dans Mail' })));
      }
      chat.append(b);
    }
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
    const fileIn = el('input', { type: 'file', accept: 'application/pdf,image/*', id: 'filein', style: 'display:none' });
    fileIn.onchange = () => { const f = fileIn.files[0]; if (f) handleFile(f); };
    const clip = el('button', { class: 'mic', type: 'button', 'aria-label': 'Ajouter un document', text: '📎', onclick: () => fileIn.click() });
    v.append(el('div', { class: 'composer' }, clip, mic, input, el('button', { class: 'send', type: 'button', onclick: send, 'aria-label': 'Envoyer', text: '➤' })));
    setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 0);
  }

  async function updateApp(force) {
    const m = $('#upmsg'), say2 = t => { if (m) m.textContent = t; };
    say2('Recherche de mise à jour…');
    try {
      const txt = await (await fetch('app.js', { cache: 'no-store' })).text();
      const nv = (txt.match(/const VERSION = '([^']+)'/) || [])[1];
      if (!force && nv && nv === VERSION) { say2(`Tu as déjà la dernière version ✅ (${VERSION})`); return; }
      say2(`Installation de la version ${nv || 'la plus récente'}…`);
      const files = ['./', 'index.html', 'style.css', 'engine.js', 'app.js', 'sw.js', 'manifest.json', 'icon.svg'];
      await Promise.all(files.map(f => fetch(f, { cache: 'reload' }).catch(() => {})));
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
      if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      say2('Redémarrage…'); setTimeout(() => location.reload(), 400);
    } catch (e) { say2("Impossible de vérifier : es-tu connecté à internet ?"); }
  }

  function renderSettings(v) {
    v.append(el('div', { class: 'top' }, el('div', {}, el('div', { class: 'date', text: 'Personnalise ton cerveau' }), el('h1', { text: 'Réglages ⚙️' }))));
    v.append(el('div', { class: 'card' }, el('h3', { text: '🔄 Mise à jour' }),
      el('p', { text: `Version installée : ${VERSION}. Après un changement, touche le bouton pour récupérer la dernière version. Tes tâches et tes idées sont conservées.` }),
      el('div', { class: 'chips' },
        el('button', { class: 'chip p', onclick: () => updateApp(false), text: 'Mettre à jour' }),
        el('button', { class: 'chip', onclick: () => updateApp(true), text: 'Forcer la réinstallation' })),
      el('p', { class: 'hint', id: 'upmsg', text: '' })));
    v.append(el('div', { class: 'card' }, el('h3', { text: '☁️ Serveur & rappels app fermée' }),
      el('p', { text: S.srvToken ? `Serveur appairé${S.srvSync ? ' · dernière synchro ' + rel(S.srvSync) : ''}. Il t'envoie tes rappels même quand l'app est fermée et lit ton planning de l'école.${S.srvErr ? ' (dernière erreur : ' + S.srvErr + ')' : ''}` : "Pas encore appairé. Colle ci-dessous le code d'appairage que ton assistant t'a envoyé." }),
      !S.srvToken && el('div', { class: 'inline', style: 'margin-bottom:10px' },
        el('input', { type: 'text', id: 'pairin', placeholder: "Colle ici le code d'appairage" }),
        el('button', { class: 'chip p', type: 'button', onclick: () => {
          const m = ($('#pairin').value || '').match(/([\w-]{30,})\s*$/);
          if (!m) { const n = $('#pushmsg'); if (n) n.textContent = 'Code invalide : colle le code complet.'; return; }
          S.srvToken = m[1].replace(/^.*pair=/, ''); save(); syncServer().then(render); render();
        }, text: 'Appairer' })),
      el('div', { class: 'chips' },
        el('button', { class: 'chip p', onclick: enablePush, text: S.push ? 'Réactiver les notifications' : 'Activer les rappels app fermée' }),
        el('button', { class: 'chip', onclick: testPush, text: 'Tester' }),
        el('button', { class: 'chip', onclick: async () => { await syncServer(); render(); }, text: 'Synchroniser' })),
      el('p', { class: 'hint', id: 'pushmsg', text: '' })));
    v.append(el('div', { class: 'card' }, el('h3', { text: '📧 Mails (Gmail)' }),
      el('p', { text: !S.srvToken ? "Appaire d'abord le serveur (carte ci-dessus)." : S.mailOn ? `Gmail connecté. Le serveur lit chaque mail en entier (texte et pièces jointes PDF), en lecture seule, uniquement pour repérer deadlines et réponses à faire. Il ne garde que l'essentiel (expéditeur, objet, début du texte, dates).${S.mailErr ? ' Erreur : ' + S.mailErr : ''}` : S.mailSecret === false ? 'Il manque encore le secret Google sur le serveur (voir le guide).' : 'Gmail pas encore connecté.' }),
      el('div', { class: 'chips' },
        !S.mailOn && el('button', { class: 'chip p', onclick: connectGmail, text: 'Connecter Gmail' }),
        S.mailOn && el('button', { class: 'chip', onclick: async () => { try { await srv('/api/google/disconnect', {}); S.mail = []; S.mailOn = false; S.mailSig = ''; save(); render(); } catch (e) {} }, text: 'Déconnecter Gmail' })),
      el('p', { class: 'hint', id: 'mailmsg', text: '' }),
      el('p', { class: 'hint', text: "Mails de l'école : transfère-les vers ton Gmail (Paramètres → Transfert dans la boîte de l'école), je les verrai alors comme les autres." })));
    v.append(el('div', { class: 'card' }, el('h3', { text: '📥 Envoyer un message vers l\'app' }),
      el('p', { text: "Depuis WhatsApp, Instagram, Messages… : « Partager » → ton Raccourci « Vers Second Cerveau ». Le message arrive ici sans être marqué comme lu. Ce code ne peut qu'ajouter des messages, jamais lire tes données." }),
      el('div', { class: 'chips' }, el('button', { class: 'chip', disabled: !S.srvToken, onclick: async () => {
        const n = $('#capmsg'); if (!S.srvToken) return;
        try {
          const c = await srv('/api/capture-token');
          $('#capurl').value = c.url; $('#captok').value = c.token; $('#capbox').hidden = false;
          try { await navigator.clipboard.writeText(c.token); n.textContent = 'Code copié. Appuie longuement sur un champ pour copier l\'adresse.'; } catch (e) { n.textContent = 'Appuie longuement sur un champ pour le copier.'; }
        } catch (e) { n.textContent = 'Impossible de récupérer le code (' + e.message + ').'; }
      }, text: 'Afficher / copier le code du Raccourci' })),
      el('div', { id: 'capbox', hidden: true },
        el('input', { type: 'text', id: 'capurl', readonly: true }), el('input', { type: 'text', id: 'captok', readonly: true })),
      el('p', { class: 'hint', id: 'capmsg', text: '' })));
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
        el('button', { class: 'chip p', onclick: () => { S.gclient = cid.value.trim(); save(); connectGoogle(false); }, text: 'Actualiser / Connecter' }),
        el('button', { class: 'chip', onclick: () => { S.gclient = cid.value.trim(); save(); connectGoogle(true); }, text: '+ Autre compte (école…)' }),
        el('button', { class: 'chip', onclick: () => { S.events = []; S.gacc = {}; S.gsync = 0; save(); render(); }, text: 'Déconnecter' })),
      el('p', { id: 'gmsg', class: 'hint', text: S.events.length ? `${S.events.length} événement(s) en mémoire.` : '' }),
      ...Object.entries(S.gacc || {}).map(([a, d]) => el('p', { class: 'hint' }, `📧 ${a} — ${rel(d.ts)}`, el('br'), d.cals.map(c => `${c.hidden ? '🙈 ' : '• '}${c.name} (${c.n})`).join('\n'))),
      el('p', { class: 'hint', text: "Si l'agenda de ton école n'apparaît pas dans cette liste, il appartient à un autre compte (utilise « + Autre compte ») ou n'est pas partagé avec ce compte." })));

    const box = el('textarea', { rows: 3, id: 'backup', placeholder: 'Ta sauvegarde apparaît ici. Pour restaurer : colle-la ici puis touche « Restaurer ».' });
    const bmsg = el('p', { class: 'hint', text: '' });
    v.append(el('div', { class: 'card' }, el('h3', { text: '💾 Sauvegarde' }), el('p', { text: 'Tes données restent sur ce téléphone. Copie ta sauvegarde de temps en temps (dans Notes, par exemple).' }), box,
      el('div', { class: 'chips', style: 'margin-top:10px' },
        el('button', { class: 'chip', onclick: async () => {
          box.value = JSON.stringify({ items: S.items, rf: S.rf, off: S.off, tts: S.tts, prio: S.prio || {} });
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
  const pair = location.hash.match(/pair=([\w-]{20,})/);        // lien d'appairage : #pair=…
  if (pair) { S.srvToken = pair[1]; save(); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} say("☁️ Appairage réussi : ton téléphone est relié au serveur. Va dans Réglages pour activer les rappels app fermée.", true); }
  const gh = location.hash.match(/google=(ok|err)/);          // retour de la connexion Gmail
  if (gh) { say(gh[1] === 'ok' ? '📧 Gmail est connecté ! Je repère maintenant tes deadlines et les mails sans réponse.' : "La connexion à Gmail n'a pas abouti. Réessaie depuis Réglages → Mails (Gmail).", true); save(); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); syncServer(); } });
  setInterval(tick, 30000);
  setInterval(() => { if (!document.hidden) syncServer(); }, 120000);
  tick(); render(); syncServer();
  window.__app = { get S() { return S; }, ask, handleFile, render, tick, mk, setView: v => { view = v; render(); } }; // utile pour les tests
})();
