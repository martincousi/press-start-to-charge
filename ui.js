// User interface of the charging game. Rules live in engine.js; this file only draws and dispatches actions.
(function () {
  "use strict";
  const C = window.Charge, P = window.PaperResults;
  const $ = id => document.getElementById(id);
  const board = $("board");
  const LEVELS = ["warmup", "s1", "s2", "s3", "s4"];
  const BENCH = ["current", "greedy", "rowfill", "alpha", "beta"];   // reference heuristics, in the order of the grid
  // Colours of the references in the stats grid, the overlay and the replays (Okabe-Ito, in the conventional order
  // of use after the optimum's #0072B2, which this game does not have: no optimum is computed per instance).
  const REF_COLOR = { current: "#E69F00", greedy: "#CC79A7", rowfill: "#009E73", alpha: "#56B4E9", beta: "#D55E00" };
  const SPEEDS = [1, 2, 5, 10, 20, 50];                              // replay speeds, EVs per second
  // Canvas geometry, in logical pixels (the canvas is drawn at the screen's resolution and scaled):
  // y-axis labels on the left, action area on top, plot below. When the vertical axis stops below the
  // capacity, a compressed band of height BAND above the plot covers the rest, up to the capacity.
  const W = 820, H = 580, X0 = 40, CW = 8, AY = 4, AH = 26, YT = 40, YB = H - 34, BAND = 40;

  let key = "warmup", seed = 1, inst = null, game = null, bench = null, scale = null;
  let mode = "play", rp = null, speedIx = 2;
  let refsOn = false;                                                  // references overlay shown
  const refSel = { current: true, greedy: true, rowfill: true, alpha: true, beta: true };   // lines in the overlay

  function readHash() {
    const m = /^#(warmup|s[1-4])-(\d+)$/.exec(location.hash);
    if (m) { key = m[1]; seed = Math.max(1, +m[2]); }
  }
  function writeHash() { try { history.replaceState(null, "", "#" + key + "-" + seed); } catch (e) { /* ignore */ } }

  function newGame() {
    stopReplay(); mode = "play"; refsOn = false;
    inst = C.generate(key, seed);
    game = new C.Game(inst);
    bench = {};
    for (const p of BENCH) bench[p] = C.play(inst, p);
    scale = makeScale(inst, bench);
    $("level").value = key; $("seed").value = seed;
    writeHash();
    benchList(); paperTable();
    render();
  }

  // Vertical scale, fixed for the whole instance. The axis runs from 0 to ymax: the highest peak of the
  // benchmark heuristics on this instance (current practice excluded) plus 15 %, rounded up to a multiple
  // of 5. Loads above ymax, up to the capacity, are drawn in a compressed band at the top, so the
  // capacity line stays on the board. If ymax would be close to the capacity (or the capacity is small,
  // as in the warm-up), the axis runs to the capacity, without a band.
  function makeScale(inst, bench) {
    const cap = inst.cap;
    let top = 0;
    for (const p of BENCH) if (p !== "current") top = Math.max(top, ...bench[p].loads);
    const ymax = Math.max(10, 5 * Math.ceil(1.15 * top / 5));
    if (cap <= 40 || ymax >= 0.75 * cap) {
      const rh = (YB - YT) / cap;
      return { ymax: cap, band: false, rh, ym: YT, y: v => YB - v * rh };
    }
    const ym = YT + BAND, rh = (YB - ym) / ymax, bh = BAND / (cap - ymax);
    return { ymax, band: true, rh, ym, y: v => v <= ymax ? YB - v * rh : ym - (v - ymax) * bh };
  }

  function flash(t) { $("msg").textContent = t; }

  function act(name) {
    if (!game || game.done || mode !== "play") return;
    if (name === "left" || name === "right") {
      if (!game.legalActions().some(a => a[0] === name)) { flash("The block is at the edge of its window."); return; }
      game.step([name]);
    } else if (name === "down") {
      if (!game.fits(game.pos)) { flash("Over capacity here: move the block."); return; }
      game.step(["down"]);
    }
    render();
  }

  // ---------------------------------------------------------------- references overlay
  // Replays and references work at any time, also during a game (they show the EVs still to come; the owner
  // chose this for class use). They do not change the game: closing or hiding them returns to it as it was.
  function toggleRefs() { refsOn = !refsOn; render(); }
  // a row of the references grid shows or hides that reference's line (and opens the overlay if it is closed)
  function toggleRef(p) {
    if (!refsOn) { refSel[p] = true; refsOn = true; } else refSel[p] = !refSel[p];
    render();
  }

  // ---------------------------------------------------------------- replays
  // A replay re-steps recorded actions through the engine (C.Replay): your moves so far, or a reference's
  // schedule. Frame k shows the board after k EVs, with EV k arriving at the start the policy gives it.
  const CHOICES = ["you"].concat(BENCH);
  function policyName(p) { return p === "you" ? "Your game" : C.POLICY_NAMES[p]; }
  function toggleWatch() { if (mode === "replay") closeReplay(); else openReplay(); }

  function openReplay(policy) {
    mode = "replay";
    if (!policy) policy = rp ? rp.policy : (game.done ? "you" : "greedy");
    $("rp-watch").innerHTML = CHOICES.map(p => `<option value="${p}">Watch: ${policyName(p)}</option>`).join("");
    loadReplay(policy);
    $("rp-play").focus();   // Space then plays (a focused "Watch replays" button would otherwise take it)
  }
  function loadReplay(policy) {
    stopReplay();
    const actions = policy === "you" ? game.history : bench[policy].history;
    const R = new C.Replay(inst, actions);
    rp = { policy, R, k: 0, g: R.gameAt(0), playing: false, timer: null };
    $("rp-watch").value = policy;
    $("rp-scrub").max = String(R.placed);
    render();
  }
  function seek(k) {
    if (!rp) return;
    k = Math.max(0, Math.min(rp.R.placed, k));
    if (k === rp.k + 1) {                        // one EV forward: step the engine on
      for (let t = rp.R.cut[rp.k]; t < rp.R.cut[k]; t++) rp.g.step(rp.R.actions[t]);
    } else if (k !== rp.k) rp.g = rp.R.gameAt(k);
    rp.k = k;
    render();
  }
  function tick() {
    if (!rp || !rp.playing) return;
    if (rp.k >= rp.R.placed) { pause(); return; }
    seek(rp.k + 1);
    rp.timer = setTimeout(tick, 1000 / SPEEDS[speedIx]);
  }
  function play() {
    if (!rp) return;
    if (rp.k >= rp.R.placed) seek(0);
    rp.playing = true; clearTimeout(rp.timer);
    rp.timer = setTimeout(tick, 1000 / SPEEDS[speedIx]);
    render();
  }
  function pause() { if (rp) { rp.playing = false; clearTimeout(rp.timer); } render(); }
  function stopReplay() { if (rp) { rp.playing = false; clearTimeout(rp.timer); } }
  function toggle() { if (rp && rp.playing) pause(); else play(); }
  function setSpeed(ix) {
    speedIx = Math.max(0, Math.min(SPEEDS.length - 1, ix));
    $("rp-speed").value = String(speedIx);
    if (rp && rp.playing) { clearTimeout(rp.timer); rp.timer = setTimeout(tick, 1000 / SPEEDS[speedIx]); }
  }
  function cyclePolicy(d) {
    const i = CHOICES.indexOf(rp.policy);
    loadReplay(CHOICES[(i + d + CHOICES.length) % CHOICES.length]);
  }
  function closeReplay() { stopReplay(); mode = "play"; render(); }

  // ---------------------------------------------------------------- drawing
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const xs = j => X0 + j * CW;

  // What the board shows: the player's game, or the replay at frame k.
  function view() {
    if (mode === "replay" && rp) {
      const R = rp.R, k = rp.k, ev = k < R.placed ? inst.evs[k] : null;
      return { g: rp.g, ev, pos: ev ? R.starts[k] : null };
    }
    return { g: game, ev: game.ev, pos: game.pos };
  }

  function fitCanvas(ctx) {   // draw at the screen's resolution, in W x H logical coordinates
    const dpr = window.devicePixelRatio || 1, cssW = board.clientWidth || W;
    const bw = Math.max(1, Math.round(cssW * dpr)), bh = Math.max(1, Math.round(cssW * dpr * H / W));
    if (board.width !== bw || board.height !== bh) { board.width = bw; board.height = bh; }
    ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
  }

  function render() {
    const ctx = board.getContext("2d"), cap = inst.cap, S = scale, y = S.y, rh = S.rh;
    fitCanvas(ctx);
    const col = { bg: css("--bg"), fg: css("--fg"), muted: css("--muted"), line: css("--line"), accent: css("--accent"),
                  accentFg: css("--accent-fg"), bad: css("--bad"), ok: css("--ok"), cell: css("--cell"),
                  surface: css("--surface") };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
    const { g, ev, pos } = view();

    // compressed band between ymax and the capacity
    if (S.band) {
      ctx.fillStyle = col.surface; ctx.fillRect(X0, YT, xs(inst.T) - X0, S.ym - YT);
    }
    // forbidden columns (outside the EV's window) and the action area over the window
    if (ev) {
      ctx.globalAlpha = 0.14; ctx.fillStyle = col.bad;
      for (let j = 0; j < inst.T; j++) if (j < ev.a || j > ev.e) ctx.fillRect(xs(j), AY, CW, YB - AY);
      ctx.fillStyle = col.accent; ctx.globalAlpha = 0.12;
      ctx.fillRect(xs(ev.a), AY, (ev.e - ev.a + 1) * CW, AH);
      ctx.globalAlpha = 1;
    }
    // grid: one vertical line per hour, horizontal lines at the y ticks
    const tick = S.ymax <= 40 ? 5 : S.ymax <= 100 ? 10 : 20;
    ctx.strokeStyle = col.line; ctx.lineWidth = 1;
    for (let j = 0; j <= inst.T; j += 4) { ctx.beginPath(); ctx.moveTo(xs(j) + 0.5, YT); ctx.lineTo(xs(j) + 0.5, YB); ctx.stroke(); }
    for (let v = tick; v < S.ymax; v += tick) { const yy = Math.round(y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(X0, yy); ctx.lineTo(xs(inst.T), yy); ctx.stroke(); }
    if (S.band) { ctx.strokeStyle = col.muted; ctx.beginPath(); ctx.moveTo(X0, S.ym + 0.5); ctx.lineTo(xs(inst.T), S.ym + 0.5); ctx.stroke(); }

    // placed charging, one unit per EV per slot, all in one neutral colour; only the EV placed last (in a
    // replay: the EV just placed) is in the accent colour. In the compressed band the units have no gaps.
    const lastId = g.i - 1, gap = rh >= 4 ? 1 : 0;
    for (let j = 0; j < inst.T; j++) {
      const st = g.stacks[j];
      for (let k = 0; k < st.length; k++) {
        const inBand = S.band && k >= S.ymax, last = st[k] === lastId;
        ctx.fillStyle = last ? col.accent : col.cell;
        const top = y(k + 1), h = y(k) - top;
        if (inBand) ctx.fillRect(xs(j) + 0.5, top, CW - 1, last ? Math.max(2, h) : h);
        else ctx.fillRect(xs(j) + 0.5, top, CW - 1, Math.max(1, h - gap));
      }
    }

    if (ev) {
      const s = pos, ok = g.fits(s);
      // where the block would land: one unit on top of each covered column
      ctx.globalAlpha = 0.5; ctx.fillStyle = ok ? col.accent : col.bad;
      for (let j = s; j < s + ev.l; j++) {
        const top = y(g.loads[j] + 1);
        ctx.fillRect(xs(j) + 0.5, top, CW - 1, Math.max(2, y(g.loads[j]) - top - gap));
      }
      ctx.globalAlpha = 1;
      // feasible window, with arrival and departure marks
      ctx.strokeStyle = col.ok; ctx.lineWidth = 2;
      ctx.strokeRect(xs(ev.a) + 1, YT, (ev.e - ev.a + 1) * CW - 2, YB - YT);
      ctx.fillStyle = col.ok;
      for (const x of [xs(ev.a), xs(ev.e + 1)]) {
        ctx.beginPath(); ctx.moveTo(x, YB - 1); ctx.lineTo(x - 5, YB + 8); ctx.lineTo(x + 5, YB + 8); ctx.closePath(); ctx.fill();
      }
      // the block in the action area: one unit tall, as on the board
      const bh = Math.min(AH - 4, rh), by = AY + (AH - bh) / 2;
      ctx.fillStyle = ok ? col.accent : col.bad;
      ctx.fillRect(xs(s), by, ev.l * CW, bh);
      if (ev.l * CW >= 34 && bh >= 12) {
        ctx.fillStyle = col.accentFg; ctx.font = "600 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("EV", xs(s) + ev.l * CW / 2, by + bh / 2 + 1);
      }
    }

    // capacity (top of the plot), peak and valley of the current load
    ctx.strokeStyle = col.bad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X0, YT); ctx.lineTo(xs(inst.T), YT); ctx.stroke();
    const mx = Math.max(...g.loads), mn = Math.min(...g.loads);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = col.fg; ctx.lineWidth = 1;
    for (const v of mx === mn ? [mx] : [mx, mn]) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(X0, yy); ctx.lineTo(xs(inst.T), yy); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (refsOn) drawRefs(ctx, col);

    // axes: ticks up to ymax; the capacity at the top; a zigzag where the axis is compressed
    ctx.fillStyle = col.muted; ctx.font = "11px Inter, system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    for (let v = 0; v <= S.ymax; v += tick) ctx.fillText(String(v), X0 - 5, y(v));
    if (!S.band && cap % tick) ctx.fillText(String(cap), X0 - 5, YT);
    if (S.band) {
      if (S.ymax % tick) ctx.fillText(String(S.ymax), X0 - 5, S.ym);
      ctx.fillStyle = col.bad; ctx.fillText(String(cap), X0 - 5, YT + 1);
      ctx.strokeStyle = col.muted; ctx.lineWidth = 1.5; ctx.beginPath();
      const zy = S.ym - 9;
      ctx.moveTo(X0, zy - 8); ctx.lineTo(X0 - 4, zy - 5); ctx.lineTo(X0 + 4, zy - 1); ctx.lineTo(X0 - 4, zy + 3); ctx.lineTo(X0, zy + 6);
      ctx.stroke();
      ctx.fillStyle = col.muted; ctx.textAlign = "left";
      boxText(ctx, `compressed: ${S.ymax} to ${cap}`, X0 + 6, (YT + S.ym) / 2 + 5, col.surface);
    }
    // labels in the band: "compressed" on the left and "capacity" on the right, where current practice (the only
    // reference that goes above ymax) is low, so that they rarely hide its line in the band
    ctx.textAlign = "left"; ctx.fillStyle = col.bad;
    const capText = "capacity " + cap, capW = ctx.measureText(capText).width;
    if (S.band) boxText(ctx, capText, xs(inst.T) - 6 - capW, (YT + S.ym) / 2 + 5, col.surface);
    else ctx.fillText(capText, X0 + 4, YT + 9);
    ctx.fillStyle = col.fg; ctx.textAlign = "right";
    // the replay's name sits at the top right of the plot, under the band: the max label moves left of it if needed
    const rpText = mode === "replay" && rp ? "Watching: " + policyName(rp.policy) : null, rpY = S.ym + (S.band ? 14 : 26);
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    const rpW = rpText ? ctx.measureText(rpText).width : 0;
    ctx.font = "11px Inter, system-ui, sans-serif";
    const maxY = Math.round(y(mx)) - 7;
    ctx.fillText("max " + mx, xs(inst.T) - 2 - (S.band && mx > S.ymax ? capW + 14 : rpText && Math.abs(maxY - rpY) < 16 ? rpW + 14 : 0), maxY);
    if (mx !== mn) ctx.fillText("min " + mn, xs(inst.T) - 2, Math.round(y(mn)) - 7);
    ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let j = 0; j <= inst.T; j += 16) ctx.fillText(C.slotClock(j), Math.min(Math.max(xs(j), X0 + 14), xs(inst.T) - 14), YB + 12);
    ctx.textAlign = "left"; ctx.fillText("EVs", 2, YT - 14);
    if (rpText) {   // top right of the plot: late in the morning the load is low for every policy
      ctx.textAlign = "left"; ctx.fillStyle = col.accent; ctx.font = "600 13px Inter, system-ui, sans-serif";
      boxText(ctx, rpText, xs(inst.T) - 6 - rpW, rpY, col.bg);
    }

    panel();
  }

  // References: the load each heuristic ends the day with, as a step line on the same (compressed) scale as the
  // board: y() is the board's own mapping, so a line above ymax lies in the grey band exactly where a bar of that
  // load ends. A halo in the background colour under every line keeps the lines readable over the bars.
  function refPath(ctx, loads) {
    ctx.beginPath();
    for (let j = 0; j < inst.T; j++) {
      const yy = scale.y(loads[j]);
      if (j === 0) ctx.moveTo(xs(0), yy); else ctx.lineTo(xs(j), yy);
      ctx.lineTo(xs(j + 1), yy);
    }
  }
  function drawRefs(ctx, col) {
    const shown = BENCH.filter(p => refSel[p]);
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col.bg; ctx.lineWidth = 5;
    for (const p of shown) { refPath(ctx, bench[p].loads); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineWidth = 2;
    for (const p of shown) { ctx.strokeStyle = REF_COLOR[p]; refPath(ctx, bench[p].loads); ctx.stroke(); }
  }

  // left-aligned text on a small box of the background colour, so that the dashed max line does not cross it
  function boxText(ctx, text, x, y, bg) {
    const fill = ctx.fillStyle, w = ctx.measureText(text).width;
    ctx.fillStyle = bg; ctx.fillRect(x - 3, y - 8, w + 6, 16);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  function fmtDur(l) { const m = 15 * l; return ((m >= 60 ? Math.floor(m / 60) + " h " : "") + (m % 60 ? (m % 60) + " min" : "")).trim(); }
  const fmtR = r => (r > 0 ? "+" : "") + r;
  function fmtBench(g) {
    if (g.failed) return "overload at EV " + (g.i + 1);
    const sc = C.score(inst, g.starts);
    return sc.maxMin + " / " + sc.rmse.toFixed(2);
  }

  function benchList() {
    $("bench").innerHTML = `<span></span><span class="head">Max-Min / RMSE</span>` + BENCH.map(p =>
      `<button class="ref" id="n-${p}" aria-pressed="true" title="Show or hide this line on the board">` +
      `<span class="sw" style="background:${REF_COLOR[p]};border-color:${REF_COLOR[p]}"></span>${C.POLICY_NAMES[p]}</button>` +
      `<b id="s-${p}">-</b>`).join("");
    for (const p of BENCH) $("n-" + p).addEventListener("click", () => toggleRef(p));
  }

  function panel() {
    const n = inst.evs.length, ev = game.ev, sc = C.score(inst, game.starts), inReplay = mode === "replay" && rp;
    $("s-mm").textContent = sc.maxMin;
    $("s-peak").textContent = sc.peak + " (capacity " + inst.cap + ")";
    $("s-rmse").textContent = sc.rmse.toFixed(2);
    $("s-rew").textContent = fmtR(game.rewardSum);
    $("s-ev").textContent = game.failed ? `${game.i + 1} of ${n} (overload)` : `${game.done ? n : game.i + 1} of ${n}`;
    $("s-moves").textContent = ev ? String(game.maxMoves - game.moves) : "-";
    for (const p of BENCH) {
      $("s-" + p).textContent = fmtBench(bench[p]);
      const on = !!(inReplay && rp.policy === p);
      $("s-" + p).classList.toggle("on", on); $("n-" + p).classList.toggle("on", on);
      $("n-" + p).setAttribute("aria-pressed", String(refSel[p]));
    }
    $("watch").setAttribute("aria-expanded", String(mode === "replay"));
    $("refs").textContent = refsOn ? "Hide references" : "Show references";
    $("refs").setAttribute("aria-pressed", String(refsOn));
    $("refs").title = refsOn ? "Hide references (O)" : "Show references (O): the load each reference heuristic ends the day with";
    $("pad").hidden = mode === "replay"; $("replay-bar").hidden = mode !== "replay";

    if (inReplay) { replayPanel(); return; }
    if (ev) {
      const s = game.pos;
      $("ev").textContent = `EV ${game.i + 1} of ${n}: arrives ${C.timeClock(ev.arrival)}, leaves ${C.timeClock(ev.departure)}, ` +
        `needs ${fmtDur(ev.l)}. Charging ${C.slotClock(s)} to ${C.slotClock(s + ev.l)}.`;
      if (game.fits(s)) {
        const p = game.preview(s);
        flash(`Shift the block with ← →, drop it with ↓, Space or Enter (here: Max-Min ${p.maxMin}, reward ${fmtR(p.reward)}).`);
      } else flash("Over capacity here: shift the block with ← → before dropping it.");
    } else {
      $("ev").textContent = "";
      if (game.failed) flash(`Overload: EV ${game.i + 1} cannot be charged without exceeding the capacity. Game over. ` +
        `W to watch replays, O to show references, R to restart.`);
      else {
        const gr = C.score(inst, bench.greedy.starts).maxMin;
        const cmp = sc.maxMin < gr ? "better than" : sc.maxMin === gr ? "equal to" : "worse than";
        flash(`Done. Your Max-Min is ${sc.maxMin}, ${cmp} Greedy (${gr}). W to watch replays, O to show references, ` +
          `R to restart, N for a new seed.`);
      }
    }
  }

  function replayPanel() {
    const R = rp.R, k = rp.k, f = R.frames[k], n = inst.evs.length, name = policyName(rp.policy);
    $("rp-scrub").value = String(k);
    $("rp-scrub").setAttribute("aria-valuetext", `${k} of ${n} EVs placed`);
    const lab = rp.playing ? "Pause (Space or K)" : "Play (Space or K)";
    $("rp-play").textContent = rp.playing ? "\u275A\u275A Pause" : "\u25B6 Play";
    $("rp-play").setAttribute("aria-label", lab); $("rp-play").title = lab;
    $("rp-sw").style.background = rp.policy === "you" ? css("--accent") : REF_COLOR[rp.policy];
    $("rp-k").textContent = String(k);
    $("rp-n").textContent = String(n);
    $("rp-mm").textContent = f.maxMin;
    $("rp-rmse").textContent = f.rmse.toFixed(2);
    $("rp-rew").textContent = fmtR(f.rewardSum) + (f.lastReward === null || k === 0 ? "" : ` (last ${fmtR(f.lastReward)})`);
    if (k < R.placed) {
      const ev = inst.evs[k], s = R.starts[k];
      $("ev").textContent = `${name}: EV ${k + 1} of ${n} arrives ${C.timeClock(ev.arrival)}, leaves ${C.timeClock(ev.departure)}, ` +
        `needs ${fmtDur(ev.l)}; charged ${C.slotClock(s)} to ${C.slotClock(s + ev.l)}.`;
    } else if (f.failed) {
      $("ev").textContent = `${name}: overload at EV ${k + 1}, which has no start under the capacity.`;
    } else if (k < n) {
      $("ev").textContent = `${name}: ${k} of ${n} EVs placed so far.`;
    } else {
      $("ev").textContent = `${name}: all ${n} EVs placed. Max-Min ${f.maxMin}, RMSE ${f.rmse.toFixed(2)}, cumulative reward ${fmtR(f.rewardSum)}.`;
    }
    flash(`Watching ${name}: Space plays or pauses, ← → step, ↑ ↓ change the replay, Esc closes.`);
  }

  // ---------------------------------------------------------------- paper averages
  function paperTable() {
    const box = $("paper");
    if (!P || !P.ROWS[key]) {
      $("paper-body").innerHTML = "<p>The warm-up level is not in the paper.</p>";
      return;
    }
    let html = `<p>${C.SCENARIOS[key].name} (${P.TABLE[key]}): means over the paper's 100 test instances, not this seed: our instances come
      from our own generator. Bold: heuristics also run on this page.</p><table><thead><tr><th>Method</th><th>Max-Min</th>
      <th>RMSE</th></tr></thead><tbody>`;
    let fam = null;
    for (const [name, mm, rm, f, pk] of P.ROWS[key]) {
      if (f !== fam) { fam = f; html += `<tr class="fam"><td colspan="3">${P.FAMILIES[f]}</td></tr>`; }
      const nm = pk ? `<b>${name}</b>` : name;
      html += `<tr><td>${nm}</td><td>${mm.toFixed(2)}</td><td>${rm.toFixed(2)}</td></tr>`;
    }
    html += "</tbody></table>";
    if (key === "s1") html += "<p>Reinforcement learning: EC Table 5, agents trained on Scenario 1 (EC Appendix H compares " +
      "them with G2M-DAgger's Scenario 1 value, 30.89).</p>";
    html += "<p>I2M, G2M, F2M, V2M: image, graph, fully connected graph (transformer) and vector representations with " +
      "movement actions; SL: supervised learning from the oracle; DAgger: dataset aggregation; 2SSP: rolling two-stage " +
      "stochastic programming.</p>";
    $("paper-body").innerHTML = html;
    box.hidden = false;
  }

  // ---------------------------------------------------------------- input
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "A" && ev.key === "Enter") return;   // follow a focused link (site navigation)
    const tag = ev.target.tagName;
    if (tag === "INPUT" || tag === "SELECT") { if (ev.key === "Escape") ev.target.blur(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (tag === "BUTTON" && (k === " " || k === "Enter")) return;   // let a focused button act
    // W and O everywhere (V: the old key for the replays, kept as a silent alias of W)
    if (k === "w" || k === "W" || k === "v" || k === "V") { ev.preventDefault(); toggleWatch(); return; }
    if (k === "o" || k === "O") { ev.preventDefault(); toggleRefs(); return; }
    if (mode === "replay") {   // keys act on the replay only
      const st = ev.shiftKey ? 10 : 1;
      const m = { " ": toggle, k: toggle, K: toggle, ArrowLeft: () => seek(rp.k - st), ArrowRight: () => seek(rp.k + st),
                  Home: () => seek(0), End: () => seek(rp.R.placed), ArrowUp: () => cyclePolicy(-1), ArrowDown: () => cyclePolicy(1),
                  "-": () => setSpeed(speedIx - 1), "_": () => setSpeed(speedIx - 1), "[": () => setSpeed(speedIx - 1),
                  "+": () => setSpeed(speedIx + 1), "=": () => setSpeed(speedIx + 1), "]": () => setSpeed(speedIx + 1),
                  Escape: closeReplay };
      if (m[k]) { ev.preventDefault(); m[k](); }
      return;
    }
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", " ": "down", Enter: "down" };
    if (map[k]) { ev.preventDefault(); act(map[k]); return; }
    if (k === "r" || k === "R") newGame();
    else if (k === "n" || k === "N") { seed += 1; newGame(); }
    else if (k >= "1" && k <= String(LEVELS.length)) { key = LEVELS[+k - 1]; newGame(); }
  });

  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act)));
  $("restart").addEventListener("click", newGame);
  $("newseed").addEventListener("click", () => { seed += 1; newGame(); });
  $("level").addEventListener("change", () => { key = $("level").value; newGame(); $("level").blur(); });
  $("seed").addEventListener("change", () => { seed = Math.max(1, Math.floor(+$("seed").value) || 1); newGame(); });
  $("watch").addEventListener("click", toggleWatch);
  $("refs").addEventListener("click", toggleRefs);
  $("rp-watch").addEventListener("change", () => { loadReplay($("rp-watch").value); $("rp-watch").blur(); });
  $("rp-play").addEventListener("click", toggle);
  $("rp-start").addEventListener("click", () => seek(0));
  $("rp-back").addEventListener("click", () => seek(rp.k - 1));
  $("rp-fwd").addEventListener("click", () => seek(rp.k + 1));
  $("rp-end").addEventListener("click", () => seek(rp.R.placed));
  $("rp-close").addEventListener("click", closeReplay);
  $("rp-speed").addEventListener("change", () => { setSpeed(+$("rp-speed").value); $("rp-speed").blur(); });
  $("rp-scrub").addEventListener("input", () => { const k = +$("rp-scrub").value; stopReplay(); seek(k); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => game && render());
  window.addEventListener("resize", () => game && render());

  $("level").innerHTML = LEVELS.map((k, i) => {
    const sc = C.SCENARIOS[k];
    return `<option value="${k}">${i + 1}. ${sc.name} (${sc.n} EVs)</option>`;
  }).join("");
  $("rp-speed").innerHTML = SPEEDS.map((s, i) => `<option value="${i}">${s} EV${s > 1 ? "s" : ""}/s</option>`).join("");
  $("rp-speed").value = String(speedIx);
  readHash();
  newGame();

  // hooks for the node smoke test (test/ui_smoke.js); harmless in a browser
  window.__charge = { state: () => ({ mode, key, seed, inst, game, bench, scale, rp, refsOn, refSel,
                                      speed: SPEEDS[speedIx] }),
                      seek, play, pause, openReplay, loadReplay, closeReplay, newGame, REF_COLOR, Y: { YT, YB, AY, AH } };
})();
