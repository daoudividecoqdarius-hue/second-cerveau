// Second Cerveau : widget (app gratuite « Scriptable »). Colle ce script UNE fois : le dessin du widget
// est téléchargé à chaque fois, donc les améliorations arrivent sans rien recoller.
// Ce widget lit seulement un résumé de tes tâches (lecture seule). Le jeton ci-dessous ne sert qu'à ça.
const URL_ = "__URL__";
const TOKEN = "__TOKEN__";
const CODE = "https://daoudividecoqdarius-hue.github.io/second-cerveau/widget.core.js";

// 1) le résumé de la journée
let d = null;
try {
  const r = new Request(URL_);
  r.headers = { Authorization: "Bearer " + TOKEN };
  d = await r.loadJSON();
} catch (e) { d = null; }

// 2) le dessin (dernière version, sinon la copie gardée sur le téléphone)
const fm = FileManager.local();
const copie = fm.joinPath(fm.cacheDirectory(), "assistant-widget-core.js");
let code = null;
try {
  code = await new Request(CODE + "?t=" + Date.now()).loadString();
  if (code && code.length > 200) fm.writeString(copie, code); else code = null;
} catch (e) { code = null; }
if (!code && fm.fileExists(copie)) code = fm.readString(copie);

let w;
if (code) {
  const dessiner = eval(code);
  w = await dessiner(d);
} else {
  w = new ListWidget();
  w.addText("Widget : connexion impossible");
}

if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  await w.presentMedium();
}
Script.complete();
