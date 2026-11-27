// Smoke test of the user interface without a browser: a fake DOM and a fake canvas that records the drawing
// (and can write it as SVG). Run: node test/ui_smoke.js        SVG frames: SVG_OUT=dir node test/ui_smoke.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const uiSrc = fs.readFileSync(path.join(ROOT, "ui.js"), "utf8");
const C = require(path.join(ROOT, "engine.js"));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("PASS", name); }
  catch (e) { fail++; console.log("FAIL", name, "-", e.stack.split("\n").slice(0, 3).join(" | ")); }
}
function ok(c, what) { if (!c) throw new Error(what); }
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

// ---------------------------------------------------------------- fake canvas (records shapes, writes SVG)
function fakeContext() {
  const st = { fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1, lineWidth: 1, font: "11px sans-serif",
               textAlign: "left", textBaseline: "alphabetic" };
  let ops = [], pathPts = [], dash = [];
  const ctx = Object.assign(st, {
    ops: () => ops, reset: () => { ops = []; },
    setTransform() {}, clearRect() { ops = []; },
    fillRect(x, y, w, h) { ops.push({ t: "rect", x, y, w, h, fill: st.fillStyle, a: st.globalAlpha }); },
    strokeRect(x, y, w, h) { ops.push({ t: "srect", x, y, w, h, stroke: st.strokeStyle, lw: st.lineWidth, a: st.globalAlpha }); },
    beginPath() { pathPts = []; }, moveTo(x, y) { pathPts.push(["M", x, y]); }, lineTo(x, y) { pathPts.push(["L", x, y]); },
    closePath() { pathPts.push(["Z"]); },
    stroke() { ops.push({ t: "path", d: pathPts.slice(), stroke: st.strokeStyle, lw: st.lineWidth, dash: dash.slice(), a: st.globalAlpha }); },
    fill() { ops.push({ t: "path", d: pathPts.slice(), fill: st.fillStyle, a: st.globalAlpha }); },
    setLineDash(d) { dash = d; },
    measureText(text) { return { width: text.length * (/600/.test(st.font) ? 7.2 : 6.2) }; },
    fillText(text, x, y) { ops.push({ t: "text", text, x, y, fill: st.fillStyle, font: st.font, align: st.textAlign, base: st.textBaseline, a: st.globalAlpha }); },
  });
  return ctx;
}
function toSVG(ops, W, H) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const anchor = { left: "start", center: "middle", right: "end" };
  const base = { middle: "central", top: "hanging", alphabetic: "alphabetic" };
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">`];
  for (const o of ops) {
    const op = o.a !== 1 ? ` opacity="${o.a}"` : "";
    if (o.t === "rect") out.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill}"${op}/>`);
    else if (o.t === "srect") out.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="none" stroke="${o.stroke}" stroke-width="${o.lw}"${op}/>`);
    else if (o.t === "path") {
      const d = o.d.map(p => p.join(" ")).join(" ");
      out.push(o.fill ? `<path d="${d}" fill="${o.fill}"${op}/>` :
        `<path d="${d}" fill="none" stroke="${o.stroke}" stroke-width="${o.lw}"${o.dash.length ? ` stroke-dasharray="${o.dash.join(" ")}"` : ""}${op}/>`);
    } else if (o.t === "text") {
      const m = /(\d+)px/.exec(o.font), bold = /600/.test(o.font) ? ' font-weight="600"' : "";
      out.push(`<text x="${o.x}" y="${o.y}" font-family="sans-serif" font-size="${m ? m[1] : 11}"${bold} text-anchor="${anchor[o.align]}" dominant-baseline="${base[o.base]}" fill="${o.fill}"${op}>${esc(o.text)}</text>`);
    }
  }
  out.push("</svg>");
  return out.join("\n");
}

// ---------------------------------------------------------------- fake DOM
function makeDom(theme) {
  const vars = {};
  const rootCss = theme === "dark" ? /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(html)[1] : /:root \{([^}]*)\}/.exec(html)[1];
  for (const m of /:root \{([^}]*)\}/.exec(html)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  for (const m of rootCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  const els = {}, listeners = {};
  const ctx = fakeContext();
  function el(id) {
    if (els[id]) return els[id];
    const cls = new Set(), attrs = {}, ls = {};
    const tagOf = id => { const m = new RegExp(`<(\\w+)[^>]*id="${id}"`).exec(html); return m ? m[1].toUpperCase() : /^n-/.test(id) ? "BUTTON" : "DIV"; };
    const e = { id, tagName: tagOf(id),
      textContent: "", innerHTML: "", value: "", hidden: /id="[^"]*"[^>]*\shidden/.test((html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [""])[0]),
      width: 820, height: 580, clientWidth: 820, dataset: {}, title: "", max: "0", style: {},
      classList: { toggle(c, on) { on ? cls.add(c) : cls.delete(c); }, contains: c => cls.has(c) },
      setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k],
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      fire(t) { (ls[t] || []).forEach(f => f({ target: e })); },
      focus() { doc.activeElement = e; }, blur() { if (doc.activeElement === e) doc.activeElement = null; },
      getContext: () => ctx };
    let text = "";   // the DOM turns textContent into a string
    Object.defineProperty(e, "textContent", { get: () => text, set: v => { text = String(v); } });
    return (els[id] = e);
  }
  const pad = ["left", "down", "right"].map(a => { const b = el("pad-" + a); b.tagName = "BUTTON"; b.dataset.act = a; return b; });
  const doc = {
    activeElement: null,
    getElementById: el, documentElement: {},
    querySelectorAll: sel => sel === "[data-act]" ? pad : [],
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
  };
  const timers = [];
  const win = { document: doc, Charge: C, PaperResults: require(path.join(ROOT, "paper.js")), devicePixelRatio: 1,
    location: { hash: "" }, history: { replaceState(a, b, h) { win.location.hash = h; } },
    getComputedStyle: () => ({ getPropertyValue: n => vars[n] || "" }),
    matchMedia: () => ({ addEventListener() {} }), addEventListener() {},
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
    console };
  win.window = win;
  function key(k, opts = {}) {
    const target = opts.target || doc.activeElement || { tagName: "BODY" };
    const ev = { key: k, target, shiftKey: !!opts.shift, ctrlKey: false, metaKey: false, altKey: false, prevented: false,
                 preventDefault() { this.prevented = true; } };
    (listeners.keydown || []).forEach(f => f(ev));
    // a browser clicks a focused button on Space or Enter unless the page prevented it
    if (target.tagName === "BUTTON" && (k === " " || k === "Enter") && !ev.prevented && target.fire) target.fire("click");
    return ev;
  }
  function runTimers(n) { for (let i = 0; i < n && timers.length; i++) timers.shift().f(); }
  return { win, els, el, ctx, key, timers, runTimers };
}
function boot(hash, theme) {
  const d = makeDom(theme);
  d.win.location.hash = hash || "";
  vm.runInNewContext(uiSrc, d.win, { filename: "ui.js" });
  d.api = d.win.__charge;
  return d;
}
function writeSVG(d, name) {
  if (!process.env.SVG_OUT) return;
  fs.mkdirSync(process.env.SVG_OUT, { recursive: true });
  fs.writeFileSync(path.join(process.env.SVG_OUT, name + ".svg"), toSVG(d.ctx.ops(), 820, 580));
}

// ---------------------------------------------------------------- tests
const BENCH = ["current", "greedy", "rowfill", "alpha", "beta"];
const REF_COLOR = { current: "#E69F00", greedy: "#CC79A7", rowfill: "#009E73", alpha: "#56B4E9", beta: "#D55E00" };
const KEYMOVE = { left: "ArrowLeft", right: "ArrowRight", down: "ArrowDown" };
function finishWithGreedy(d) {
  const g = d.api.state().game;
  while (!g.done) for (const a of C.movesTo(g, C.POLICIES.greedy(g))) d.key(KEYMOVE[a[0]]);
}
const cssVar = (d, n) => d.win.getComputedStyle().getPropertyValue(n);
// unit cells of the board (one slot wide, below the action area)
const cells = d => d.ctx.ops().filter(o => o.t === "rect" && o.w === 7 && o.a === 1 && o.y >= 39);
const refLines = d => d.ctx.ops().filter(o => o.t === "path" && o.lw === 2 && Object.values(REF_COLOR).includes(o.stroke));
// placed blocks: one neutral colour, except the units of the EV placed last (accent), as many as its length
function checkColours(d, g, what) {
  const cell = cssVar(d, "--cell"), accent = cssVar(d, "--accent");
  const cs = cells(d).filter(c => c.fill === cell || c.fill === accent);
  const units = g.loads.reduce((a, b) => a + b, 0);
  eq(cs.length, units, what + ": one cell per unit of load");
  const fills = new Set(cells(d).map(c => c.fill));
  ok([...fills].every(f => f === cell || f === accent), what + ": cell colours " + [...fills].join(","));
  const nAccent = cs.filter(c => c.fill === accent).length;
  eq(nAccent, g.i > 0 ? g.inst.evs[g.i - 1].l : 0, what + ": accent units = length of the EV placed last");
}

test("ids and labels of the conventions exist in index.html", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...uiSrc.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  for (const p of BENCH) used.delete("s-" + p), used.delete("n-" + p);   // built by benchList()
  eq([...used].filter(id => !ids.has(id)), [], "ids used by ui.js missing from index.html");
  for (const id of ["watch", "refs", "msg", "replay-bar", "rp-watch", "rp-start", "rp-back", "rp-play", "rp-fwd", "rp-end",
                    "rp-speed", "rp-close", "rp-scrub"]) ok(ids.has(id), "missing id " + id);
  ok(/<div id="msg" role="status"/.test(html), "#msg has role=status");
  ok(!/id="reveal/.test(html), "no spoiler confirmation any more");
  const label = id => { const m = new RegExp(`<button id="${id}"[^>]*>([^<]*)</button>`).exec(html); return m && m[1]; };
  eq([label("rp-start"), label("rp-back"), label("rp-play"), label("rp-fwd"), label("rp-end"), label("rp-close")],
     ["&#x21E4; Start", "&#x2190; Back", "&#x25B6; Play", "Forward &#x2192;", "End &#x21E5;", "&#x2715; Close"], "replay button labels");
  eq([label("watch"), label("refs")], ["Watch replays", "Show references"], "action buttons");
  for (const id of ["rp-start", "rp-back", "rp-play", "rp-fwd", "rp-end", "rp-close"])
    ok(new RegExp(`<button id="${id}"[^>]* title="[^"]+" aria-label="[^"]+"`).test(html), id + ": title and aria-label give the key");
  // layout order: toolbar, board, status line, replay bar; then Your game, References, actions, pad, help, paper
  const at = t => { const i = html.indexOf(t); ok(i > 0, "missing " + t); return i; };
  const order = ['id="level"', 'id="newseed"', 'id="restart"', 'id="board"', 'id="msg"', 'id="replay-bar"', 'id="ev"',
                 '>Your game<', '>References on this instance<', 'id="watch"', 'id="refs"', 'id="pad"', 'class="help"',
                 '<details class="paper"', "<footer>"].map(at);
  eq(order.slice().sort((a, b) => a - b), order, "layout order");
  ok(/<summary>Paper's reported averages \(paper instances, not this one\)<\/summary>/.test(html), "paper summary");
  { const k = html.indexOf("<b>Keys:</b>"), b = html.indexOf("<b>The board:</b>"), r = html.indexOf("<b>References:</b>"); ok(k > 0 && k < b && b < r && !/README/.test(html), "help: Keys, The board, References; no README link"); }
  ok(/<script src="paper.js"><\/script>\s*<script src="ui.js">/.test(html), "paper.js must load before ui.js");
});

test("page boots on every level; references grid with swatches in the conventional colours", () => {
  for (const k of ["warmup", "s1", "s2", "s3", "s4"]) {
    const d = boot("#" + k + "-3");
    const st = d.api.state();
    eq([st.key, st.seed, st.mode, st.refsOn], [k, 3, "play", false], "state");
    ok(d.ctx.ops().filter(o => o.t === "rect").length > 10, "few shapes drawn");
    for (const p of BENCH) ok(/^\d+ \/ \d+\.\d\d$/.test(d.el("s-" + p).textContent), p + " score shown");
    const grid = d.el("bench").innerHTML;
    for (const p of BENCH) ok(grid.includes(`id="n-${p}"`) && grid.includes(`class="sw" style="background:${REF_COLOR[p]}`), p + " swatch");
    eq(BENCH.map(p => grid.indexOf(`id="n-${p}"`)).every((v, i, a) => i === 0 || v > a[i - 1]), true, "grid order");
    ok(/\(lower is better\)/.test(html), "objective says lower is better");
    eq(refLines(d).length, 0, "no reference lines before O");
    writeSVG(d, `play_${k}`);
  }
});

