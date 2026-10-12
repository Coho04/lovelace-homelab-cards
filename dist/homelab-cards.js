/*
 * Homelab Cards — Sammlung eigener Lovelace-Karten
 * https://github.com/Coho04/lovelace-homelab-cards
 *
 * Dieses Bundle definiert alle Karten der Sammlung. Weitere Karten kommen hier dazu,
 * ohne dass in Home Assistant eine zweite Ressource eingetragen werden muss.
 *
 * Enthalten:
 *   - entities-background-card  (+ visueller Editor)
 *
 * ---------------------------------------------------------------------------
 * entities-background-card
 *
 * Eine Entities-Karte mit Ueberschrift und Footer. Der Footer kann ein Bild zeigen,
 * einen Graphen, oder beides. Ist der Graph aktiv, bekommt jede Zeile eine Farbe und
 * ihr Verlauf wird als Flaeche im Hintergrund gezeichnet — entweder hinter jeder Zeile
 * einzeln, als Band am Kartenfuss, oder hinter der ganzen Karte.
 *
 * Damit ersetzt sie "footer: {type: graph}" der eingebauten entities-Karte, die
 * konstruktiv nur eine einzige Entitaet zeichnen kann.
 *
 *   type: custom:entities-background-card
 *   title: Temperaturen            # optional
 *   hours: 24                      # Zeitraum des Verlaufs
 *   footer:
 *     graph: card                  # card | rows | inline | full | none
 *     height: 100                  # Hoehe des Graphbands, nur bei graph: card
 *     spark_width: 60              # Breite des Zeilen-Graphen, nur bei graph: inline
 *     spark_height: 24             # Hoehe des Zeilen-Graphen, nur bei graph: inline
 *     image: /local/bild.jpg       # optional, auch zusammen mit graph
 *     image_height: 120            # optional, sonst Originalverhaeltnis
 *   entities:
 *     - entity: sensor.xyz
 *       name: Temperatur           # optional
 *       secondary_info: area_name  # optional
 *       color: '#ff7043'           # optional, sonst aus der Palette
 *
 *   color_targets: [icon, name]    # was die Farbe einfaerbt: icon | name | dot
 *
 * Feinschliff: fill_opacity (0.13), line_opacity (0.55), line_width (2),
 * buckets (48 Punkte je Linie), scale (unit | each), refresh (Minuten).
 */

const VERSION = "1.3.0";

const PALETTE = [
  "#ff7043", "#29b6f6", "#90a4ae", "#ef5350",
  "#ffa726", "#26a69a", "#7e57c2", "#66bb6a",
  "#ec407a", "#8d6e63", "#5c6bc0", "#9ccc65",
];

const W = 1000;          // SVG-Koordinatenraum, per preserveAspectRatio gedehnt
const H = 300;
const GRAPH_MODI = ["card", "rows", "inline", "full", "none"];
const FARB_ZIELE = ["icon", "name", "dot"];

const STANDARD = {
  hours: 24,
  refresh: 5,
  buckets: 48,
  fill_opacity: 0.13,
  line_opacity: 0.55,
  line_width: 2,
  scale: "unit",
  color_targets: ["icon", "name"],
};

/** Laedt die Formularelemente des HA-Frontends nach, falls noch keine Karte sie gezogen hat. */
async function ladeHaFormularElemente() {
  if (customElements.get("ha-entity-picker") && customElements.get("ha-form")) return;
  try {
    const helpers = await window.loadCardHelpers();
    const karte = await helpers.createCardElement({ type: "entities", entities: [] });
    if (karte && karte.constructor.getConfigElement) {
      await karte.constructor.getConfigElement();
    }
  } catch (err) {
    console.warn("entities-background-card: HA-Formularelemente nicht ladbar", err);
  }
}

/* =========================================================================
 * Karte
 * ========================================================================= */

class EntitiesBackgroundCard extends HTMLElement {
  constructor() {
    super();
    this._verlauf = null;
    this._geholt = 0;
    this._laeuft = false;
    this._aufgebaut = false;
    this._signatur = "";
  }

  static async getConfigElement() {
    await ladeHaFormularElemente();
    return document.createElement("entities-background-card-editor");
  }

  static getStubConfig(hass, entities, entitiesFallback) {
    const auswahl = (entities || []).filter((id) => id.startsWith("sensor."));
    const liste = (auswahl.length ? auswahl : entitiesFallback || []).slice(0, 3);
    return {
      title: "Verläufe",
      hours: 24,
      footer: { graph: "card", height: 100 },
      entities: liste.map((id, i) => ({ entity: id, color: PALETTE[i % PALETTE.length] })),
    };
  }

  /* ---------- Konfiguration ---------- */

