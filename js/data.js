/* Kursdaten: echte Binance-Daten mit Simulator als Rueckfallebene. */
(function (global) {
  'use strict';

  var REST = 'https://api.binance.com/api/v3/klines';
  var WS = 'wss://stream.binance.com:9443/ws/';

  /* Binance liefert Klines als Array von Arrays:
     [openTime, open, high, low, close, volume, closeTime, ...] */
  function parseKline(k) {
    return {
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    };
  }

  /* Holt die Historie. Wirft, wenn kein Netz da ist oder die API blockt --
     der Aufrufer faellt dann auf den Simulator zurueck. */
  function fetchKlines(symbol, interval, limit) {
    var url = REST + '?symbol=' + encodeURIComponent(symbol) +
      '&interval=' + encodeURIComponent(interval) +
      '&limit=' + limit;
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Binance HTTP ' + res.status);
      return res.json();
    }).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) throw new Error('Leere Antwort von Binance');
      return rows.map(parseKline);
    });
  }

  /* Live-Stream der laufenden Kerze. onCandle(candle, isClosed) wird bei jedem
     Tick gerufen; bei Verbindungsabbruch wird mit Backoff neu verbunden. */
  function openStream(symbol, interval, onCandle, onStatus) {
    var ws = null;
    var closed = false;
    var retry = 0;
    var timer = null;

    function connect() {
      if (closed) return;
      var url = WS + symbol.toLowerCase() + '@kline_' + interval;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        schedule();
        return;
      }
      ws.onopen = function () {
        retry = 0;
        if (onStatus) onStatus('LIVE');
      };
      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || !msg.k) return;
        var k = msg.k;
        onCandle({
          time: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v)
        }, !!k.x);
      };
      ws.onerror = function () { if (ws) ws.close(); };
      ws.onclose = function () {
        if (closed) return;
        if (onStatus) onStatus('RECONNECT');
        schedule();
      };
    }

    function schedule() {
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(connect, Math.min(1000 * Math.pow(2, retry - 1), 30000));
    }

    connect();
    return function stop() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }

  /* Deterministischer PRNG (mulberry32), damit ein simulierter Lauf mit
     gleichem Seed reproduzierbar ist -- praktisch fuer wiederholte Takes. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Erzeugt eine plausible BTC-Kursreihe: Random Walk, bei dem Trend und
     Volatilitaet mittelwert-rueckkehrend wandern (Ornstein-Uhlenbeck). Ein
     reiner Random Walk auf dem Trend laeuft zu lange in eine Richtung und
     erzeugt kaum EMA-Kreuzungen -- also kaum Signale. Mit Rueckstellkraft
     entstehen Wellen, Ausbrueche und Konsolidierungen.

     Wird genutzt, wenn Binance nicht erreichbar ist -- die Aufnahme darf nie
     an fehlendem Netz scheitern. */
  function createSimulator(opts) {
    opts = opts || {};
    var rand = rng(opts.seed || 20260901);
    var price = opts.startPrice || 68000;
    var vol = 0.0018;
    var drift = 0;

    function gauss() {
      /* Box-Muller */
      var u = 1 - rand();
      var v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    return {
      next: function (time) {
        /* Rueckstellkraft zur Mitte plus Rauschen. */
        drift += -0.055 * drift + gauss() * 0.00042;
        vol += -0.05 * (vol - 0.0018) + gauss() * 0.00022;
        vol = Math.max(0.0007, Math.min(0.006, vol));
        /* Seltene Impulse -- die Ausbrueche, an denen Signale entstehen. */
        if (rand() < 0.025) drift += (rand() < 0.5 ? -1 : 1) * 0.0016;

        var open = price;
        var close = open * (1 + drift + gauss() * vol);
        var wick = open * vol * (0.6 + rand() * 1.4);
        var high = Math.max(open, close) + wick * rand();
        var low = Math.min(open, close) - wick * rand();
        /* Volumen steigt mit der Kerzengroesse -- so wird der Volumenfilter
           der Signal-Logik an echten Bewegungen ausgeloest. */
        var body = Math.abs(close - open) / open;
        var volume = (18 + rand() * 22) * (1 + body * 140);

        price = close;
        return {
          time: time,
          open: open,
          high: high,
          low: low,
          close: close,
          volume: volume
        };
      }
    };
  }

  /* Bequemlichkeits-Wrapper: erzeugt count Kerzen am Stueck. */
  function simulate(count, opts) {
    opts = opts || {};
    var stepMs = opts.stepMs || 60000;
    var start = Date.now() - count * stepMs;
    var sim = createSimulator(opts);
    var out = [];
    for (var i = 0; i < count; i++) out.push(sim.next(start + i * stepMs));
    return out;
  }

  /* Setzt einen Live-Tick auf die Kerzenliste: aktualisiert die laufende
     Kerze oder haengt eine neue an. Gibt true zurueck, wenn eine Kerze
     hinzugekommen ist. */
  function applyTick(candles, candle) {
    var last = candles[candles.length - 1];
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
      return false;
    }
    if (last && candle.time < last.time) return false;
    candles.push(candle);
    return true;
  }

  global.TVData = {
    fetchKlines: fetchKlines,
    openStream: openStream,
    createSimulator: createSimulator,
    simulate: simulate,
    applyTick: applyTick
  };
})(window);
