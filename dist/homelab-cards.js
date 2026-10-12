/*
 * Homelab Cards — Sammlung eigener Lovelace-Karten
 * https://github.com/Coho04/lovelace-homelab-cards
 *
 * Dieses Bundle definiert alle Karten der Sammlung. Weitere Karten kommen hier dazu,
 * ohne dass in Home Assistant eine zweite Ressource eingetragen werden muss.
 *
 * Enthalten:
 *   - entities-background-card
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
 *     graph: card                  # card | rows | full | none
 *     height: 100                  # Hoehe des Graphbands, nur bei graph: card
 *     image: /local/bild.jpg       # optional, auch zusammen mit graph
 *     image_height: 120            # optional, sonst Originalverhaeltnis
 *   entities:
 *     - entity: sensor.xyz
 *       name: Temperatur           # optional
 *       secondary_info: area_name  # optional
 *       color: '#ff7043'           # optional, sonst aus der Palette
 *
 * Feinschliff: fill_opacity (0.13), line_opacity (0.55), line_width (2),
 * buckets (48 Punkte je Linie), scale (unit | each), refresh (Minuten).
 */

const PALETTE = [
  "#ff7043", "#29b6f6", "#90a4ae", "#ef5350",
  "#ffa726", "#26a69a", "#7e57c2", "#66bb6a",
  "#ec407a", "#8d6e63", "#5c6bc0", "#9ccc65",
];

const W = 1000;          // SVG-Koordinatenraum, per preserveAspectRatio gedehnt
const H = 300;
const GRAPH_MODI = ["card", "rows", "full", "none"];

class EntitiesBackgroundCard extends HTMLElement {
  constructor() {
    super();
    this._verlauf = null;
    this._geholt = 0;
    this._laeuft = false;
    this._aufgebaut = false;
    this._signatur = "";
  }

  /* ---------- Konfiguration ---------- */

  setConfig(config) {
    if (!config || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("Mindestens eine Entitaet unter 'entities' angeben.");
    }

    const footer = config.footer || {};
    const graph = footer.graph === undefined ? "none" : String(footer.graph);
    if (!GRAPH_MODI.includes(graph)) {
      throw new Error(`footer.graph muss eines von ${GRAPH_MODI.join(", ")} sein.`);
    }

    this._config = {
      hours: 24,
      refresh: 5,
      buckets: 48,
      fill_opacity: 0.13,
      line_opacity: 0.55,
      line_width: 2,
      scale: "unit",
      ...config,
      footer: { height: 100, ...footer, graph },
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
        .hintergrund {
          position: absolute; inset: 0;
          z-index: 0; pointer-events: none;
        }
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
        .zeile {
          position: relative;
          display: flex;
          align-items: center;
          min-height: 40px;
          cursor: pointer;
        }
        .zeile-graph {
          position: absolute;
          left: -16px; right: -16px; top: 0; bottom: 0;
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
        .wert {
          flex: 0 0 auto; margin-left: 8px; text-align: right;
          font-size: 14px; color: var(--primary-text-color); white-space: nowrap;
        }
        .band { position: relative; width: 100%; }
        .bild { display: block; width: 100%; }
        .fehler { padding: 12px 16px; color: var(--error-color, #db4437); font-size: 13px; }
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

    // Zeilen nur dann neu bauen, wenn sich die Zusammensetzung wirklich geaendert hat.
    const signatur = cfg.entities.map((e) => `${e.entity}|${e.name || ""}|${e.color || ""}`).join(";");
    if (signatur !== this._signatur) {
      this._elZeilen.innerHTML = "";
      cfg.entities.forEach((e) => this._elZeilen.appendChild(this._baueZeile(e)));
      this._signatur = signatur;
    }

    cfg.entities.forEach((e, i) => this._aktualisiereZeile(this._elZeilen.children[i], e));

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

    const icon = document.createElement("ha-icon");
    icon.icon = e.icon || (st && st.attributes.icon) || this._standardIcon(st);
    if (e.color) icon.style.color = e.color;
    inhalt.appendChild(icon);

    const text = document.createElement("div");
    text.className = "text";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = e.name || (st ? st.attributes.friendly_name : e.entity);
    if (e.color) name.style.color = e.color;   // die Farbe an der Zeile ersetzt die Legende
    const zusatz = document.createElement("div");
    zusatz.className = "zusatz";
    text.appendChild(name);
    text.appendChild(zusatz);
    inhalt.appendChild(text);

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
      wert.title = "Entitaet nicht gefunden";
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
    if (this._laeuft) return;
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
    });

    if (modus === "none" || !this._verlauf) return;
    const reihen = this._reihen();

    if (modus === "rows") {
      // Jede Zeile bekommt ihren eigenen Verlauf hinter sich, mit eigener Skala.
      reihen.forEach((r, i) => {
        const zeile = this._elZeilen.children[i];
        if (!zeile || r.punkte.length < 2) return;
        const ziel = zeile.querySelector(".zeile-graph");
        ziel.innerHTML = this._svg([this._pfad(r, this._skala([r]))], `r${i}`);
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

customElements.define("entities-background-card", EntitiesBackgroundCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "entities-background-card",
  name: "Entities mit Hintergrundgraph",
  description: "Entities-Liste mit Ueberschrift und Footer aus Bild und/oder Verlaufsgraph.",
});
