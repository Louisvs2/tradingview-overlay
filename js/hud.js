/* HUD-Ebene: Kopfzeile, Signal-Karte, Indikator-Status und Terminal-Log. */
(function (global) {
  'use strict';

  var MAX_LOG = 60;

  function $(id) { return document.getElementById(id); }

  function fmt(v, d) {
    return v.toLocaleString('en-US', {
      minimumFractionDigits: d == null ? 2 : d,
      maximumFractionDigits: d == null ? 2 : d
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function stamp(ms) {
    var d = new Date(ms == null ? Date.now() : ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function Hud(cfg) {
    this.cfg = cfg;
    this.logEl = $('log');
    this.lines = 0;
    this.lastSignalTime = null;
  }

  /* Haengt eine Zeile ans Terminal-Log. kind steuert die Farbe. */
  Hud.prototype.log = function (kind, text, time) {
    var row = document.createElement('div');
    row.className = 'log-line log-' + kind;

    var ts = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = stamp(time);

    var tag = document.createElement('span');
    tag.className = 'log-tag';
    tag.textContent = '[' + kind.toUpperCase() + ']';

    var msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.textContent = text;

    row.appendChild(ts);
    row.appendChild(tag);
    row.appendChild(msg);
    this.logEl.appendChild(row);
    this.lines++;

    while (this.lines > MAX_LOG) {
      this.logEl.removeChild(this.logEl.firstChild);
      this.lines--;
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  };

  /* Meldet ein neues Signal im Log -- zwei Zeilen, damit es im Video wirkt:
     erst die Erkennung, dann die Ausfuehrung. */
  Hud.prototype.logSignal = function (sig) {
    var dir = sig.side === 'BUY' ? 'BULLISH' : 'BEARISH';
    this.log('scan', 'EMA CROSS ' + dir + ' // RSI ' + fmt(sig.rsi, 1) +
      ' // VOL x' + fmt(sig.volRatio, 2), sig.time);
    this.log(sig.side === 'BUY' ? 'buy' : 'sell',
      sig.side + ' @ ' + fmt(sig.entry) + '  SL ' + fmt(sig.stop) +
      '  TP ' + fmt(sig.target) + '  CONF ' + sig.confidence + '%', sig.time);
  };

  /* Meldet den Ausgang eines Trades: Ziel erreicht oder ausgestoppt. */
  Hud.prototype.logExit = function (sig) {
    var r = sig.result;
    var won = r.type === 'TP';
    this.log(won ? 'buy' : 'sell',
      'EXIT ' + r.type + ' @ ' + fmt(r.price) + '  ' +
      (r.pct >= 0 ? '+' : '') + fmt(r.pct, 2) + '%  (' + sig.side + ')', r.time);
  };

  /* Kopfzeile: Preis, absolute und prozentuale Veraenderung im Sichtfenster. */
  Hud.prototype.updateHeader = function (state) {
    var candles = state.candles;
    var last = candles[state.viewEnd - 1];
    var first = candles[state.viewStart];
    if (!last || !first) return;

    var diff = last.close - first.open;
    var pct = first.open ? (diff / first.open) * 100 : 0;
    var up = diff >= 0;

    $('price').textContent = fmt(last.close);
    $('price').className = 'price ' + (up ? 'up' : 'down');
    $('change').textContent = (up ? '+' : '') + fmt(diff) + '  (' + (up ? '+' : '') + fmt(pct, 2) + '%)';
    $('change').className = 'change ' + (up ? 'up' : 'down');

    var hi = -Infinity, lo = Infinity;
    for (var i = state.viewStart; i < state.viewEnd; i++) {
      if (candles[i].high > hi) hi = candles[i].high;
      if (candles[i].low < lo) lo = candles[i].low;
    }
    $('stat-high').textContent = fmt(hi);
    $('stat-low').textContent = fmt(lo);
    $('stat-clock').textContent = stamp(last.time);
  };

  /* Indikator-Panel: aktuelle Werte plus Ampel fuer die Trendrichtung. */
  Hud.prototype.updateIndicators = function (state) {
    var i = state.viewEnd - 1;
    var s = state.series;
    var f = s.emaFast[i], sl = s.emaSlow[i], tr = s.emaTrend[i];
    var r = s.rsi[i], a = s.atr[i];

    $('ind-ema-fast').textContent = f == null ? '--' : fmt(f);
    $('ind-ema-slow').textContent = sl == null ? '--' : fmt(sl);
    $('ind-atr').textContent = a == null ? '--' : fmt(a);

    var rsiEl = $('ind-rsi');
    if (r == null) {
      rsiEl.textContent = '--';
      rsiEl.className = 'val';
    } else {
      rsiEl.textContent = fmt(r, 1);
      rsiEl.className = 'val ' + (r >= 70 ? 'down' : r <= 30 ? 'up' : '');
    }

    var bar = $('rsi-bar');
    if (bar) bar.style.width = (r == null ? 0 : Math.max(0, Math.min(100, r))) + '%';

    var trendEl = $('ind-trend');
    if (f == null || sl == null || tr == null) {
      trendEl.textContent = 'WARTET';
      trendEl.className = 'val';
    } else if (f > sl && state.candles[i].close > tr) {
      trendEl.textContent = 'AUFWAERTS';
      trendEl.className = 'val up';
    } else if (f < sl && state.candles[i].close < tr) {
      trendEl.textContent = 'ABWAERTS';
      trendEl.className = 'val down';
    } else {
      trendEl.textContent = 'NEUTRAL';
      trendEl.className = 'val dim';
    }
  };

  /* Karte fuer das zuletzt ausgeloeste Signal. */
  Hud.prototype.updateSignalCard = function (state) {
    var card = $('signal-card');
    var visible = [];
    for (var i = 0; i < state.signals.length; i++) {
      if (state.signals[i].index < state.viewEnd) visible.push(state.signals[i]);
    }
    var sig = visible[visible.length - 1];

    if (!sig) {
      card.className = 'panel signal-card idle';
      $('sig-side').textContent = 'KEIN SIGNAL';
      $('sig-entry').textContent = '--';
      $('sig-stop').textContent = '--';
      $('sig-target').textContent = '--';
      $('sig-conf').textContent = '--';
      $('sig-age').textContent = 'Scanne Markt ...';
      $('sig-status').textContent = '';
      $('sig-status').className = 'sig-status dim';
      $('conf-bar').style.width = '0%';
      return;
    }

    var buy = sig.side === 'BUY';
    card.className = 'panel signal-card ' + (buy ? 'buy' : 'sell');
    $('sig-side').textContent = sig.side;
    $('sig-entry').textContent = fmt(sig.entry);
    $('sig-stop').textContent = fmt(sig.stop);
    $('sig-target').textContent = fmt(sig.target);
    $('sig-conf').textContent = sig.confidence + '%';
    $('conf-bar').style.width = sig.confidence + '%';

    var bars = state.viewEnd - 1 - sig.index;
    $('sig-age').textContent = bars <= 0 ? 'JETZT' : 'vor ' + bars + ' Kerzen';

    /* Ausgang nur zeigen, wenn die entscheidende Kerze schon sichtbar ist --
       im Replay darf das HUD der Zeit nicht vorauslaufen. */
    var st = $('sig-status');
    var r = sig.result;
    if (r && r.index < state.viewEnd) {
      var won = r.type === 'TP';
      st.textContent = (won ? 'ZIEL ERREICHT  ' : 'AUSGESTOPPT  ') +
        (r.pct >= 0 ? '+' : '') + fmt(r.pct, 2) + '%';
      st.className = 'sig-status ' + (won ? 'up' : 'down');
    } else {
      st.textContent = 'POSITION OFFEN';
      st.className = 'sig-status dim';
    }
  };

  /* Trefferquote ueber alle Trades, deren Ausgang bereits sichtbar ist.
     Im Replay waechst die Statistik damit live mit -- sie nimmt nichts
     vorweg, was der Zuschauer noch nicht gesehen hat. */
  Hud.prototype.updatePerformance = function (state) {
    var wins = 0, losses = 0, sum = 0;
    for (var i = 0; i < state.signals.length; i++) {
      var r = state.signals[i].result;
      if (!r || r.index >= state.viewEnd) continue;
      if (r.type === 'TP') wins++; else losses++;
      sum += r.pct;
    }
    var total = wins + losses;
    var rate = total ? (wins / total) * 100 : 0;

    $('perf-trades').textContent = total;
    $('perf-wins').textContent = wins;
    $('perf-losses').textContent = losses;
    $('perf-rate').textContent = total ? fmt(rate, 0) + '%' : '--';
    $('perf-bar').style.width = rate + '%';

    var sumEl = $('perf-sum');
    sumEl.textContent = total ? (sum >= 0 ? '+' : '') + fmt(sum, 2) + '%' : '--';
    sumEl.className = 'val ' + (total === 0 ? 'dim' : (sum >= 0 ? 'up' : 'down'));
  };

  Hud.prototype.setSource = function (label, live) {
    var el = $('source');
    el.textContent = label;
    el.className = 'badge ' + (live ? 'live' : 'sim');
  };

  Hud.prototype.setMode = function (label) {
    $('mode').textContent = label;
  };

  Hud.prototype.update = function (state) {
    this.updateHeader(state);
    this.updateIndicators(state);
    this.updateSignalCard(state);
    this.updatePerformance(state);
  };

  global.TVHud = Hud;
})(window);
