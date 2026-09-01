/* Canvas-Renderer: Kerzen, EMAs, Volumen, RSI und die BUY/SELL-Marker. */
(function (global) {
  'use strict';

  var AXIS_W = 86;   /* Preisachse rechts */
  var TIME_H = 26;   /* Zeitachse unten */
  var GAP = 10;      /* Abstand zwischen den Panels */

  function fmtPrice(v) {
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTime(ms) {
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function Chart(canvas, cfg) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = cfg;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
  }

  /* Passt das Canvas an seine CSS-Groesse an. Der Backing-Store wird mit
     devicePixelRatio skaliert, sonst ist auf Retina-Displays alles unscharf --
     und unscharf faellt in einer Videoaufnahme sofort auf. */
  Chart.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (this.w === w && this.h === h && this.dpr === dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* Teilt die Flaeche in Preis-, Volumen- und RSI-Panel auf. */
  Chart.prototype.layout = function () {
    var top = 12;
    var usable = this.h - top - TIME_H - GAP * 2;
    var volH = Math.round(usable * 0.13);
    var rsiH = Math.round(usable * 0.16);
    var priceH = usable - volH - rsiH;
    return {
      plotW: this.w - AXIS_W,
      price: { y: top, h: priceH },
      vol: { y: top + priceH + GAP, h: volH },
      rsi: { y: top + priceH + GAP + volH + GAP, h: rsiH },
      timeY: this.h - TIME_H
    };
  };

  Chart.prototype.render = function (state) {
    var ctx = this.ctx;
    var c = this.cfg;
    var L = this.layout();
    var view = state.candles.slice(state.viewStart, state.viewEnd);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!view.length) return;

    /* --- Skalen ------------------------------------------------------- */
    var hi = -Infinity, lo = Infinity, volMax = 0;
    for (var i = 0; i < view.length; i++) {
      if (view[i].high > hi) hi = view[i].high;
      if (view[i].low < lo) lo = view[i].low;
      if (view[i].volume > volMax) volMax = view[i].volume;
    }
    var pad = (hi - lo) * 0.08 || 1;
    hi += pad;
    lo -= pad;

    var n = view.length;
    var stepX = L.plotW / n;
    var bodyW = Math.max(1, Math.min(14, stepX * 0.62));

    function xAt(idx) { return (idx + 0.5) * stepX; }
    function yPrice(p) { return L.price.y + (hi - p) / (hi - lo) * L.price.h; }
    function yVol(v) { return L.vol.y + L.vol.h - (volMax ? v / volMax : 0) * L.vol.h; }
    function yRsi(r) { return L.rsi.y + (100 - r) / 100 * L.rsi.h; }

    this._geom = { xAt: xAt, yPrice: yPrice, stepX: stepX, plotW: L.plotW, price: L.price, hi: hi, lo: lo };

    /* --- Grid und Achsen ---------------------------------------------- */
    ctx.font = '11px ' + c.font;
    ctx.textBaseline = 'middle';

    var lastCandle = view[n - 1];
    var lastY = Math.round(yPrice(lastCandle.close)) + 0.5;

    var ticks = 6;
    for (var t = 0; t <= ticks; t++) {
      var p = lo + (hi - lo) * (t / ticks);
      var y = Math.round(yPrice(p)) + 0.5;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(L.plotW, y);
      ctx.stroke();
      /* Achsenbeschriftung auslassen, wo gleich das Kursfaehnchen sitzt. */
      if (Math.abs(y - lastY) < 17) continue;
      ctx.fillStyle = c.textDim;
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(p), L.plotW + 10, y);
    }

    /* Senkrechte Linien und Zeitmarken in gleichmaessigen Abstaenden. */
    var vStep = Math.max(1, Math.round(n / 8));
    ctx.textAlign = 'center';
    for (var k = n - 1; k >= 0; k -= vStep) {
      var vx = Math.round(xAt(k)) + 0.5;
      ctx.strokeStyle = c.grid;
      ctx.beginPath();
      ctx.moveTo(vx, L.price.y);
      ctx.lineTo(vx, L.rsi.y + L.rsi.h);
      ctx.stroke();
      ctx.fillStyle = c.textDim;
      ctx.fillText(fmtTime(view[k].time), vx, L.timeY + 10);
    }

    /* --- Volumen ------------------------------------------------------- */
    for (var v = 0; v < n; v++) {
      var cd = view[v];
      var up = cd.close >= cd.open;
      ctx.fillStyle = up ? c.buyFaint : c.sellFaint;
      var vy = yVol(cd.volume);
      ctx.fillRect(xAt(v) - bodyW / 2, vy, bodyW, L.vol.y + L.vol.h - vy);
    }

    /* --- Kerzen -------------------------------------------------------- */
    for (var j = 0; j < n; j++) {
      var d = view[j];
      var bull = d.close >= d.open;
      var col = bull ? c.buy : c.sell;
      var x = xAt(j);
      var wickX = Math.round(x) + 0.5;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wickX, yPrice(d.high));
      ctx.lineTo(wickX, yPrice(d.low));
      ctx.stroke();

      var yo = yPrice(d.open);
      var yc = yPrice(d.close);
      var top = Math.min(yo, yc);
      var hgt = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(hgt));
    }

    /* --- EMA-Linien ---------------------------------------------------- */
    function line(series, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var started = false;
      for (var i2 = 0; i2 < n; i2++) {
        var val = series[state.viewStart + i2];
        if (val == null) { started = false; continue; }
        var px = xAt(i2), py = yPrice(val);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    line(state.series.emaTrend, c.emaTrend, 1);
    line(state.series.emaSlow, c.emaSlow, 1.4);
    line(state.series.emaFast, c.emaFast, 1.4);

    /* --- RSI ----------------------------------------------------------- */
    ctx.save();
    ctx.strokeStyle = c.grid;
    ctx.setLineDash([3, 4]);
    [30, 70].forEach(function (lvl) {
      var ly = Math.round(yRsi(lvl)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(L.plotW, ly);
      ctx.stroke();
    });
    ctx.restore();

    ctx.strokeStyle = c.rsiLine;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    var rStarted = false;
    for (var r = 0; r < n; r++) {
      var rv = state.series.rsi[state.viewStart + r];
      if (rv == null) { rStarted = false; continue; }
      var rx = xAt(r), ry = yRsi(rv);
      if (!rStarted) { ctx.moveTo(rx, ry); rStarted = true; } else ctx.lineTo(rx, ry);
    }
    ctx.stroke();

    ctx.fillStyle = c.textDim;
    ctx.textAlign = 'right';
    ctx.font = '10px ' + c.font;
    ctx.fillText('70', L.plotW - 6, yRsi(70));
    ctx.fillText('30', L.plotW - 6, yRsi(30));
    ctx.font = '11px ' + c.font;
    ctx.textAlign = 'left';
    ctx.fillText('RSI 14', 8, L.rsi.y + 10);
    ctx.fillText('VOL', 8, L.vol.y + 10);

    /* --- Aktueller Preis ------------------------------------------------ */
    var last = lastCandle;
    var lastCol = last.close >= last.open ? c.buy : c.sell;
    ctx.save();
    ctx.strokeStyle = lastCol;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, lastY);
    ctx.lineTo(L.plotW, lastY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = lastCol;
    ctx.fillRect(L.plotW + 4, lastY - 9, AXIS_W - 8, 18);
    ctx.fillStyle = c.bg;
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px ' + c.font;
    ctx.fillText(fmtPrice(last.close), L.plotW + 10, lastY);

    /* --- Signale --------------------------------------------------------- */
    var visible = state.signals.filter(function (s) {
      return s.index >= state.viewStart && s.index < state.viewEnd;
    });
    for (var m = 0; m < visible.length; m++) {
      this._drawSignal(visible[m], state, xAt, yPrice, L, m === visible.length - 1);
    }
  };

  /* Zeichnet einen einzelnen BUY/SELL-Marker: Pfeil, Beschriftung und -- fuer
     das juengste Signal -- die gestrichelten Stop-/Ziel-Linien. */
  Chart.prototype._drawSignal = function (sig, state, xAt, yPrice, L, isLatest) {
    var ctx = this.ctx;
    var c = this.cfg;
    var buy = sig.side === 'BUY';
    var col = buy ? c.buy : c.sell;
    var candle = state.candles[sig.index];
    var x = xAt(sig.index - state.viewStart);
    var anchor = buy ? yPrice(candle.low) + 14 : yPrice(candle.high) - 14;
    var dir = buy ? 1 : -1;

    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;

    /* Pfeil, der auf die Kerze zeigt. */
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, anchor - 9 * dir);
    ctx.lineTo(x - 7, anchor + 4 * dir);
    ctx.lineTo(x + 7, anchor + 4 * dir);
    ctx.closePath();
    ctx.fill();

    /* Beschriftung mit Richtung und Einstiegspreis. */
    var label = sig.side + '  ' + fmtPrice(sig.entry);
    ctx.font = 'bold 11px ' + c.font;
    var tw = ctx.measureText(label).width;
    var bw = tw + 16;
    var bh = 19;
    var bx = Math.max(2, Math.min(L.plotW - bw - 2, x - bw / 2));
    var by = buy ? anchor + 8 : anchor - 8 - bh;

    ctx.shadowBlur = 10;
    ctx.fillStyle = buy ? c.buyBg : c.sellBg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = col;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 8, by + bh / 2 + 0.5);
    ctx.restore();

    /* Senkrechte Markierung durch das Preis-Panel. */
    ctx.save();
    ctx.strokeStyle = buy ? c.buyFaint : c.sellFaint;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, L.price.y);
    ctx.lineTo(Math.round(x) + 0.5, L.price.y + L.price.h);
    ctx.stroke();
    ctx.restore();

    /* Ausstiegsmarke fuer jeden abgeschlossenen Trade -- so ist auf einen Blick
       zu sehen, welche Signale aufgegangen sind. */
    var res = sig.result;
    var exitVisible = res && res.index >= state.viewStart && res.index < state.viewEnd;
    if (exitVisible) {
      var ex = xAt(res.index - state.viewStart);
      var ey = yPrice(res.price);
      var ecol = res.type === 'TP' ? c.buy : c.sell;
      ctx.save();
      ctx.strokeStyle = ecol;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5);
      ctx.moveTo(ex + 5, ey - 5); ctx.lineTo(ex - 5, ey + 5);
      ctx.stroke();
      ctx.font = 'bold 10px ' + c.font;
      var etxt = res.type + ' ' + (res.pct >= 0 ? '+' : '') + res.pct.toFixed(2) + '%';
      var etw = ctx.measureText(etxt).width;
      ctx.fillStyle = c.bg;
      ctx.fillRect(ex + 7, ey - 7, etw + 6, 14);
      ctx.fillStyle = ecol;
      ctx.textAlign = 'left';
      ctx.fillText(etxt, ex + 10, ey);
      ctx.restore();
    }

    if (!isLatest) return;

    /* Stop-Loss und Take-Profit nur fuer das juengste Signal -- sonst wird
       der Chart bei vielen Signalen unleserlich. */
    var levels = [
      { p: sig.target, col: c.buy, txt: 'TP ' + fmtPrice(sig.target) },
      { p: sig.stop, col: c.sell, txt: 'SL ' + fmtPrice(sig.stop) }
    ];
    /* Die Linien enden am Ausstieg, sofern der schon sichtbar ist -- so zeigt
       der Chart, wie lange der Trade lief, statt bis zum Rand zu laufen. */
    var xEnd = exitVisible ? xAt(res.index - state.viewStart) : L.plotW;

    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.font = '10px ' + c.font;
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      var y = yPrice(lv.p);
      if (y < L.price.y || y > L.price.y + L.price.h) continue;
      y = Math.round(y) + 0.5;
      ctx.strokeStyle = lv.col;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      /* Beschriftung rechtsbuendig kurz vor dem Linienende, auf eigenem
         Hintergrund -- sonst laeuft sie in Kerzen oder in die Ausstiegsmarke. */
      var tw2 = ctx.measureText(lv.txt).width;
      if (xEnd - x > tw2 + 26) {
        var tx = xEnd - 12;
        ctx.setLineDash([]);
        ctx.fillStyle = c.bg;
        ctx.fillRect(tx - tw2 - 4, y - 15, tw2 + 8, 13);
        ctx.fillStyle = lv.col;
        ctx.textAlign = 'right';
        ctx.fillText(lv.txt, tx, y - 8);
        ctx.setLineDash([6, 5]);
      }
    }

    ctx.restore();
  };

  global.TVChart = Chart;
})(window);
