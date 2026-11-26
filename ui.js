// User interface of the charging game. Rules live in engine.js; this file only draws and dispatches actions.
(function () {
  "use strict";
  const C = window.Charge;
  const $ = id => document.getElementById(id);
  const board = $("board");
  const LEVELS = ["warmup", "s1", "s2", "s3", "s4"];
  // canvas geometry: y-axis labels on the left, action area on top, plot below
  const X0 = 40, CW = 8, AY = 6, AH = 22, YT = 38, PH = 396, YB = YT + PH;

  let key = "warmup", seed = 1, inst = null, game = null, bench = null, lastI = -1;

  function readHash() {
    const m = /^#(warmup|s[1-4])-(\d+)$/.exec(location.hash);
    if (m) { key = m[1]; seed = Math.max(1, +m[2]); }
  }
  function writeHash() { try { history.replaceState(null, "", "#" + key + "-" + seed); } catch (e) { /* ignore */ } }

  function newGame() {
    inst = C.generate(key, seed);
    game = new C.Game(inst);
    bench = { greedy: C.play(inst, "greedy"), current: C.play(inst, "current") };
    lastI = -1;
    $("level").value = key; $("seed").value = seed;
    writeHash();
    render();
  }

  function start() { return game.pos; }
  function flash(t) { $("msg").textContent = t; }

  function act(name, shift) {
    if (!game || game.done) return;
    if (name === "left" || name === "right") {
      if (!game.legalActions().some(a => a[0] === name)) { flash("The block is at the edge of its window."); return; }
      game.step([name]);
    } else if (name === "down") {
      if (!game.fits(game.pos)) { flash("Over capacity here: move the block."); return; }
      game.step(["down"]);
    }
    render();
  }

  // ---------------------------------------------------------------- drawing
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const xs = j => X0 + j * CW;

  function render() {
    if (game.i !== lastI) lastI = game.i;
    const ctx = board.getContext("2d"), cap = inst.cap, rh = PH / cap;
    const col = { bg: css("--bg"), fg: css("--fg"), muted: css("--muted"), line: css("--line"), accent: css("--accent"),
                  accentFg: css("--accent-fg"), bad: css("--bad"), ok: css("--ok"), a: css("--cell-a"), b: css("--cell-b") };
    ctx.clearRect(0, 0, board.width, board.height);
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, board.width, board.height);
    const ev = game.ev;

    // forbidden columns (outside the EV's window) and the action area over the window
    if (ev) {
      ctx.globalAlpha = 0.14; ctx.fillStyle = col.bad;
      for (let j = 0; j < inst.T; j++) if (j < ev.a || j > ev.e) ctx.fillRect(xs(j), AY, CW, YB - AY);
      ctx.fillStyle = col.accent; ctx.globalAlpha = 0.12;
      ctx.fillRect(xs(ev.a), AY, (ev.e - ev.a + 1) * CW, AH);
      ctx.globalAlpha = 1;
    }
    // grid: one vertical line per hour, horizontal lines at the y ticks
    const tick = cap <= 40 ? 5 : 20;
    ctx.strokeStyle = col.line; ctx.lineWidth = 1;
    for (let j = 0; j <= inst.T; j += 4) { ctx.beginPath(); ctx.moveTo(xs(j) + 0.5, YT); ctx.lineTo(xs(j) + 0.5, YB); ctx.stroke(); }
    for (let v = tick; v < cap; v += tick) { const y = Math.round(YB - v * rh) + 0.5; ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(xs(inst.T), y); ctx.stroke(); }

    // placed charging, one unit per EV per slot; the last placed EV in the accent colour
    const lastId = game.i - 1;
    const gap = rh >= 4 ? 1 : 0;
    for (let j = 0; j < inst.T; j++) {
      const st = game.stacks[j];
      for (let k = 0; k < st.length; k++) {
        ctx.fillStyle = st[k] === lastId ? col.accent : (st[k] % 2 ? col.a : col.b);
        ctx.fillRect(xs(j) + 0.5, YB - (k + 1) * rh, CW - 1, Math.max(1, rh - gap));
      }
    }

    if (ev) {
      const s = start(), ok = game.fits(s);
      // where the block would land: one unit on top of each covered column
      ctx.globalAlpha = 0.5; ctx.fillStyle = ok ? col.accent : col.bad;
      for (let j = s; j < s + ev.l; j++) ctx.fillRect(xs(j) + 0.5, YB - (game.loads[j] + 1) * rh, CW - 1, Math.max(2, rh - gap));
      ctx.globalAlpha = 1;
      // feasible window, with arrival and departure marks
      ctx.strokeStyle = col.ok; ctx.lineWidth = 2;
      ctx.strokeRect(xs(ev.a) + 1, YT, (ev.e - ev.a + 1) * CW - 2, PH);
      ctx.fillStyle = col.ok;
      for (const x of [xs(ev.a), xs(ev.e + 1)]) {
        ctx.beginPath(); ctx.moveTo(x, YB - 1); ctx.lineTo(x - 5, YB + 8); ctx.lineTo(x + 5, YB + 8); ctx.closePath(); ctx.fill();
      }
      // the block in the action area
      ctx.fillStyle = ok ? col.accent : col.bad;
      ctx.fillRect(xs(s), AY, ev.l * CW, AH);
      if (ev.l * CW >= 34) {
        ctx.fillStyle = col.accentFg; ctx.font = "600 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("EV", xs(s) + ev.l * CW / 2, AY + AH / 2 + 1);
      }
    }

    // capacity (top of the plot), peak and valley of the current load
    ctx.strokeStyle = col.bad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X0, YT); ctx.lineTo(xs(inst.T), YT); ctx.stroke();
    const mx = Math.max(...game.loads), mn = Math.min(...game.loads);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = col.fg; ctx.lineWidth = 1;
    for (const v of mx === mn ? [mx] : [mx, mn]) {
      const y = Math.round(YB - v * rh) + 0.5;
      ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(xs(inst.T), y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // axes
    ctx.fillStyle = col.muted; ctx.font = "11px Inter, system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    for (let v = 0; v <= cap; v += tick) ctx.fillText(String(v), X0 - 5, YB - v * rh);
    if (cap % tick) ctx.fillText(String(cap), X0 - 5, YT);
    ctx.textAlign = "left"; ctx.fillStyle = col.bad;
    ctx.fillText("capacity " + cap, X0 + 4, YT + 9);
    ctx.fillStyle = col.fg; ctx.textAlign = "right";
    ctx.fillText("max " + mx, xs(inst.T) - 2, Math.round(YB - mx * rh) - 7);
    if (mx !== mn) ctx.fillText("min " + mn, xs(inst.T) - 2, Math.round(YB - mn * rh) - 7);
    ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let j = 0; j <= inst.T; j += 16) ctx.fillText(C.slotClock(j), Math.min(Math.max(xs(j), X0 + 14), xs(inst.T) - 14), YB + 12);
    ctx.textAlign = "left"; ctx.fillText("EVs", 2, YT - 14);

    panel();
  }

  function fmtDur(l) { const m = 15 * l; return ((m >= 60 ? Math.floor(m / 60) + " h " : "") + (m % 60 ? (m % 60) + " min" : "")).trim(); }
  function fmtBench(g) {
    if (g.failed) return "overload at EV " + (g.i + 1);
    const sc = C.score(inst, g.starts);
    return sc.maxMin + " / " + sc.rmse.toFixed(2);
  }

  function panel() {
    const n = inst.evs.length, ev = game.ev, sc = C.score(inst, game.starts);
    $("s-ev").textContent = game.done ? (game.failed ? (game.i + 1) + " / " + n : n + " / " + n) : (game.i + 1) + " / " + n;
    $("s-mm").textContent = sc.maxMin;
    $("s-peak").textContent = sc.peak + " (capacity " + inst.cap + ")";
    $("s-rmse").textContent = sc.rmse.toFixed(2);
    $("s-rew").textContent = (game.rewardSum > 0 ? "+" : "") + game.rewardSum;
    $("s-greedy").textContent = fmtBench(bench.greedy);
    $("s-current").textContent = fmtBench(bench.current);
    if (ev) {
      const s = start(), ok = game.fits(s);
      if (ok) {
        const p = game.preview(s);
        $("s-prev").textContent = "Max-Min " + p.maxMin + ", reward " + (p.reward > 0 ? "+1" : p.reward < 0 ? "-1" : "0");
      } else $("s-prev").textContent = "over capacity";
      $("s-moves").textContent = String(game.maxMoves - game.moves);
      $("ev").textContent = `EV ${game.i + 1} of ${n}: arrives ${C.timeClock(ev.arrival)}, leaves ${C.timeClock(ev.departure)}, ` +
        `needs ${fmtDur(ev.l)}. Charging ${C.slotClock(s)} to ${C.slotClock(s + ev.l)}.`;
      flash("Arrow keys shift the block; down arrow, Space or Enter drop it.");
    } else {
      $("s-prev").textContent = "-"; $("s-moves").textContent = "-";
      $("ev").textContent = "";
      if (game.failed) flash(`Overload: EV ${game.i + 1} cannot be charged without exceeding the capacity. Game over. R to restart.`);
      else {
        const gr = C.score(inst, bench.greedy.starts).maxMin;
        const cmp = sc.maxMin < gr ? "better than" : sc.maxMin === gr ? "equal to" : "worse than";
        flash(`Done. Your Max-Min is ${sc.maxMin}, ${cmp} Greedy (${gr}). R to replay, N for a new seed.`);
      }
    }
  }

  // ---------------------------------------------------------------- input
  document.addEventListener("keydown", ev => {
    const tag = ev.target.tagName;
    if (tag === "INPUT" || tag === "SELECT") { if (ev.key === "Escape") ev.target.blur(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", " ": "down", Enter: "down" };
    if (map[k]) {
      if (tag === "BUTTON" && (k === " " || k === "Enter")) return;   // let a focused button act
      ev.preventDefault(); act(map[k], ev.shiftKey); return;
    }
    if (k === "r" || k === "R") newGame();
    else if (k === "n" || k === "N") { seed += 1; newGame(); }
    else if (k >= "1" && k <= String(LEVELS.length)) { key = LEVELS[+k - 1]; newGame(); }
  });

  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act, false)));
  $("restart").addEventListener("click", newGame);
  $("newseed").addEventListener("click", () => { seed += 1; newGame(); });
  $("level").addEventListener("change", () => { key = $("level").value; newGame(); $("level").blur(); });
  $("seed").addEventListener("change", () => { seed = Math.max(1, Math.floor(+$("seed").value) || 1); newGame(); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => game && render());

  $("level").innerHTML = LEVELS.map((k, i) => {
    const sc = C.SCENARIOS[k];
    return `<option value="${k}">${i + 1}. ${sc.name} (${sc.n} EVs)</option>`;
  }).join("");
  readHash();
  newGame();
})();
