# Homelab Cards

Sammlung eigener Lovelace-Karten für Home Assistant. Keine Fremdabhängigkeiten, kein
Build-Schritt — ein Bundle, das alle Karten der Sammlung registriert.

## Installation über HACS

1. HACS → ⋮ → **Benutzerdefinierte Repositories**
2. URL `https://github.com/Coho04/lovelace-homelab-cards`, Kategorie **Dashboard**
3. „Homelab Cards" herunterladen
4. Oberfläche hart neu laden (`Strg`+`F5` / `Cmd`+`Shift`+`R`)

HACS trägt die Lovelace-Ressource selbst ein.

<details>
<summary>Manuell ohne HACS</summary>

`dist/homelab-cards.js` nach `/config/www/` kopieren, dann unter
Einstellungen → Dashboards → ⋮ → Ressourcen die URL `/local/homelab-cards.js`
als **JavaScript-Modul** eintragen.
</details>

## Enthaltene Karten

### `entities-background-card`

Eine Entities-Liste mit Überschrift und Footer. Der Footer zeigt ein Bild, einen
Verlaufsgraphen oder beides. Ist der Graph aktiv, bekommt jede Zeile eine Farbe — Icon und
Name tragen sie — und der zugehörige Verlauf liegt als Fläche im Hintergrund. Dadurch
braucht die Karte **keine Legende**: die Zuordnung Zeile ↔ Linie sitzt an der Zeile selbst.

Sie ersetzt den eingebauten `footer: {type: graph}` einer `entities`-Karte, der
konstruktiv nur **eine** Entität zeichnen kann.

```yaml
type: custom:entities-background-card
title: Temperaturen
hours: 24
footer:
  graph: card
  height: 100
entities:
  - entity: sensor.bad_temperatur
    name: Temperatur
    secondary_info: area_name
    color: '#ff7043'
  - entity: sensor.bad_luftfeuchte
    name: Luftfeuchtigkeit
    secondary_info: area_name
    color: '#29b6f6'
```

#### Graph-Darstellungen

| `footer.graph` | Darstellung |
|---|---|
| `card` | ein gemeinsames Band am Kartenfuß, alle Linien überlagert |
| `rows` | jede Zeile bekommt ihren eigenen Verlauf dahinter, mit eigener Skala |
| `full` | ein Graph hinter der ganzen Karte, die Liste liegt darüber |
| `none` | kein Graph (Standard) |

#### Optionen

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `title` | – | Überschrift der Karte |
| `entities` | – | Liste, beliebig lang. Je Eintrag `entity`, optional `name`, `icon`, `color`, `secondary_info` (`area_name` oder `last-changed`) |
| `hours` | `24` | Zeitraum des Verlaufs |
| `footer.graph` | `none` | siehe Tabelle oben |
| `footer.height` | `100` | Höhe des Graphbands in Pixeln, nur bei `graph: card` |
| `footer.image` | – | Bild im Footer, z. B. `/local/grundriss.png`. Auch zusammen mit einem Graphen |
| `footer.image_height` | – | Bildhöhe in Pixeln; ohne Angabe bleibt das Originalverhältnis |
| `scale` | `unit` | `unit` = gleiche Einheit teilt sich eine Skala, `each` = jede Linie nutzt die volle Höhe |
| `fill_opacity` | `0.13` | Deckkraft der Fläche |
| `line_opacity` | `0.55` | Deckkraft der Linie |
| `line_width` | `2` | Linienstärke |
| `buckets` | `48` | Punkte je Linie. Weniger = ruhiger |
| `refresh` | `5` | Minuten zwischen zwei Verlaufsabfragen |

Ohne `color` vergibt die Karte Farben aus einer festen Palette — aber nur, wenn ein Graph
aktiv ist. Ohne Graph erklärt eine Farbe nichts, dann bleiben die Zeilen im Theme-Stil.

#### Mehrere Einheiten

Teilen sich Entitäten mit verschiedenen Einheiten eine Karte (°C, %, hPa), bildet die Karte
je Einheit eine eigene Skala. Sonst würde der größte Wertebereich — etwa Luftdruck um 1013 —
alle anderen Linien flachdrücken. Mit `scale: each` bekommt stattdessen jede Linie ihre
eigene Skala über die volle Höhe.

## Technik

Der Verlauf kommt über die WebSocket-Methode `history/history_during_period`, wird auf feste
Zeitfenster gemittelt und quadratisch geglättet. Der Graph ist ein SVG mit
`preserveAspectRatio="none"`, das per `position: absolute` hinter dem Inhalt liegt.
Schlägt die Verlaufsabfrage fehl, bleibt die Liste bedienbar; die Karte protokolliert eine
Warnung in der Browserkonsole.

Mindestversion: Home Assistant 2023.8 (die Karte liest `hass.areas` und `hass.devices`).

## Lizenz

MIT