test("unit height vs the old 396 / 140 = 2.83 px: at least 2x (Scenarios 1-3) and 1.8x (Scenario 4, 2x on average)", () => {
  const OLD = 396 / 140;
  for (const k of ["s1", "s2", "s3", "s4"]) {
    let sum = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const d = boot(`#${k}-${seed}`), sc = d.api.state().scale;
      sum += sc.rh;
      ok(sc.band && sc.ymax < 140, `${k}/${seed}: expected a compressed band`);
      ok(sc.rh >= (k === "s4" ? 1.8 : 2) * OLD, `${k}/${seed}: unit ${sc.rh.toFixed(2)} px`);
      for (const p of ["greedy", "rowfill", "alpha", "beta"]) ok(Math.max(...d.api.state().bench[p].loads) <= sc.ymax, `${p} above ymax`);
      if (seed === 1) {
        d.key("ArrowDown"); d.key("ArrowDown");
        ok(d.api.state().scale === sc, "scale changed during the game");
      }
    }
    ok(sum / 30 >= 2 * OLD, `${k}: mean unit ${(sum / 30).toFixed(2)} px`);
    console.log(`     ${k}: mean unit height ${(sum / 30).toFixed(2)} px (was ${OLD.toFixed(2)}), seeds 1-30, at 820 px width`);
  }
  const w = boot("#warmup-1").api.state().scale;
  ok(!w.band && w.ymax === 30 && w.rh > 15, "warm-up: full axis to the capacity");
});

