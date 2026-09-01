# BTC/USD — Signal Terminal

Ein Chart-Overlay im Trading-Terminal-Look für Videoprojekte. Zeigt den
BTC/USD-Kurs mit klar markierten **BUY-** und **SELL-Punkten**, Stop-Loss,
Take-Profit, Trefferquote und einem mitlaufenden System-Log.

Läuft als reine HTML-Seite — kein Build, keine Installation, keine
TradingView-Anmeldung. Getestet in Safari und Chromium.

> Die Signale stammen aus einer klassischen Indikator-Logik und dienen der
> Darstellung in einem Video. Das ist keine Anlageberatung.

## Starten

Im Finder auf `index.html` doppelklicken — fertig.

Falls Safari den Abruf der Kursdaten über `file://` blockiert, im Ordner ein
kleines lokales Serverchen starten und `http://localhost:8000` öffnen:

```sh
cd tradingview-overlay
python3 -m http.server 8000
```

Die Seite holt echte Kerzendaten von der öffentlichen Binance-API. Ist kein
Netz da oder wird der Abruf blockiert, schaltet sie automatisch auf einen
Simulator um und läuft weiter — die Aufnahme fällt also nie aus. Oben rechts
steht, welche Quelle gerade aktiv ist (`BINANCE LIVE` oder `SIMULATION`).

## Tastenkürzel

| Taste | Wirkung |
| --- | --- |
| `R` | **Replay** — die Historie läuft zeitgerafft ab, Signale erscheinen live samt Log-Einträgen. Das ist der Aufnahmemodus. |
| `Leertaste` | Pause / weiter |
| `+` / `-` | Replay-Tempo |
| `H` | Nur der Chart, HUD aus |
| `F` | Fester 1920×1080-Rahmen für pixelgenaue Aufnahmen |
| `G` | Scanlines und Vignette aus (bei starker Videokompression oft besser) |

Für die Aufnahme: Fenster auf Vollbild, `F` drücken, dann `R` für den Replay
und mit `+` das Tempo passend zum Voiceover einstellen.

## Signal-Logik

Ein Signal entsteht nur, wenn drei Bedingungen zusammenkommen:

- **BUY** — EMA 9 kreuzt EMA 21 nach oben, RSI zwischen 45 und 72 (kein
  Einstieg im bereits überkauften Bereich), Volumen über seinem 20er-Mittel.
- **SELL** — spiegelbildlich: EMA 9 kreuzt EMA 21 nach unten, RSI zwischen
  28 und 55, Volumen über dem Mittel.

Dazu kommt ein Cooldown von 10 Kerzen zwischen zwei Signalen, damit im Video
jeder Marker für sich steht. Stop-Loss liegt bei 1,5 × ATR, das Ziel beim
2-fachen des Risikos. Für jeden Trade rechnet die Seite mit, ob zuerst Ziel
oder Stop getroffen wurde — daraus entsteht das Performance-Panel.

## Anpassen

Alles Wesentliche steht in `js/app.js` oben im Block `CONFIG`:

```js
symbol: 'BTCUSDT',     // z. B. ETHUSDT, SOLUSDT
display: 'BTC / USD',  // Beschriftung in der Kopfzeile
interval: '1m',        // 1m, 5m, 15m, 1h, 4h, 1d
visible: 130,          // sichtbare Kerzen
emaFast: 9, emaSlow: 21, emaTrend: 50,
cooldown: 10,          // Mindestabstand zwischen Signalen
atrStopMult: 1.5,      // Stop-Loss = ATR × X
riskReward: 2.0,       // Take-Profit = Risiko × X
replaySpeed: 6         // Kerzen pro Sekunde im Replay
```

Mehr Signale im Bild: `cooldown` senken oder `volFactor` auf 1.0 setzen.
Weniger, dafür markantere Signale: `cooldown` erhöhen.

Die Farben stehen doppelt — in `CONFIG` (für den Canvas-Chart) und als
CSS-Variablen in `styles.css` (für das HUD). Beim Umfärben beide anpassen.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst, lädt die Skripte |
| `styles.css` | Dark-Theme, HUD-Layout, Effekte |
| `js/indicators.js` | EMA, RSI, ATR, Signal- und Ergebnis-Logik |
| `js/data.js` | Binance-Abruf, Live-Stream, Simulator |
| `js/chart.js` | Canvas-Renderer für Kerzen, Indikatoren, Marker |
| `js/hud.js` | Panels, Log, Performance-Anzeige |
| `js/app.js` | Konfiguration, Render-Loop, Replay, Tastatur |

Bewusst ohne Frameworks und ohne CDN-Abhängigkeiten, damit die Seite auch
offline und direkt vom Dateisystem funktioniert.
