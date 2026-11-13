(async function (d) {
  // Second Cerveau : dessin du widget (téléchargé à chaque exécution : les améliorations arrivent toutes seules)
  // Astuce : dans les réglages du widget (champ « Paramètre »), écris  grand  pour des lignes plus grosses (moins de lignes).
  const fam = config.widgetFamily || "medium";
  const lock = fam.indexOf("accessory") === 0;
  const grand = String(args.widgetParameter || "").toLowerCase().indexOf("grand") >= 0;

  function F(taille, gras) {
    try { return gras ? Font.boldRoundedSystemFont(taille) : Font.mediumRoundedSystemFont(taille); }
    catch (e) { return gras ? Font.boldSystemFont(taille) : Font.systemFont(taille); }
  }

  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (!d || !d.ok) {
    const t = w.addText("Assistant indisponible");
    t.font = F(13, true);
    return w;
  }

  const soir = d.periode === "soir";
  const liste = soir ? d.demain : d.aujourdhui;
  const titre = soir ? "Demain" : "Aujourd'hui";

  // ---- Petits widgets de l'écran verrouillé ----
  if (fam === "accessoryInline") {
    const x = liste[0];
    w.addText(x ? (x.h ? x.h + " " : "") + x.t : titre + " : rien de prévu");
    return w;
  }
  if (fam === "accessoryCircular") {
    const n = w.addText(String(liste.length));
    n.font = F(26, true);
    n.centerAlignText();
    const l = w.addText(soir ? "demain" : "du jour");
    l.font = F(10, false);
    l.centerAlignText();
    return w;
  }
  if (lock) {                                           // rectangle : le plus grand format de l'écran verrouillé
    w.setPadding(0, 0, 0, 0);
    const max = grand ? 2 : 3, taille = grand ? 16 : 14;
    const h = w.addText(titre + " · " + liste.length);
    h.font = F(grand ? 14 : 13, true);
    h.lineLimit = 1;
    if (!liste.length) {
      const r = w.addText("Rien de prévu");
      r.font = F(taille, false);
    }
    liste.slice(0, max).forEach(function (x) {
      const ligne = w.addText((x.r ? "! " : "") + (x.h ? x.h + "  " : "") + x.t);
      ligne.font = F(taille, false);
      ligne.lineLimit = 1;
      ligne.minimumScaleFactor = 0.75;
    });
    return w;
  }

  // ---- Écran d'accueil : petit / moyen / grand ----
  const g = new LinearGradient();
  g.colors = [new Color("#26324f"), new Color("#0d1020")];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 16, 12, 16);

  const jour = new Date(d.date + "T12:00:00");
  if (soir) jour.setDate(jour.getDate() + 1);
  const df = new DateFormatter();
  df.locale = "fr_FR";
  df.dateFormat = "EEEE d MMM";
  const quand = df.string(jour);

  const tete = w.addStack();
  tete.centerAlignContent();
  const gauche = tete.addStack();
  gauche.layoutVertically();
  const t1 = gauche.addText(titre);
  t1.font = F(fam === "small" ? 17 : 21, true);
  t1.textColor = Color.white();
  const t2 = gauche.addText(quand.charAt(0).toUpperCase() + quand.slice(1));
  t2.font = F(12, false);
  t2.textColor = new Color("#9db4e6");
  tete.addSpacer();
  const badge = tete.addStack();
  badge.backgroundColor = new Color("#0a84ff");
  badge.cornerRadius = 12;
  badge.setPadding(3, 10, 3, 10);
  const bn = badge.addText(String(liste.length));
  bn.font = F(15, true);
  bn.textColor = Color.white();
  w.addSpacer(8);

  const max = fam === "small" ? (grand ? 2 : 3) : fam === "large" ? (grand ? 7 : 10) : (grand ? 3 : 4);
  const taille = grand ? 17 : (fam === "small" ? 13 : 15);
  if (!liste.length) {
    const r = w.addText("Rien de prévu 🎉");
    r.font = F(taille, false);
    r.textColor = new Color("#9db4e6");
  }
  liste.slice(0, max).forEach(function (x) {
    const l = w.addStack();
    l.centerAlignContent();
    if (fam !== "small") {
      const hs = l.addStack();
      hs.size = new Size(grand ? 52 : 46, 0);
      const ht = hs.addText(x.h || "·");
      ht.font = F(taille - 1, true);
      ht.textColor = x.r ? new Color("#ff6961") : new Color("#7fb2ff");
      ht.lineLimit = 1;
    }
    const tt = l.addText((fam === "small" && x.h ? x.h + " " : "") + x.t);
    tt.font = F(taille, false);
    tt.textColor = x.r ? new Color("#ff9a94") : x.k === "ev" ? new Color("#d9b8ff") : Color.white();
    tt.lineLimit = 1;
    tt.minimumScaleFactor = 0.8;
    w.addSpacer(grand ? 5 : 3);
  });
  if (liste.length > max) {
    const p = w.addText("+ " + (liste.length - max) + " autres");
    p.font = F(11, false);
    p.textColor = new Color("#9db4e6");
  }
  w.addSpacer();
  if (fam !== "small" && d.frigo && d.frigo.length) {
    const f = w.addText("🧊 " + d.frigo.slice(0, 3).map(function (x) { return x.t + (x.jours <= 0 ? " !" : ""); }).join(" · "));
    f.font = F(12, true);
    f.textColor = new Color("#ffb454");
    f.lineLimit = 1;
  }
  return w;
})