test("drawn units: one unit tall; placed load in one neutral colour, only the last dropped EV in the accent colour", () => {
  const d = boot("#s1-1"), st = d.api.state(), rh = st.scale.rh;
  for (let k = 0; k < 40; k++) d.key("ArrowDown");
  writeSVG(d, "play_s1_after40");
  const accent = cssVar(d, "--accent");
  const ev = st.game.ev;
  const block = d.ctx.ops().find(o => o.t === "rect" && o.fill === accent && o.a === 1 && o.y < 40 && Math.abs(o.w - ev.l * 8) < 1e-9);
  ok(block, "arriving block not found in the action area");
  ok(Math.abs(block.h - rh) < 1e-9, `block height ${block.h} vs unit ${rh}`);
  const cs = cells(d).filter(c => c.y > 80);
  ok(cs.length > 100, "few cells");
  ok(cs.every(c => Math.abs(c.h - (rh - 1)) < 1e-9 || c.h < 3), "cell heights should be one unit minus the 1 px gap");
  checkColours(d, st.game, "after 40 drops");
  // current practice stacks high: units in the compressed band are the same neutral colour
  const d2 = boot("#s4-2");
  d2.key("w"); d2.api.loadReplay("current"); d2.key("End");
  checkColours(d2, d2.api.state().rp.g, "current practice, end (band)");
  ok(cells(d2).some(c => c.y < d2.api.state().scale.ym), "some units in the compressed band");
});