  setConfig(config) {
    if (!config || !Array.isArray(config.entities)) {
      throw new Error("'entities' fehlt oder ist keine Liste.");
    }

    const footer = config.footer || {};
    const graph = footer.graph === undefined ? "none" : String(footer.graph);
    if (!GRAPH_MODI.includes(graph)) {
      throw new Error(`footer.graph muss eines von ${GRAPH_MODI.join(", ")} sein.`);
    }

    // Einfaerbungsziele: Einzelwert wie Liste akzeptieren, Unbekanntes verwerfen.
    const zieleRoh = config.color_targets === undefined
      ? STANDARD.color_targets
      : [].concat(config.color_targets);
    const ziele = zieleRoh.filter((z) => FARB_ZIELE.includes(z));
    const unbekannt = zieleRoh.filter((z) => !FARB_ZIELE.includes(z));
    if (unbekannt.length) {
      throw new Error(
        `color_targets kennt nur ${FARB_ZIELE.join(", ")} — unbekannt: ${unbekannt.join(", ")}`
      );
    }

    this._config = {
      ...STANDARD,
      ...config,
      color_targets: ziele,
      footer: { height: 100, spark_width: 60, spark_height: 24, ...footer, graph },
      entities: config.entities.map((e, i) => {
        const roh = typeof e === "string" ? { entity: e } : e;
        if (!roh.entity) throw new Error("Jeder Eintrag braucht ein 'entity'.");
        // Farbe nur vergeben, wenn ein Graph sie auch erklaert.
        const farbe = roh.color || (graph === "none" ? null : PALETTE[i % PALETTE.length]);
        return { ...roh, color: farbe };
      }),
    };

    this._verlauf = null;
    this._geholt = 0;
    if (this._aufgebaut) this._neuAufbauen();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._aufgebaut) this._baueGeruest();
    this._zeichne();
    if (this._config.footer.graph !== "none") this._holeVerlaufWennNoetig();
  }

  getCardSize() {
    const c = this._config;
    let groesse = c.title ? 1 : 0;
    groesse += Math.ceil(c.entities.length * 0.75);
    if (c.footer.graph === "card") groesse += Math.ceil(c.footer.height / 50);
    if (c.footer.image) groesse += 2;
    return Math.max(1, groesse);
  }

  /* ---------- Geruest ---------- */

  _baueGeruest() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { position: relative; overflow: hidden; }
        .hintergrund { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
        .hintergrund svg, .band svg, .zeile-graph svg {
          width: 100%; height: 100%; display: block;
        }
        .inhalt { position: relative; z-index: 1; }
        .titel {
          font-size: var(--ha-card-header-font-size, 24px);
          font-weight: var(--ha-card-header-font-weight, 400);
          color: var(--ha-card-header-color, var(--primary-text-color));
          padding: 12px 16px 8px;
          letter-spacing: -0.012em;
          line-height: 1.2;
        }
        .zeilen { padding: 0 16px 12px; }
        .leer { padding: 16px; color: var(--secondary-text-color); font-size: 14px; }
        .zeile {
          position: relative; display: flex; align-items: center;
          min-height: 40px; cursor: pointer;
        }
        .zeile-graph {
          position: absolute; left: -16px; right: -16px; top: 0; bottom: 0;
          z-index: 0; pointer-events: none;
        }
        .zeile-inhalt {
          position: relative; z-index: 1;
          display: flex; align-items: center; width: 100%;
        }
        .zeile ha-icon { flex: 0 0 40px; }
        .text { flex: 1 1 auto; min-width: 0; margin-left: 8px; }
        .name {
          font-size: 14px; line-height: 1.3;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .zusatz { font-size: 12px; line-height: 1.3; color: var(--secondary-text-color); }
        .punkt {
          flex: 0 0 auto; width: 8px; height: 8px;
          border-radius: 50%; margin-left: 8px;
        }
        .spark { flex: 0 0 auto; margin-left: 8px; }
        .spark svg { width: 100%; height: 100%; display: block; }
        .wert {
          flex: 0 0 auto; margin-left: 8px; text-align: right;
          font-size: 14px; color: var(--primary-text-color); white-space: nowrap;
        }
        .band { position: relative; width: 100%; }
        .bild { display: block; width: 100%; }
      </style>
      <ha-card>
        <div class="hintergrund"></div>
        <div class="inhalt">
          <div class="titel"></div>
          <div class="zeilen"></div>
          <div class="band"></div>
          <div class="bildbereich"></div>
        </div>
      </ha-card>
    `;
    this._elHintergrund = this.shadowRoot.querySelector(".hintergrund");
    this._elTitel = this.shadowRoot.querySelector(".titel");
    this._elZeilen = this.shadowRoot.querySelector(".zeilen");
    this._elBand = this.shadowRoot.querySelector(".band");
    this._elBild = this.shadowRoot.querySelector(".bildbereich");
    this._aufgebaut = true;
  }

  _neuAufbauen() {
    this._signatur = "";
    this._elZeilen.innerHTML = "";
    this._elHintergrund.innerHTML = "";
    this._elBand.innerHTML = "";
    this._elBild.innerHTML = "";
    this._zeichne();
  }

  /* ---------- Darstellung ---------- */

  _zeichne() {
    const cfg = this._config;
    if (!this._hass) return;

    this._elTitel.textContent = cfg.title || "";
    this._elTitel.style.display = cfg.title ? "" : "none";

    if (cfg.entities.length === 0) {
      this._elZeilen.innerHTML = '<div class="leer">Noch keine Entität ausgewählt.</div>';
      this._signatur = "";
    } else {
      // Zeilen nur dann neu bauen, wenn sich die Zusammensetzung wirklich geaendert hat.
      const signatur = cfg.color_targets.join(",") + "::" +
        cfg.entities.map((e) => `${e.entity}|${e.name || ""}|${e.color || ""}`).join(";");
      if (signatur !== this._signatur) {
        this._elZeilen.innerHTML = "";
        cfg.entities.forEach((e) => this._elZeilen.appendChild(this._baueZeile(e)));
        this._signatur = signatur;
      }
      cfg.entities.forEach((e, i) => this._aktualisiereZeile(this._elZeilen.children[i], e));
    }

    this._zeichneBild();
    this._zeichneGraph();
  }

  _baueZeile(e) {
    const st = this._hass.states[e.entity];

    const zeile = document.createElement("div");
    zeile.className = "zeile";

    const graph = document.createElement("div");
    graph.className = "zeile-graph";
    zeile.appendChild(graph);

    const inhalt = document.createElement("div");
    inhalt.className = "zeile-inhalt";

    const ziele = this._config.color_targets;

    const icon = document.createElement("ha-icon");
    icon.icon = e.icon || (st && st.attributes.icon) || this._standardIcon(st);
    if (e.color && ziele.includes("icon")) icon.style.color = e.color;
    inhalt.appendChild(icon);

    const text = document.createElement("div");
    text.className = "text";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = e.name || (st ? st.attributes.friendly_name : e.entity);
    if (e.color && ziele.includes("name")) name.style.color = e.color;
    const zusatz = document.createElement("div");
    zusatz.className = "zusatz";
    text.appendChild(name);
    text.appendChild(zusatz);
    inhalt.appendChild(text);

    // Platz fuer den Zeilen-Graphen — zwischen Name und Wert, wie gewuenscht.
    if (this._config.footer.graph === "inline") {
      const spark = document.createElement("div");
      spark.className = "spark";
      spark.style.width = `${this._config.footer.spark_width}px`;
      spark.style.height = `${this._config.footer.spark_height}px`;
      inhalt.appendChild(spark);
    }

    if (e.color && ziele.includes("dot")) {
      const punkt = document.createElement("span");
      punkt.className = "punkt";
      punkt.style.background = e.color;
      inhalt.appendChild(punkt);
    }

    const wert = document.createElement("div");
    wert.className = "wert";
    inhalt.appendChild(wert);

    zeile.appendChild(inhalt);

    zeile.addEventListener("click", () => {
      const ev = new Event("hass-more-info", { bubbles: true, composed: true });
      ev.detail = { entityId: e.entity };
      this.dispatchEvent(ev);
    });

    return zeile;
  }

  _aktualisiereZeile(zeile, e) {
    if (!zeile) return;
    const st = this._hass.states[e.entity];
    const wert = zeile.querySelector(".wert");
    const zusatz = zeile.querySelector(".zusatz");

    if (!st) {
      wert.textContent = "—";
      wert.title = "Entität nicht gefunden";
      return;
    }
    const einheit = st.attributes.unit_of_measurement || "";
    wert.textContent = `${this._formatiere(st.state)}${einheit ? " " + einheit : ""}`;

    if (e.secondary_info === "area_name") {
      zusatz.textContent = this._bereich(e.entity);
      zusatz.style.display = zusatz.textContent ? "" : "none";
    } else if (e.secondary_info === "last-changed") {
      zusatz.textContent = new Date(st.last_changed).toLocaleString();
      zusatz.style.display = "";
    } else {
      zusatz.style.display = "none";
    }
  }

  _zeichneBild() {
    const bild = this._config.footer.image;
    if (!bild) {
      this._elBild.innerHTML = "";
      return;
    }
    let img = this._elBild.querySelector("img");
    if (!img) {
      this._elBild.innerHTML = "";
      img = document.createElement("img");
      img.className = "bild";
      this._elBild.appendChild(img);
    }
    if (img.getAttribute("src") !== bild) img.setAttribute("src", bild);
    const h = this._config.footer.image_height;
    img.style.height = h ? `${h}px` : "";
    img.style.objectFit = h ? "cover" : "";
  }

  _standardIcon(st) {
    const kl = st && st.attributes.device_class;
    if (kl === "temperature") return "mdi:thermometer";
    if (kl === "humidity") return "mdi:water-percent";
    if (kl === "pressure" || kl === "atmospheric_pressure") return "mdi:gauge";
    if (kl === "battery") return "mdi:battery";
    if (kl === "power" || kl === "energy") return "mdi:flash";
    return "mdi:chart-line";
  }

  _formatiere(wert) {
    const z = Number(wert);
    if (!Number.isFinite(z)) return wert;
    const sprache = this._hass.locale ? this._hass.locale.language : "de";
    return z.toLocaleString(sprache, { maximumFractionDigits: 1 });
  }

  _bereich(entity_id) {
    const hass = this._hass;
    if (!hass.entities || !hass.areas) return "";
    const e = hass.entities[entity_id];
    if (!e) return "";
    let area_id = e.area_id;
    if (!area_id && e.device_id && hass.devices) {
      const d = hass.devices[e.device_id];
      area_id = d && d.area_id;
    }
    const a = area_id && hass.areas[area_id];
    return a ? a.name : "";
  }

  /* ---------- Verlauf ---------- */

  async _holeVerlaufWennNoetig() {
    if (this._laeuft || this._config.entities.length === 0) return;
    if (Date.now() - this._geholt < this._config.refresh * 60000) return;
    this._laeuft = true;
    try {
      const ende = new Date();
      const start = new Date(ende.getTime() - this._config.hours * 3600000);
      const antwort = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: ende.toISOString(),
        entity_ids: this._config.entities.map((e) => e.entity),
        minimal_response: true,
        no_attributes: true,
      });
      this._verlauf = { start: start.getTime(), ende: ende.getTime(), daten: antwort || {} };
      this._geholt = Date.now();
      this._zeichneGraph();
    } catch (err) {
      // Ohne Verlauf bleibt die Liste nutzbar — daran darf die Karte nicht sterben.
      console.warn("entities-background-card: Verlauf nicht abrufbar", err);
      this._geholt = Date.now();
    } finally {
      this._laeuft = false;
    }
  }

  /** Rohpunkte auf feste Zeitfenster mitteln, damit die Linie ruhig bleibt. */
  _verdichte(punkte, start, ende, anzahl) {
    const breite = (ende - start) / anzahl;
    const summe = new Array(anzahl).fill(0);
    const zahl = new Array(anzahl).fill(0);
    punkte.forEach((p) => {
      const t = (p.lu || p.last_updated_ts || 0) * 1000;
      const v = Number(p.s !== undefined ? p.s : p.state);
      if (!Number.isFinite(v) || t < start || t > ende) return;
      const i = Math.min(anzahl - 1, Math.floor((t - start) / breite));
      summe[i] += v;
      zahl[i] += 1;
    });
    const raus = [];
    let letzter = null;
    for (let i = 0; i < anzahl; i++) {
      if (zahl[i] > 0) letzter = summe[i] / zahl[i];
      if (letzter !== null) raus.push({ x: i / (anzahl - 1), v: letzter });
    }
    return raus;
  }

  _reihen() {
    const cfg = this._config;
    const { start, ende, daten } = this._verlauf;
    return cfg.entities.map((e) => {
      const st = this._hass.states[e.entity];
      return {
        farbe: e.color || "var(--primary-color)",
        einheit: (st && st.attributes.unit_of_measurement) || "",
        punkte: this._verdichte(daten[e.entity] || [], start, ende, cfg.buckets),
      };
    });
  }

  _zeichneGraph() {
    const cfg = this._config;
    const modus = cfg.footer.graph;

    this._elHintergrund.innerHTML = "";
    this._elBand.innerHTML = "";
    this._elBand.style.height = "";
    Array.from(this._elZeilen.children).forEach((z) => {
      const g = z.querySelector(".zeile-graph");
      if (g) g.innerHTML = "";
      const s = z.querySelector(".spark");
      if (s) s.innerHTML = "";
    });

    if (modus === "none" || !this._verlauf) return;
    const reihen = this._reihen();

    if (modus === "inline") {
      // Kleiner Verlauf in der Zeile, jeder mit eigener Skala.
      reihen.forEach((r, i) => {
        const zeile = this._elZeilen.children[i];
        if (!zeile) return;
        const ziel = zeile.querySelector(".spark");
        if (!ziel || r.punkte.length < 2) return;
        ziel.innerHTML = this._svg([this._pfad(r, this._skala([r]))], `s${i}`);
      });
      return;
    }

    if (modus === "rows") {
      // Jede Zeile bekommt ihren eigenen Verlauf hinter sich, mit eigener Skala.
      reihen.forEach((r, i) => {
        const zeile = this._elZeilen.children[i];
        if (!zeile || r.punkte.length < 2) return;
        const ziel = zeile.querySelector(".zeile-graph");
        if (ziel) ziel.innerHTML = this._svg([this._pfad(r, this._skala([r]))], `r${i}`);
      });
      return;
    }

    const brauchbar = reihen.filter((r) => r.punkte.length >= 2);
    if (brauchbar.length === 0) return;

    // Skalen gruppieren: gemeinsam je Einheit oder je Linie einzeln.
    const gruppen = new Map();
    brauchbar.forEach((r, i) => {
      const schluessel = cfg.scale === "each" ? `#${i}` : r.einheit;
      if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
      gruppen.get(schluessel).push(r);
    });
    const pfade = [];
    gruppen.forEach((gruppe) => {
      const s = this._skala(gruppe);
      gruppe.forEach((r) => pfade.push(this._pfad(r, s)));
    });

    const svg = this._svg(pfade, "c");
    if (modus === "full") {
      this._elHintergrund.innerHTML = svg;
    } else {
      this._elBand.style.height = `${cfg.footer.height}px`;
      this._elBand.innerHTML = svg;
    }
  }

  _skala(reihen) {
    let min = Infinity, max = -Infinity;
    reihen.forEach((r) => r.punkte.forEach((p) => {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }));
    return { min, max };
  }

  _pfad(reihe, skala) {
    const rand = 8; // damit Extremwerte nicht am Rand kleben
    const spanne = skala.max - skala.min;
    const xy = reihe.punkte.map((p) => {
      const y = spanne === 0
        ? H / 2
        : H - rand - ((p.v - skala.min) / spanne) * (H - 2 * rand);
      return [p.x * W, y];
    });
    return { farbe: reihe.farbe, d: this._glatt(xy) };
  }

  _svg(pfade, praefix) {
    const cfg = this._config;
    return [
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`,
      "<defs>",
      ...pfade.map((p, i) =>
        `<linearGradient id="ebg-${praefix}-${i}" x1="0" x2="0" y1="0" y2="1">` +
        `<stop offset="0%" stop-color="${p.farbe}" stop-opacity="${cfg.fill_opacity}"/>` +
        `<stop offset="100%" stop-color="${p.farbe}" stop-opacity="0"/>` +
        "</linearGradient>"
      ),
      "</defs>",
      ...pfade.map((p, i) => `<path d="${p.d} L ${W} ${H} L 0 ${H} Z" fill="url(#ebg-${praefix}-${i})"/>`),
      ...pfade.map((p) =>
        `<path d="${p.d}" fill="none" stroke="${p.farbe}" stroke-opacity="${cfg.line_opacity}" ` +
        `stroke-width="${cfg.line_width}" stroke-linecap="round" stroke-linejoin="round" ` +
        `vector-effect="non-scaling-stroke"/>`
      ),
      "</svg>",
    ].join("");
  }

  /** Quadratische Glaettung ueber die Mittelpunkte — ruhige Kurve ohne Ausreisser. */
  _glatt(punkte) {
    if (punkte.length < 3) {
      return punkte.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
    }
    const t = [`M ${punkte[0][0]} ${punkte[0][1]}`];
    for (let i = 1; i < punkte.length - 1; i++) {
      const mx = (punkte[i][0] + punkte[i + 1][0]) / 2;
      const my = (punkte[i][1] + punkte[i + 1][1]) / 2;
      t.push(`Q ${punkte[i][0]} ${punkte[i][1]} ${mx} ${my}`);
    }
    const l = punkte[punkte.length - 1];
    t.push(`L ${l[0]} ${l[1]}`);
    return t.join(" ");
  }
}

/* =========================================================================
 * Visueller Editor
 * ========================================================================= */

const ZUSATZ_OPTIONEN = [
  { value: "", label: "keine" },
  { value: "area_name", label: "Bereich" },
  { value: "last-changed", label: "Zuletzt geändert" },
];

const BESCHRIFTUNG = {
  title: "Überschrift",
  hours: "Zeitraum",
  graph: "Graph",
  height: "Höhe des Graphbands",
  spark_width: "Breite des Zeilen-Graphen",
  spark_height: "Höhe des Zeilen-Graphen",
  image: "Bild im Footer",
  image_height: "Bildhöhe",
  color_targets: "Was wird eingefärbt",
  scale: "Skalierung",
  fill_opacity: "Deckkraft der Fläche",
  line_opacity: "Deckkraft der Linie",
  line_width: "Linienstärke",
  buckets: "Punkte je Linie",
  refresh: "Aktualisierung",
};

class EntitiesBackgroundCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._aufgebaut = false;
    this._zeilen = [];           // { id, element, picker, nameFeld, auswahl, farbe, hoch, runter }
    this._signatur = null;       // Zusammensetzung der Liste
    this._schemaSignatur = null; // Eingaben, von denen das ha-form-Schema abhaengt
    this._eigeneMeldung = null;  // JSON der zuletzt selbst gemeldeten Konfiguration
    this._naechsteId = 1;
  }

  setConfig(config) {
    const normalisiert = this._normalisiere(config);
    // Home Assistant spiegelt jede eigene Meldung sofort zurueck. Wuerde die einen
    // Neuaufbau ausloesen, verlaere jeder Tastendruck den Fokus.
    const eigenerRuecklauf =
      this._eigeneMeldung && JSON.stringify(normalisiert) === this._eigeneMeldung;
    this._eigeneMeldung = null;
    this._config = normalisiert;
    if (eigenerRuecklauf) return;
    this._aktualisiere();
  }

  set hass(hass) {
    const erstmals = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    // hass wechselt bei jeder Zustandsaenderung im Haus, also mehrmals pro Sekunde.
    // Hier darf nichts neu gebaut werden - nur durchreichen.
    if (erstmals) this._aktualisiere();
    else this._reicheHassDurch();
  }

  _normalisiere(config) {
    return {
      ...config,
      footer: { ...((config && config.footer) || {}) },
      entities: ((config && config.entities) || []).map((e) =>
        typeof e === "string" ? { entity: e } : { ...e }
      ),
    };
  }

  /* ---------- Geruest ---------- */

  _baueGeruest() {
    this.shadowRoot.innerHTML = `
      <style>
        .wrap { display: flex; flex-direction: column; gap: 16px; }
        .abschnitt {
          font-weight: 500; font-size: 15px;
          color: var(--primary-text-color);
          margin-bottom: -8px;
        }
        .hinweis { font-size: 12px; color: var(--secondary-text-color); margin-top: -8px; }
        .eintrag {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          padding: 8px 8px 12px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .kopf { display: flex; align-items: center; gap: 4px; }
        .kopf ha-entity-picker, .kopf .ersatz { flex: 1 1 auto; }
        .detail { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .detail ha-textfield, .detail .ersatz { flex: 1 1 140px; }
        .farbe { display: flex; align-items: center; gap: 4px; }
        .farbe label { font-size: 12px; color: var(--secondary-text-color); }
        input[type="color"] {
          width: 36px; height: 32px; padding: 0; border: none;
          background: none; cursor: pointer;
        }
        select, .ersatz {
          font: inherit; font-size: 14px; padding: 8px;
          color: var(--primary-text-color);
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color);
          border-radius: 4px;
        }
        .feldlabel { font-size: 12px; color: var(--secondary-text-color); display: block; }
        .knopf {
          background: none; border: none; cursor: pointer;
          color: var(--secondary-text-color); font-size: 18px;
          width: 32px; height: 32px; border-radius: 50%;
        }
        .knopf:hover { background: var(--divider-color); }
        .knopf[disabled] { opacity: 0.3; cursor: default; }
        .hinzu { display: flex; flex-direction: column; gap: 4px; }
      </style>
      <div class="wrap">
        <ha-form class="allgemein"></ha-form>
        <div class="abschnitt">Entitäten</div>
        <div class="hinweis"></div>
        <div class="liste"></div>
        <div class="hinzu">
          <span class="feldlabel">Entität hinzufügen</span>
          <div class="hinzu-ziel"></div>
        </div>
      </div>
    `;
    this._elForm = this.shadowRoot.querySelector(".allgemein");
    this._elHinweis = this.shadowRoot.querySelector(".hinweis");
    this._elListe = this.shadowRoot.querySelector(".liste");
    this._elHinzu = this.shadowRoot.querySelector(".hinzu-ziel");

    this._elForm.computeLabel = (schema) => BESCHRIFTUNG[schema.name] || schema.name;
    this._elForm.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._ausFormular(ev.detail.value);
    });

    // Der Hinzufuegen-Waehler wird einmal gebaut und danach nur geleert.
    this._hinzuPicker = this._entitaetsWaehler("", (wert) => {
      if (!wert) return;
      const entities = [...this._config.entities, {
        entity: wert,
        color: PALETTE[this._config.entities.length % PALETTE.length],
      }];
      this._setzeWaehlerWert(this._hinzuPicker, "");
      this._melde({ ...this._config, entities });
    });
    this._elHinzu.appendChild(this._hinzuPicker);

    this._aufgebaut = true;
  }

  /* ---------- Aktualisieren ---------- */

  _aktualisiere() {
    if (!this._config || !this._hass) return;
    if (!this._aufgebaut) this._baueGeruest();

    this._aktualisiereFormular();

    const mitGraph = (this._config.footer.graph || "none") !== "none";
    this._elHinweis.textContent = mitGraph
      ? "Jede Zeile trägt die Farbe ihrer Linie — deshalb braucht die Karte keine Legende."
      : "Ohne Graph bleiben die Zeilen im Theme-Stil; eine Farbe würde dort nichts erklären.";

    // Nur neu bauen, wenn sich Zusammensetzung oder Reihenfolge geaendert haben.
    const signatur = this._config.entities.map((e) => e.entity).join(";");
    if (signatur !== this._signatur) {
      this._baueListe();
      this._signatur = signatur;
    } else {
      this._aktualisiereListe();
    }
  }

  _aktualisiereFormular() {
    const f = this._config.footer;
    // Ein neues Schema-Array laesst ha-form alle Felder neu rendern. Also nur dann,
    // wenn sich tatsaechlich etwas an den Eingaben des Schemas geaendert hat.
    const signatur = `${f.graph || "none"}|${f.image ? 1 : 0}`;
    if (signatur !== this._schemaSignatur) {
      this._elForm.schema = this._schema();
      this._schemaSignatur = signatur;
    }
    this._elForm.hass = this._hass;
    this._elForm.data = this._formularDaten();
  }

  _reicheHassDurch() {
    if (this._elForm) this._elForm.hass = this._hass;
    this._zeilen.forEach((z) => {
      if (z.picker && "hass" in z.picker) z.picker.hass = this._hass;
    });
    if (this._hinzuPicker && "hass" in this._hinzuPicker) this._hinzuPicker.hass = this._hass;
  }

  /* ---------- Entitaetsliste ---------- */

  _baueListe() {
    this._elListe.innerHTML = "";
    this._zeilen = [];
    this._config.entities.forEach((e, i) => {
      const zeile = this._baueEintrag(e, this._naechsteId++, i);
      this._zeilen.push(zeile);
      this._elListe.appendChild(zeile.element);
    });
    this._aktualisiereKnoepfe();
  }

  /** Werte in vorhandene Felder schreiben, ohne das gerade benutzte anzufassen. */
  _aktualisiereListe() {
    this._zeilen.forEach((z, i) => {
      const e = this._config.entities[i];
      if (!e) return;
      if (z.picker && !this._hatFokus(z.picker)) this._setzeWaehlerWert(z.picker, e.entity);
      if (z.nameFeld && !this._hatFokus(z.nameFeld)) z.nameFeld.value = e.name || "";
      if (z.auswahl && !this._hatFokus(z.auswahl)) z.auswahl.value = e.secondary_info || "";
      if (z.farbe && !this._hatFokus(z.farbe)) {
        z.farbe.value = this._alsHex(e.color, PALETTE[i % PALETTE.length]);
      }
    });
    this._aktualisiereKnoepfe();
  }

  _aktualisiereKnoepfe() {
    const letzter = this._zeilen.length - 1;
    this._zeilen.forEach((z, i) => {
      if (z.hoch) z.hoch.disabled = i === 0;
      if (z.runter) z.runter.disabled = i === letzter;
    });
  }

  /** input[type=color] kennt nur #rrggbb. Alles andere wuerde dort zu Schwarz. */
  _alsHex(farbe, ersatz) {
    return /^#[0-9a-f]{6}$/i.test(farbe || "") ? farbe : ersatz;
  }

  _hatFokus(el) {
    const a = this.shadowRoot.activeElement;
    return !!a && (a === el || el.contains(a));
  }

  _indexVon(id) {
    return this._zeilen.findIndex((z) => z.id === id);
  }

  _baueEintrag(e, id, index) {
    const box = document.createElement("div");
    box.className = "eintrag";

    // Kopfzeile: Entitaet plus Reihenfolge und Loeschen
    const kopf = document.createElement("div");
    kopf.className = "kopf";

    const picker = this._entitaetsWaehler(e.entity, (wert) => {
      const i = this._indexVon(id);
      if (i < 0) return;
      const jetzt = this._config.entities[i];
      // Ein leerer Wert kommt auch beim Neuaufbau des Waehlers. Er darf die Zeile
      // nicht loeschen - dafuer gibt es ausschliesslich das Kreuz.
      if (!wert || wert === jetzt.entity) return;
      this._aendere(i, { ...jetzt, entity: wert });
    });
    kopf.appendChild(picker);

    const hoch = this._knopf("▲", false, () => {
      const i = this._indexVon(id);
      if (i >= 0) this._verschiebe(i, -1);
    });
    const runter = this._knopf("▼", false, () => {
      const i = this._indexVon(id);
      if (i >= 0) this._verschiebe(i, 1);
    });
    const weg = this._knopf("✕", false, () => {
      const i = this._indexVon(id);
      if (i >= 0) this._aendere(i, null);
    });
    kopf.appendChild(hoch);
    kopf.appendChild(runter);
    kopf.appendChild(weg);
    box.appendChild(kopf);

    // Detailzeile: Name, Sekundaerinfo, Farbe
    const detail = document.createElement("div");
    detail.className = "detail";

    const nameFeld = this._textfeld("Name (optional)", e.name || "", (wert) => {
      const i = this._indexVon(id);
      if (i < 0) return;
      const jetzt = this._config.entities[i];
      if ((jetzt.name || "") === wert) return;
      const neu = { ...jetzt };
      if (wert) neu.name = wert; else delete neu.name;
      this._aendere(i, neu);
    });
    detail.appendChild(nameFeld);

    const auswahl = document.createElement("select");
    ZUSATZ_OPTIONEN.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if ((e.secondary_info || "") === o.value) opt.selected = true;
      auswahl.appendChild(opt);
    });
    auswahl.title = "Zweite Zeile unter dem Namen";
    auswahl.addEventListener("change", () => {
      const i = this._indexVon(id);
      if (i < 0) return;
      const neu = { ...this._config.entities[i] };
      if (auswahl.value) neu.secondary_info = auswahl.value; else delete neu.secondary_info;
      this._aendere(i, neu);
    });
    detail.appendChild(auswahl);

    const farbeBox = document.createElement("div");
    farbeBox.className = "farbe";
    const label = document.createElement("label");
    label.textContent = "Farbe";
    const farbe = document.createElement("input");
    farbe.type = "color";
    farbe.value = this._alsHex(e.color, PALETTE[index % PALETTE.length]);
    farbe.addEventListener("change", () => {
      const i = this._indexVon(id);
      if (i < 0) return;
      this._aendere(i, { ...this._config.entities[i], color: farbe.value });
    });
    farbeBox.appendChild(label);
    farbeBox.appendChild(farbe);
    detail.appendChild(farbeBox);

    box.appendChild(detail);
    return { id, element: box, picker, nameFeld, auswahl, farbe, hoch, runter };
  }

  /** ha-entity-picker, wenn das Frontend ihn hergibt — sonst ein Feld mit Vorschlagsliste. */
  _entitaetsWaehler(wert, beiAenderung) {
    if (customElements.get("ha-entity-picker")) {
      const p = document.createElement("ha-entity-picker");
      p.hass = this._hass;
      p.value = wert;
      p.allowCustomEntity = true;
      p.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        beiAenderung(ev.detail.value);
      });
      return p;
    }

    const huelle = document.createElement("span");
    huelle.style.display = "contents";
    const feld = document.createElement("input");
    feld.className = "ersatz";
    feld.value = wert;
    feld.placeholder = "sensor.beispiel";
    const liste = document.createElement("datalist");
    liste.id = `ebg-liste-${Math.random().toString(36).slice(2)}`;
    Object.keys(this._hass.states).slice(0, 2000).forEach((id) => {
      const o = document.createElement("option");
      o.value = id;
      liste.appendChild(o);
    });
    feld.setAttribute("list", liste.id);
    feld.addEventListener("change", () => beiAenderung(feld.value.trim()));
    huelle.appendChild(feld);
    huelle.appendChild(liste);
    huelle._feld = feld;
    return huelle;
  }

  _setzeWaehlerWert(waehler, wert) {
    if (!waehler) return;
    const ziel = waehler._feld || waehler;
    if (ziel.value !== wert) ziel.value = wert;
  }

  _textfeld(label, wert, beiAenderung) {
    if (customElements.get("ha-textfield")) {
      const f = document.createElement("ha-textfield");
      f.label = label;
      f.value = wert;
      f.addEventListener("change", () => beiAenderung(f.value.trim()));
      return f;
    }
    const f = document.createElement("input");
    f.className = "ersatz";
    f.placeholder = label;
    f.value = wert;
    f.addEventListener("change", () => beiAenderung(f.value.trim()));
    return f;
  }

  _knopf(zeichen, gesperrt, beiKlick) {
    const b = document.createElement("button");
    b.className = "knopf";
    b.type = "button";
    b.textContent = zeichen;
    b.disabled = !!gesperrt;
    b.addEventListener("click", beiKlick);
    return b;
  }

  _aendere(index, eintrag) {
    const entities = [...this._config.entities];
    if (eintrag === null) entities.splice(index, 1);
    else entities[index] = eintrag;
    this._melde({ ...this._config, entities });
  }

  _verschiebe(index, richtung) {
    const ziel = index + richtung;
    const entities = [...this._config.entities];
    if (ziel < 0 || ziel >= entities.length) return;
    [entities[index], entities[ziel]] = [entities[ziel], entities[index]];
    this._melde({ ...this._config, entities });
  }

  /* ---------- Schema und Formular ---------- */

  _schema() {
    const graph = this._config.footer.graph || "none";
    const felder = [
      { name: "title", selector: { text: {} } },
      {
        name: "graph",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: "Kein Graph" },
              { value: "card", label: "Band am Kartenfuß" },
              { value: "rows", label: "Hinter jeder Zeile" },
              { value: "inline", label: "Klein in der Zeile, zwischen Name und Wert" },
              { value: "full", label: "Hinter der ganzen Karte" },
            ],
          },
        },
      },
    ];

    if (graph !== "none") {
      felder.push({
        name: "color_targets",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "icon", label: "Icon" },
              { value: "name", label: "Name" },
              { value: "dot", label: "Punkt vor dem Wert" },
            ],
          },
        },
      });
      felder.push({
        name: "hours",
        selector: { number: { min: 1, max: 720, mode: "box", unit_of_measurement: "h" } },
      });
    }
    if (graph === "card") {
      felder.push({
        name: "height",
        selector: { number: { min: 40, max: 400, mode: "box", unit_of_measurement: "px" } },
      });
    }

    if (graph === "inline") {
      felder.push({
        name: "spark_width",
        selector: { number: { min: 20, max: 200, mode: "box", unit_of_measurement: "px" } },
      });
      felder.push({
        name: "spark_height",
        selector: { number: { min: 12, max: 80, mode: "box", unit_of_measurement: "px" } },
      });
    }

    felder.push({ name: "image", selector: { text: {} } });
    if (this._config.footer.image) {
      felder.push({
        name: "image_height",
        selector: { number: { min: 40, max: 600, mode: "box", unit_of_measurement: "px" } },
      });
    }

    if (graph !== "none") {
      felder.push({
        type: "expandable",
        name: "",
        title: "Feinschliff",
        icon: "mdi:tune",
        schema: [
          {
            name: "scale",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "unit", label: "Gleiche Einheit teilt sich eine Skala" },
                  { value: "each", label: "Jede Linie über die volle Höhe" },
                ],
              },
            },
          },
          { name: "fill_opacity", selector: { number: { min: 0, max: 1, step: 0.01, mode: "slider" } } },
          { name: "line_opacity", selector: { number: { min: 0, max: 1, step: 0.01, mode: "slider" } } },
          { name: "line_width", selector: { number: { min: 1, max: 6, step: 0.5, mode: "slider" } } },
          { name: "buckets", selector: { number: { min: 8, max: 200, mode: "box" } } },
          { name: "refresh", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "min" } } },
        ],
      });
    }

    return felder;
  }

  _formularDaten() {
    const c = this._config, f = c.footer || {};
    return {
      title: c.title || "",
      graph: f.graph || "none",
      hours: c.hours ?? STANDARD.hours,
      height: f.height ?? 100,
      spark_width: f.spark_width ?? 60,
      spark_height: f.spark_height ?? 24,
      image: f.image || "",
      image_height: f.image_height,
      color_targets: c.color_targets ?? STANDARD.color_targets,
      scale: c.scale ?? STANDARD.scale,
      fill_opacity: c.fill_opacity ?? STANDARD.fill_opacity,
      line_opacity: c.line_opacity ?? STANDARD.line_opacity,
      line_width: c.line_width ?? STANDARD.line_width,
      buckets: c.buckets ?? STANDARD.buckets,
      refresh: c.refresh ?? STANDARD.refresh,
    };
  }

  /** Formularwerte zurueck in eine schlanke Konfiguration — Standardwerte landen nicht im YAML. */
  _ausFormular(daten) {
    const neu = { type: "custom:entities-background-card" };
    if (daten.title) neu.title = daten.title;

    const footer = {};
    if (daten.graph && daten.graph !== "none") footer.graph = daten.graph;
    if (daten.graph === "card" && daten.height && daten.height !== 100) footer.height = daten.height;
    if (daten.graph === "inline") {
      if (daten.spark_width && daten.spark_width !== 60) footer.spark_width = daten.spark_width;
      if (daten.spark_height && daten.spark_height !== 24) footer.spark_height = daten.spark_height;
    }
    if (daten.image) footer.image = daten.image;
    if (daten.image && daten.image_height) footer.image_height = daten.image_height;
    if (Object.keys(footer).length) neu.footer = footer;

    if (daten.graph && daten.graph !== "none") {
      if (daten.hours && daten.hours !== STANDARD.hours) neu.hours = daten.hours;
      const ziele = Array.isArray(daten.color_targets) ? daten.color_targets : [];
      const standardZiele = [...STANDARD.color_targets].sort().join(",");
      if ([...ziele].sort().join(",") !== standardZiele) neu.color_targets = ziele;
      ["scale", "fill_opacity", "line_opacity", "line_width", "buckets", "refresh"].forEach((k) => {
        if (daten[k] !== undefined && daten[k] !== STANDARD[k]) neu[k] = daten[k];
      });
    }

    neu.entities = this._config.entities;
    this._melde(neu);
  }

  _aufraeumen(config) {
    const sauber = { ...config };
    delete sauber.footer;
    if (config.footer && Object.keys(config.footer).length) {
      const f = { ...config.footer };
      if (f.graph === "none") delete f.graph;
      if (Object.keys(f).length) sauber.footer = f;
    }
    return sauber;
  }

  _melde(config) {
    const sauber = this._aufraeumen(config);
    this._config = this._normalisiere(sauber);
    // Vor dem Senden merken: Home Assistant ruft setConfig unter Umstaenden synchron auf.
    this._eigeneMeldung = JSON.stringify(this._config);
    this._aktualisiere();
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: sauber },
      bubbles: true,
      composed: true,
    }));
  }
}

/* ========================================================================= */

customElements.define("entities-background-card", EntitiesBackgroundCard);
customElements.define("entities-background-card-editor", EntitiesBackgroundCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "entities-background-card",
  name: "Entities mit Hintergrundgraph",
  description: "Entities-Liste mit Überschrift und Footer aus Bild und/oder Verlaufsgraph.",
  preview: true,
  documentationURL: "https://github.com/Coho04/lovelace-homelab-cards",
});

console.info(
  `%c HOMELAB-CARDS %c v${VERSION} `,
  "color: white; background: #ff7043; font-weight: 700;",
  "color: #ff7043; background: white; font-weight: 700;"
);
