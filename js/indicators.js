/* Indikatoren und Signal-Logik. Reine Funktionen, keine DOM-Abhaengigkeit. */
(function (global) {
  'use strict';

  /* Simple Moving Average. Gibt ein Array gleicher Laenge zurueck,
     Werte vor dem ersten vollen Fenster sind null. */
  function sma(values, period) {
    var out = new Array(values.length).fill(null);
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  /* Exponential Moving Average, geseedet mit dem SMA des ersten Fensters. */
  function ema(values, period) {
    var out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    var k = 2 / (period + 1);
    var seed = 0;
    for (var i = 0; i < period; i++) seed += values[i];
    var prev = seed / period;
    out[period - 1] = prev;
    for (var j = period; j < values.length; j++) {
      prev = values[j] * k + prev * (1 - k);
      out[j] = prev;
    }
    return out;
  }

  /* Relative Strength Index nach Wilder. */
  function rsi(closes, period) {
    var out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    var gain = 0;
    var loss = 0;
    for (var i = 1; i <= period; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    var avgGain = gain / period;
    var avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (var j = period + 1; j < closes.length; j++) {
      var diff = closes[j] - closes[j - 1];
      var g = diff > 0 ? diff : 0;
      var l = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[j] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  /* Average True Range nach Wilder. Basis fuer Stop-Loss und Take-Profit. */
  function atr(candles, period) {
    var out = new Array(candles.length).fill(null);
    if (candles.length <= period) return out;
    var trs = [0];
    for (var i = 1; i < candles.length; i++) {
      var c = candles[i];
      var prevClose = candles[i - 1].close;
      trs.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      ));
    }
    var sum = 0;
    for (var j = 1; j <= period; j++) sum += trs[j];
    var prev = sum / period;
    out[period] = prev;
    for (var k = period + 1; k < candles.length; k++) {
      prev = (prev * (period - 1) + trs[k]) / period;
      out[k] = prev;
    }
    return out;
  }

  /* Berechnet alle Indikator-Serien einmal fuer den gesamten Datensatz. */
  function computeSeries(candles, cfg) {
    var closes = candles.map(function (c) { return c.close; });
    var volumes = candles.map(function (c) { return c.volume; });
    return {
      emaFast: ema(closes, cfg.emaFast),
      emaSlow: ema(closes, cfg.emaSlow),
      emaTrend: ema(closes, cfg.emaTrend),
      rsi: rsi(closes, cfg.rsiPeriod),
      atr: atr(candles, cfg.atrPeriod),
      volMa: sma(volumes, cfg.volMaPeriod)
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Confidence-Score 0..100 aus drei Faktoren:
     Abstand des RSI zur neutralen 50er-Linie, Volumen-Ueberschuss gegenueber
     seinem Mittel, und die Spreizung der beiden EMAs relativ zum ATR.
     Rein fuer die Anzeige im HUD gedacht. */
  function confidence(rsiVal, volRatio, emaSpread, atrVal) {
    var rsiScore = clamp(Math.abs(rsiVal - 50) / 20, 0, 1);
    var volScore = clamp((volRatio - 1) / 1.2, 0, 1);
    var spreadScore = atrVal > 0 ? clamp(Math.abs(emaSpread) / (atrVal * 0.8), 0, 1) : 0;
    var raw = rsiScore * 0.34 + volScore * 0.33 + spreadScore * 0.33;
    /* Auf 55..97 abbilden: ein ausgeloestes Signal soll nie "10%" anzeigen. */
    return Math.round(55 + raw * 42);
  }

  /* Erzeugt die BUY/SELL-Signale.

     BUY  : EMA(fast) kreuzt EMA(slow) nach oben, RSI im gesunden Bereich
            (nicht bereits ueberkauft), Volumen ueber seinem Mittel.
     SELL : gespiegelt.

     Ein Cooldown von cfg.cooldown Kerzen verhindert Signal-Cluster, damit im
     Video jeder Marker fuer sich steht. */
  function generateSignals(candles, series, cfg) {
    var signals = [];
    var lastIndex = -Infinity;

    for (var i = 1; i < candles.length; i++) {
      var f = series.emaFast[i];
      var s = series.emaSlow[i];
      var pf = series.emaFast[i - 1];
      var ps = series.emaSlow[i - 1];
      var r = series.rsi[i];
      var a = series.atr[i];
      var vm = series.volMa[i];
      if (f == null || s == null || pf == null || ps == null || r == null || a == null || vm == null) continue;
      if (i - lastIndex < cfg.cooldown) continue;

      var volRatio = vm > 0 ? candles[i].volume / vm : 1;
      var volOk = volRatio >= cfg.volFactor;
      var crossUp = pf <= ps && f > s;
      var crossDown = pf >= ps && f < s;

      var side = null;
      if (crossUp && volOk && r >= cfg.rsiBuyMin && r <= cfg.rsiBuyMax) side = 'BUY';
      else if (crossDown && volOk && r <= cfg.rsiSellMax && r >= cfg.rsiSellMin) side = 'SELL';
      if (!side) continue;

      var entry = candles[i].close;
      var risk = a * cfg.atrStopMult;
      var reward = risk * cfg.riskReward;

      signals.push({
        index: i,
        time: candles[i].time,
        side: side,
        entry: entry,
        stop: side === 'BUY' ? entry - risk : entry + risk,
        target: side === 'BUY' ? entry + reward : entry - reward,
        rsi: r,
        atr: a,
        volRatio: volRatio,
        confidence: confidence(r, volRatio, f - s, a),
        result: null
      });
      lastIndex = i;
    }
    resolveOutcomes(candles, signals);
    return signals;
  }

  /* Bestimmt fuer jedes Signal, ob zuerst das Ziel oder der Stop getroffen
     wurde. Trifft eine Kerze beide Marken, wird konservativ der Stop
     gewertet. Ohne Treffer bleibt result null -- der Trade laeuft noch. */
  function resolveOutcomes(candles, signals) {
    for (var s = 0; s < signals.length; s++) {
      var sig = signals[s];
      for (var i = sig.index + 1; i < candles.length; i++) {
        var c = candles[i];
        var hitStop = sig.side === 'BUY' ? c.low <= sig.stop : c.high >= sig.stop;
        var hitTarget = sig.side === 'BUY' ? c.high >= sig.target : c.low <= sig.target;
        if (!hitStop && !hitTarget) continue;

        var type = hitStop ? 'SL' : 'TP';
        var price = hitStop ? sig.stop : sig.target;
        var raw = sig.side === 'BUY' ? (price - sig.entry) : (sig.entry - price);
        sig.result = {
          type: type,
          index: i,
          time: c.time,
          price: price,
          pct: (raw / sig.entry) * 100
        };
        break;
      }
      if (!sig.result) sig.result = null;
    }
  }

  global.TVI = {
    sma: sma,
    ema: ema,
    rsi: rsi,
    atr: atr,
    computeSeries: computeSeries,
    generateSignals: generateSignals,
    resolveOutcomes: resolveOutcomes
  };
})(window);