test("W and O work at any time, without confirmation; closing returns to the game as it was", () => {
  const d = boot("#s2-5");
  d.key("ArrowRight"); d.key("ArrowDown"); d.key("ArrowRight"); d.key("ArrowRight");
  const g = d.api.state().game, before = JSON.stringify([g.i, g.pos, g.moves, g.loads, g.rewardSum]);
  const msgBefore = d.el("msg").textContent, statsBefore = ["s-mm", "s-rmse", "s-rew", "s-ev", "s-moves"].map(id => d.el(id).textContent);
  d.key("w");
  let st = d.api.state();
  eq([st.mode, st.rp.policy, d.el("replay-bar").hidden, d.el("watch").getAttribute("aria-expanded")],
     ["replay", "greedy", false, "true"], "W opens the replay bar at once");
  eq(d.el("rp-watch").innerHTML.match(/>Watch: [^<]+</g),
     [">Watch: Your game<", ">Watch: Current practice<", ">Watch: Greedy<", ">Watch: Row-filling<", ">Watch: α-threshold<",
      ">Watch: β-threshold<"], "Watch: menu, Your game first then the grid order");
  d.key("ArrowDown"); eq(d.api.state().game.i, 1, "arrows act on the replay only"); d.key("End");
  d.key("r"); eq(d.api.state().game.i, 1, "R does nothing in a replay");
  d.key("Escape");
  eq([d.api.state().mode, d.el("replay-bar").hidden], ["play", true], "Esc closes");
  d.key("W"); d.key("W"); eq(d.api.state().mode, "play", "W toggles");
  d.key("V"); eq(d.api.state().mode, "replay", "V is an alias of W"); d.key("v");
  d.key("o");
  eq([d.api.state().refsOn, d.el("refs").textContent, d.el("refs").getAttribute("aria-pressed")], [true, "Hide references", "true"], "O shows");
  eq(refLines(d).length, 5, "five reference lines");
  d.key("O");
  eq([d.api.state().refsOn, d.el("refs").textContent], [false, "Show references"], "O hides");
  d.el("watch").fire("click"); eq(d.api.state().mode, "replay", "Watch replays button");
  d.el("rp-close").fire("click"); eq(d.api.state().mode, "play", "Close button");
  d.el("refs").fire("click"); d.el("refs").fire("click"); eq(d.api.state().refsOn, false, "Show / Hide button");
  eq(JSON.stringify([g.i, g.pos, g.moves, g.loads, g.rewardSum]), before, "the game is untouched");
  eq(d.el("msg").textContent, msgBefore, "status line restored");
  eq(["s-mm", "s-rmse", "s-rew", "s-ev", "s-moves"].map(id => d.el(id).textContent), statsBefore, "stats restored");
  d.key("ArrowDown"); eq(d.api.state().game.i, 2, "the game goes on");
  ok(!/seen before/.test(uiSrc + html), "no 'seen before the end' note");
});

