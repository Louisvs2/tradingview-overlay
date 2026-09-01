/* Orchestrierung: Konfiguration, Daten, Render-Loop, Replay, Shortcuts. */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * KONFIGURATION -- hier alles einstellen.
   * ------------------------------------------------------------------ */
  var CONFIG = {
    symbol: 'BTCUSDT',      /* Binance-Symbol */
    display: 'BTC / USD',   /* Anzeige in der Kopfzeile */
    interval: '1m',         /* 1m, 5m, 15m, 1h, 4h, 1d ... */
    history: 600,           /* Wie viele Kerzen geladen werden */
    visible: 130,           /* Wie viele Kerzen gleichzeitig sichtbar sind */

    /* Indikator- und Signal-Parameter */
    emaFast: 9,
    emaSlow: 21,
    emaTrend: 50,
    rsiPeriod: 14,
    atrPeriod: 14,
    volMaPeriod: 20,
    volFactor: 1.15,        /* Volumen muss das X-fache seines Mittels sein */
    rsiBuyMin: 45, rsiBuyMax: 72,
    rsiSellMin: 28, rsiSellMax: 55,
    cooldown: 10,           /* Mindestabstand zwischen zwei Signalen (Kerzen) */
    atrStopMult: 1.5,       /* Stop-Loss = ATR * X */
    riskReward: 2.0,        /* Take-Profit = Risiko * X */

    /* Farben. Muessen mit den Werten in styles.css uebereinstimmen. */
    bg: '#0a0e12',
    grid: 'rgba(120,140,160,0.09)',
    textDim: '#5d6b7a',
    buy: '#22d67b',
    sell: '#ff4d5e',
    buyFaint: 'rgba(34,214,123,0.22)',
    sellFaint: 'rgba(255,77,94,0.22)',
    buyBg: 'rgba(6,32,20,0.94)',
    sellBg: 'rgba(38,10,14,0.94)',
    emaFastColor: '#4da3ff',
    emaSlowColor: '#f0a020',
    emaTrendColor: 'rgba(150,170,190,0.35)',
    rsiLine: '#9d7bff',
    font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',

    replaySpeed: 6          /* Kerzen pro Sekunde im Replay */
  };

  /* Farbnamen fuer den Chart-Renderer aufloesen. */
  var chartCfg = Object.assign({}, CONFIG, {
    emaFast: CONFIG.emaFastColor,
    emaSlow: CONFIG.emaSlowColor,
    emaTrend: CONFIG.emaTrendColor
  });

  var state = {
    candles: [],
    series: null,
    signals: [],
    viewStart: 0,
    viewEnd: 0
  };

  var chart, hud;
  var replay = false;
  var paused = false;
  var speed = CONFIG.replaySpeed;
  var replayCursor = 0;
  var lastStep = 0;
  var announced = {};
  var stopStream = null;
  var simTimer = null;
  var live = false;

  function recompute() {
    state.series = TVI.computeSeries(state.candles, CONFIG);
    state.signals = TVI.generateSignals(state.candles, state.series, CONFIG);
  }

  function setView(end) {
    state.viewEnd = Math.max(1, Math.min(state.candles.length, end));
    state.viewStart = Math.max(0, state.viewEnd - CONFIG.visible);
  }

  /* Meldet Signale und deren Ausgang, sobald die zugehoerige Kerze im
     Sichtfenster angekommen ist. Der Schluessel ist die Zeit, nicht der Index:
     bei laufendem Betrieb werden vorne Kerzen abgeschnitten, wodurch sich alle
     Indizes verschieben wuerden. */
  function announceSignals() {
    for (var i = 0; i < state.signals.length; i++) {
      var s = state.signals[i];
      if (s.index < state.viewEnd && !announced['e' + s.time]) {
        announced['e' + s.time] = true;
        hud.logSignal(s);
      }
      if (s.result && s.result.index < state.viewEnd && !announced['x' + s.time]) {
        announced['x' + s.time] = true;
        hud.logExit(s);
      }
    }
  }

  /* Alle bereits vorhandenen Signale als bekannt markieren -- beim Start soll
     nicht die halbe Historie durchs Log rauschen. */
  function markKnown() {
    state.signals.forEach(function (s) {
      announced['e' + s.time] = true;
      announced['x' + s.time] = true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Datenbeschaffung
   * ------------------------------------------------------------------ */
  function startLive(candles) {
    state.candles = candles;
    recompute();
    setView(state.candles.length);
    markKnown();
    hud.update(state);
    hud.log('sys', 'Historie geladen: ' + candles.length + ' Kerzen ' + CONFIG.interval);
    var last = state.signals[state.signals.length - 1];
    if (last) hud.log('sys', 'Letztes Signal: ' + last.side + ' @ ' + last.entry.toFixed(2));

    stopStream = TVData.openStream(CONFIG.symbol, CONFIG.interval, function (candle) {
      if (replay) return;
      TVData.applyTick(state.candles, candle);
      if (state.candles.length > CONFIG.history + 200) state.candles.shift();
      recompute();
      setView(state.candles.length);
      announceSignals();
    }, function (status) {
      hud.setSource(status === 'LIVE' ? 'BINANCE LIVE' : 'VERBINDE ...', status === 'LIVE');
    });
  }

  /* Simulator-Betrieb: erzeugt fortlaufend neue Kerzen, damit der Chart auch
     ohne Netz lebt. Der Generator behaelt seinen Zustand, damit die Live-Kerzen
     nahtlos an die Historie anschliessen. */
  function startSim(reason) {
    live = false;
    hud.setSource('SIMULATION', false);
    hud.log('warn', 'Binance nicht erreichbar (' + reason + ') -- Simulator aktiv');

    var stepMs = 60000;
    var sim = TVData.createSimulator({ seed: (Date.now() >>> 0) });
    var t = Date.now() - CONFIG.history * stepMs;
    state.candles = [];
    for (var i = 0; i < CONFIG.history; i++) state.candles.push(sim.next(t + i * stepMs));
    var nextTime = t + CONFIG.history * stepMs;

    recompute();
    setView(state.candles.length);
    markKnown();
    hud.log('sys', 'Simulierte Historie: ' + state.candles.length + ' Kerzen');

    simTimer = setInterval(function () {
      if (replay || paused) return;
      state.candles.push(sim.next(nextTime));
      nextTime += stepMs;
      if (state.candles.length > CONFIG.history + 200) state.candles.shift();
      recompute();
      setView(state.candles.length);
      announceSignals();
    }, 1500);
  }

  /* ------------------------------------------------------------------ *
   * Replay -- der eigentliche Aufnahmemodus
   * ------------------------------------------------------------------ */
  function toggleReplay() {
    replay = !replay;
    if (replay) {
      announced = {};
      hud.logEl.innerHTML = '';
      hud.lines = 0;
      replayCursor = Math.min(state.candles.length, CONFIG.visible + 5);
      lastStep = 0;
      paused = false;
      hud.setMode('REPLAY  x' + speed);
      hud.log('sys', 'Replay gestartet -- Leertaste pausiert, +/- steuert das Tempo');
    } else {
      hud.setMode(live ? 'LIVE' : 'SIM');
      setView(state.candles.length);
      hud.log('sys', 'Replay beendet');
    }
  }

  function stepReplay(now) {
    if (paused) return;
    var interval = 1000 / speed;
    if (now - lastStep < interval) return;
    lastStep = now;
    replayCursor++;
    if (replayCursor > state.candles.length) {
      replayCursor = Math.min(state.candles.length, CONFIG.visible + 5);
      announced = {};
      hud.log('sys', 'Replay von vorn');
    }
    setView(replayCursor);
    announceSignals();
  }

  /* Gelegentliche Statuszeilen, damit das Terminal auch zwischen den Signalen
     lebendig wirkt. */
  var chatter = [
    'Orderbuch-Tiefe geprueft // Spread stabil',
    'Volatilitaetsfenster neu kalibriert',
    'EMA-Gitter synchron // keine Divergenz',
    'Liquiditaetszonen aktualisiert',
    'Momentum-Filter aktiv // warte auf Bestaetigung',
    'Trendintegritaet bestaetigt'
  ];
  var chatterIdx = 0;
  function heartbeat() {
    if (paused || !state.candles.length) return;
    /* Zeitstempel aus der letzten sichtbaren Kerze, damit das Log nicht
       zwischen Chart-Zeit und Systemuhr springt. */
    var last = state.candles[state.viewEnd - 1];
    hud.log('scan', chatter[chatterIdx % chatter.length], last ? last.time : null);
    chatterIdx++;
  }

  /* ------------------------------------------------------------------ *
   * Loop und Eingaben
   * ------------------------------------------------------------------ */
  function frame(now) {
    if (replay) stepReplay(now);
    chart.resize();
    if (state.series) {
      chart.render(state);
      hud.update(state);
    }
    requestAnimationFrame(frame);
  }

  /* Skaliert den festen 1920x1080-Rahmen so, dass er ins Fenster passt.
     CSS kann das nicht allein, darum hier per Variable. */
  function fitFrame() {
    if (!document.body.classList.contains('fixed-frame')) {
      document.body.style.removeProperty('--frame-scale');
      return;
    }
    var s = Math.min(global.innerWidth / 1920, global.innerHeight / 1080, 1);
    document.body.style.setProperty('--frame-scale', s.toFixed(4));
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'r' || k === 'R') { toggleReplay(); e.preventDefault(); }
      else if (k === ' ') {
        paused = !paused;
        hud.setMode((replay ? 'REPLAY  x' + speed : (live ? 'LIVE' : 'SIM')) + (paused ? '  ||' : ''));
        e.preventDefault();
      } else if (k === '+' || k === '=') {
        speed = Math.min(40, speed + 2);
        if (replay) hud.setMode('REPLAY  x' + speed);
      } else if (k === '-' || k === '_') {
        speed = Math.max(1, speed - 2);
        if (replay) hud.setMode('REPLAY  x' + speed);
      } else if (k === 'h' || k === 'H') {
        document.body.classList.toggle('bare');
      } else if (k === 'f' || k === 'F') {
        document.body.classList.toggle('fixed-frame');
        fitFrame();
      } else if (k === 'g' || k === 'G') {
        document.body.classList.toggle('no-fx');
      }
    });
  }

  /* Boot-Sequenz: ein paar gestaffelte Zeilen beim Start. */
  function boot(done) {
    var lines = [
      ['sys', 'Terminal initialisiert // ' + CONFIG.display],
      ['sys', 'Indikatoren: EMA ' + CONFIG.emaFast + '/' + CONFIG.emaSlow + '/' + CONFIG.emaTrend +
        ' // RSI ' + CONFIG.rsiPeriod + ' // ATR ' + CONFIG.atrPeriod],
      ['sys', 'Signalfilter: Volumen > x' + CONFIG.volFactor + ' // Cooldown ' + CONFIG.cooldown + ' Kerzen'],
      ['sys', 'Verbinde mit Datenquelle ...']
    ];
    var i = 0;
    (function next() {
      if (i >= lines.length) { done(); return; }
      hud.log(lines[i][0], lines[i][1]);
      i++;
      setTimeout(next, 220);
    })();
  }

  function init() {
    document.getElementById('symbol').textContent = CONFIG.display;
    document.getElementById('tf').textContent = CONFIG.interval.toUpperCase();

    chart = new TVChart(document.getElementById('chart'), chartCfg);
    hud = new TVHud(CONFIG);
    hud.setMode('LIVE');
    hud.setSource('VERBINDE ...', false);

    bindKeys();
    global.addEventListener('resize', fitFrame);
    setInterval(heartbeat, 9000);
    requestAnimationFrame(frame);

    boot(function () {
      TVData.fetchKlines(CONFIG.symbol, CONFIG.interval, CONFIG.history)
        .then(function (candles) {
          live = true;
          hud.setSource('BINANCE LIVE', true);
          startLive(candles);
        })
        .catch(function (err) {
          startSim(err && err.message ? err.message : 'unbekannter Fehler');
        });
    });

    global.addEventListener('beforeunload', function () {
      if (stopStream) stopStream();
      if (simTimer) clearInterval(simTimer);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
