// Second Cerveau : widget pour l'écran verrouillé et l'écran d'accueil (app gratuite « Scriptable »)
// Matin et journée : tes tâches et événements d'aujourd'hui. Soir (après 18 h) : ceux de demain.
// Le widget lit seulement un résumé (lecture seule). Le jeton ci-dessous ne sert qu'à ça.
const URL_ = "__URL__";
const TOKEN = "__TOKEN__";

async function charger() {
  const r = new Request(URL_);
  r.headers = { Authorization: "Bearer " + TOKEN };
  return await r.loadJSON();
}

let d = null;
try { d = await charger(); } catch (e) { d = null; }

const famille = config.widgetFamily || "medium";
const verrou = famille.indexOf("accessory") === 0;
const w = new ListWidget();
w.backgroundColor = new Color("#1c1c1e");
w.setPadding(verrou ? 0 : 12, verrou ? 0 : 14, verrou ? 0 : 12, verrou ? 0 : 14);

function ligne(texte, taille, couleur, gras) {
  const t = w.addText(texte);
  t.font = gras ? Font.boldSystemFont(taille) : Font.systemFont(taille);
  t.textColor = new Color(couleur || "#ffffff");
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

if (!d || !d.ok) {
  ligne("Assistant indisponible", 12, "#ff453a", true);
} else {
  const soir = d.periode === "soir";
  const liste = soir ? d.demain : d.aujourdhui;
  const titre = soir ? "Demain" : "Aujourd'hui";
  const max = famille === "accessoryInline" ? 1 : verrou ? 3 : famille === "small" ? 4 : 7;

  if (famille === "accessoryInline") {
    ligne(liste.length ? (liste[0].h ? liste[0].h + " " : "") + liste[0].t : "Rien de prévu", 12);
  } else {
    ligne(titre + " · " + liste.length, verrou ? 12 : 14, "#0a84ff", true);
    if (!liste.length) ligne("Rien de prévu 🎉", verrou ? 12 : 14, "#98989f");
    liste.slice(0, max).forEach(function (x) {
      const couleur = x.r ? "#ff453a" : x.k === "ev" ? "#bf5af2" : "#ffffff";
      ligne((x.h ? x.h + "  " : "") + x.t, verrou ? 12 : 14, couleur);
    });
    if (!verrou && d.frigo && d.frigo.length) {
      w.addSpacer(4);
      ligne("🧊 " + d.frigo.slice(0, 3).map(function (f) { return f.t + (f.jours <= 0 ? " (!)" : ""); }).join(", "), 12, "#ff9f0a");
    }
  }
}

w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  await w.presentMedium();
}
Script.complete();