test("references overlay: step lines on the board's (compressed) scale; a click on a row toggles its line", () => {
  for (const [k, seed] of [["s1", 1], ["s4", 1], ["warmup", 1]]) {
    const d = boot(`#${k}-${seed}`), st = d.api.state(), S = st.scale;
    d.key("o");
    const lines = refLines(d);
    eq(lines.map(l => l.stroke), BENCH.map(p => REF_COLOR[p]), k + ": one line per reference, in its colour");
    BENCH.forEach((p, i) => {
      const loads = st.bench[p].loads, pts = lines[i].d;
      eq(pts.length, 2 * loads.length, p + ": two points per slot");
      for (let j = 0; j < loads.length; j++) {
        const y = S.y(loads[j]);
        ok(Math.abs(pts[2 * j][2] - y) < 1e-9 && Math.abs(pts[2 * j + 1][2] - y) < 1e-9, `${p} slot ${j}: y`);
        ok(Math.abs(pts[2 * j + 1][1] - (40 + 8 * (j + 1))) < 1e-9, `${p} slot ${j}: x`);
      }
    });
    if (S.band) {   // current practice goes above ymax: its line enters the band, where a bar of that load ends
      const cur = st.bench.current.loads, j = cur.indexOf(Math.max(...cur));
      ok(cur[j] > S.ymax, "current practice above ymax");
      const yy = lines[0].d[2 * j][2];
      ok(yy < S.ym && yy > 40, `line in the band (${yy})`);
      eq(yy, S.ym - (cur[j] - S.ymax) * 40 / (st.inst.cap - S.ymax), "compressed scale");
    }
    writeSVG(d, `refs_${k}_start`);
    // toggle rows: hide all but beta and greedy
    for (const p of ["current", "rowfill", "alpha"]) d.el("n-" + p).fire("click");
    eq(refLines(d).map(l => l.stroke), [REF_COLOR.greedy, REF_COLOR.beta], k + ": rows toggle the lines");
    eq(d.el("n-current").getAttribute("aria-pressed"), "false", "aria-pressed off");
    d.key(" ", { target: d.el("n-current") });   // keyboard: Space on a focused row clicks it
    eq(refLines(d).length, 3, "Space on a focused row toggles it");
    // the selection survives hiding; a click on a row with the overlay hidden shows it with that row on
    d.key("o"); eq(refLines(d).length, 0, "hidden");
    d.el("n-alpha").fire("click");
    eq([d.api.state().refsOn, refLines(d).length], [true, 4], "click on a row opens the overlay");
    for (const p of ["rowfill"]) d.el("n-" + p).fire("click");
    finishWithGreedy(d);
    writeSVG(d, `refs_${k}_end`);
    d.key("w"); d.key("End");
    eq(refLines(d).length, 5, "overlay over the replay");
    writeSVG(d, `refs_${k}_replay_you`);
  }
});

test("replay keys and buttons; every replay ends on the values of the stats grids", () => {
  const d = boot("#s1-2");
  finishWithGreedy(d);
  d.key("w");
  let st = d.api.state();
  eq([st.mode, st.rp.policy], ["replay", "you"], "after the game, W opens your replay");
  eq(d.el("rp-play").textContent, "▶ Play", "Play label");
  d.key("End");
  eq([d.el("rp-k").textContent, d.el("rp-n").textContent], ["200", "200"], "EV k of n");
  eq([d.el("rp-mm").textContent, d.el("rp-rmse").textContent, d.el("rp-rew").textContent.split(" ")[0]],
     [d.el("s-mm").textContent, d.el("s-rmse").textContent, d.el("s-rew").textContent], "your replay ends on your stats");
  eq(d.el("rp-sw").style.background, cssVar(d, "--accent"), "your swatch is the accent");
  checkColours(d, d.api.state().rp.g, "your replay, end");
  for (const p of BENCH) {
    d.key("ArrowDown");
    st = d.api.state();
    eq([st.rp.policy, st.rp.k], [p, 0], "↓ next in Watch:");
    d.key("ArrowRight"); d.key("ArrowRight"); d.key("ArrowLeft");
    eq(d.api.state().rp.k, 1, "steps");
    d.key("ArrowRight", { shift: true }); eq(d.api.state().rp.k, 11, "Shift: 10 steps");
    d.key("ArrowLeft", { shift: true }); eq(d.api.state().rp.k, 1, "Shift: 10 back");
    checkColours(d, d.api.state().rp.g, p + " at 1: the EV just placed is the accent");
    d.key("End");
    eq([d.el("rp-mm").textContent, d.el("rp-rmse").textContent].join(" / "), d.el("s-" + p).textContent, p + " final values vs grid");
    eq(d.el("rp-k").textContent, "200", "all EVs placed");
    eq(d.el("rp-sw").style.background, REF_COLOR[p], p + " swatch");
    ok(d.el("s-" + p).classList.contains("on"), "replayed reference highlighted");
    checkColours(d, d.api.state().rp.g, p + " end");
    if (p === "beta") writeSVG(d, "replay_s1_beta_end");
    d.key("Home"); eq(d.api.state().rp.k, 0, "Home");
  }
  d.key("ArrowDown"); eq(d.api.state().rp.policy, "you", "↓ wraps to Your game");
  d.key("ArrowUp"); eq(d.api.state().rp.policy, "beta", "↑ previous");
  d.key(" ");
  ok(d.api.state().rp.playing, "Space plays");
  eq([d.el("rp-play").textContent, d.el("rp-play").title], ["❚❚ Pause", "Pause (Space or K)"], "Pause label");
  d.runTimers(60);
  eq(d.api.state().rp.k, 60, "60 ticks, 60 EVs");
  writeSVG(d, "replay_s1_beta_60");
  d.key("k"); ok(!d.api.state().rp.playing, "K pauses");
  const sp = d.api.state().speed;
  d.key("+"); ok(d.api.state().speed > sp, "+ speeds up");
  d.key("-"); d.key("-"); ok(d.api.state().speed < sp, "- slows down");
  d.el("rp-scrub").value = "150"; d.el("rp-scrub").fire("input");
  st = d.api.state();
  eq(st.rp.k, 150, "scrubber");
  eq(st.rp.g.loads, st.rp.R.gameAt(150).loads, "scrubbed state equals re-stepping");
  writeSVG(d, "replay_s1_beta_150");
  d.api.loadReplay("current"); d.key("End");
  writeSVG(d, "replay_s1_current_end");
  // buttons
  d.el("rp-fwd").fire("click"); d.el("rp-start").fire("click"); d.el("rp-fwd").fire("click"); d.el("rp-fwd").fire("click");
  d.el("rp-back").fire("click"); eq(d.api.state().rp.k, 1, "start, forward, forward, back");
  d.el("rp-end").fire("click"); eq(d.api.state().rp.k, 200, "end");
  d.el("rp-watch").value = "alpha"; d.el("rp-watch").fire("change"); eq(d.api.state().rp.policy, "alpha", "Watch: menu");
  d.el("rp-speed").value = "5"; d.el("rp-speed").fire("change"); eq(d.api.state().speed, 50, "speed menu");
  d.el("rp-play").fire("click"); d.runTimers(1000);
  eq([d.api.state().rp.k, d.api.state().rp.playing], [200, false], "plays to the end and stops");
  d.api.newGame();
  eq(d.api.state().mode, "play", "a new game leaves the replay");
});

test("replay of your game during a game ends on your current stats", () => {
  const d = boot("#s4-9");
  for (let i = 0; i < 25; i++) { d.key("ArrowRight"); d.key("ArrowDown"); }
  d.key("ArrowRight");   // a move not yet dropped (the block appears at the left edge of its window)
  d.key("w"); eq(d.api.state().rp.policy, "greedy", "during a game, W opens Greedy");
  d.key("ArrowUp"); d.key("ArrowUp");
  eq(d.api.state().rp.policy, "you", "↑ ↑ from Greedy: Your game");
  d.key("End");
  eq([d.el("rp-k").textContent, d.el("rp-mm").textContent, d.el("rp-rmse").textContent, d.el("rp-rew").textContent.split(" ")[0]],
     ["25", d.el("s-mm").textContent, d.el("s-rmse").textContent, d.el("s-rew").textContent], "partial replay = current stats");
  writeSVG(d, "replay_s4_you_partial");
  d.key("ArrowDown"); d.key("ArrowDown"); d.key("ArrowDown"); d.key("ArrowDown"); d.key("ArrowDown");
  d.key("End"); eq(d.api.state().rp.k, 300, "β-threshold on all 300 EVs");
  writeSVG(d, "replay_s4_beta_end");
  d.key("Escape");
  eq([d.api.state().game.i, d.api.state().game.moves], [25, 1], "game as it was");
});

test("dark theme renders with the dark colours", () => {
  const d = boot("#s3-4", "dark");
  const fills = new Set(d.ctx.ops().map(o => o.fill));
  ok(fills.has("#0f141c"), "dark background");
  d.key("w"); d.key("End");
  checkColours(d, d.api.state().rp.g, "dark");
  d.key("o");
  writeSVG(d, "replay_s3_dark_refs");
  d.api.loadReplay("current"); d.key("End");
  writeSVG(d, "replay_s3_current_dark");
});

test("overloaded game: replay of the player's moves stops at the overload", () => {
  const d = boot("#warmup-2");
  const st = d.api.state();
  st.inst.cap = 4; st.game.cap = 4;   // force a tight capacity
  let guard = 0;
  while (!st.game.done && guard++ < 1000)
    for (const a of C.movesTo(st.game, st.game.feasibleStarts()[0])) d.key(KEYMOVE[a[0]]);
  ok(st.game.done, "game should end");
  d.key("w");
  const s2 = d.api.state();
  eq(s2.rp.policy, "you", "your replay");
  d.key("End");
  eq(s2.rp.R.placed, st.game.i, "frames up to the overload");
  ok(st.game.failed ? d.el("ev").textContent.includes("overload") : true, "overload message");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
