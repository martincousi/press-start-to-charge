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
    const tagOf = id => { const m = new RegExp(`<(\\w+)[^>]*id="${id}"`).exec(html); return m ? m[1].toUpperCase() : "DIV"; };
    const e = { id, tagName: tagOf(id),
      textContent: "", innerHTML: "", value: "", hidden: /id="[^"]*"[^>]*\shidden/.test((html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [""])[0]),
      width: 820, height: 580, clientWidth: 820, dataset: {}, title: "", max: "0",
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
test("every element id used by ui.js exists in index.html", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...uiSrc.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  for (const p of ["current", "greedy", "rowfill", "alpha", "beta"]) used.delete("s-" + p), used.delete("n-" + p);   // built by benchList()
  const missing = [...used].filter(id => !ids.has(id));
  eq(missing, [], "ids missing from index.html");
  ok(/<script src="paper.js"><\/script>\s*<script src="ui.js">/.test(html), "paper.js must load before ui.js");
});

test("page boots on every level and draws the board", () => {
  for (const k of ["warmup", "s1", "s2", "s3", "s4"]) {
    const d = boot("#" + k + "-3");
    const st = d.api.state();
    eq([st.key, st.seed, st.mode], [k, 3, "play"], "state");
    ok(d.ctx.ops().filter(o => o.t === "rect").length > 10, "few shapes drawn");
    ok(d.el("s-greedy").textContent.includes(" / "), "greedy score shown");
    for (const p of ["rowfill", "alpha", "beta"]) ok(/^\d+ \/ \d+\.\d\d$/.test(d.el("s-" + p).textContent), p + " score shown");
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
    // every benchmark heuristic except current practice stays below ymax
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

test("drawn units: a cell on the board and the block in the action area are one unit tall", () => {
  const d = boot("#s1-1"), st = d.api.state(), rh = st.scale.rh;
  for (let k = 0; k < 40; k++) d.key("ArrowDown");
  writeSVG(d, "play_s1_after40");
  const accent = d.win.getComputedStyle().getPropertyValue("--accent");
  const ev = st.game.ev;
  const block = d.ctx.ops().find(o => o.t === "rect" && o.fill === accent && o.a === 1 && o.y < 40 && Math.abs(o.w - ev.l * 8) < 1e-9);
  ok(block, "arriving block not found in the action area");
  ok(Math.abs(block.h - rh) < 1e-9, `block height ${block.h} vs unit ${rh}`);
  const cells = d.ctx.ops().filter(o => o.t === "rect" && o.w === 7 && o.a === 1 && o.y > 80);
  ok(cells.length > 100, "few cells");
  ok(cells.every(c => Math.abs(c.h - (rh - 1)) < 1e-9 || c.h < 3), "cell heights should be one unit minus the 1 px gap");
});

test("replays are locked during a game: V asks for confirmation, a second V reveals", () => {
  const d = boot("#s2-5");
  d.key("ArrowDown");
  d.key("v");
  eq([d.api.state().mode, d.el("reveal").hidden], ["play", false], "after one V");
  d.key("Escape");
  eq(d.el("reveal").hidden, true, "Escape cancels");
  d.key("v"); d.key("v");
  const st = d.api.state();
  eq([st.mode, st.revealed, st.rp.policy], ["replay", true, "greedy"], "after V V");
  ok(d.el("you-label").textContent.includes("replays seen"), "label should mark the game as revealed");
  d.key("Escape");
  eq(d.api.state().mode, "play", "Esc returns to the game");
  eq(d.api.state().game.i, 1, "the game is untouched");
  ok(!d.api.state().rp.playing, "replay stopped");
});

test("replay keys: step, home/end, play with timers, policy cycle; final values equal the score panel", () => {
  const d = boot("#s1-2");
  const st0 = d.api.state();
  // finish the game with Greedy's moves typed on the keyboard
  while (!st0.game.done) for (const a of C.movesTo(st0.game, C.POLICIES.greedy(st0.game)))
    d.key({ left: "ArrowLeft", right: "ArrowRight", down: "ArrowDown" }[a[0]]);
  d.key("v");
  let st = d.api.state();
  eq([st.mode, st.rp.policy], ["replay", "you"], "after the game, V opens your replay directly");
  d.key("End");
  eq(d.el("rp-mm").textContent, String(C.score(st.inst, st.game.starts).maxMin), "your final Max-Min");
  eq(d.el("rp-rew").textContent.split(" ")[0], d.el("s-rew").textContent, "your cumulative reward");
  for (const p of ["current", "greedy", "rowfill", "alpha", "beta"]) {
    d.key("p");
    st = d.api.state();
    eq(st.rp.policy, p, "P cycles the policies");
    eq(st.rp.k, 0, "a new policy starts at EV 0");
    d.key("ArrowRight"); d.key("ArrowRight"); d.key("ArrowLeft");
    eq(d.api.state().rp.k, 1, "steps");
    d.key("End");
    const [mm, rm] = d.el("s-" + p).textContent.split(" / ");
    eq([d.el("rp-mm").textContent, d.el("rp-rmse").textContent], [mm, rm], p + " final values vs score panel");
    eq(d.el("rp-k").textContent, "200 / 200", "all EVs placed");
    ok(d.el("s-" + p).classList.contains("on"), "replayed policy highlighted");
    if (p === "beta") writeSVG(d, "replay_s1_beta_end");
    d.key("Home");
    eq(d.api.state().rp.k, 0, "Home");
  }
  // play: each timer tick places one EV
  d.key(" ");
  ok(d.api.state().rp.playing, "Space plays");
  d.runTimers(60);
  eq(d.api.state().rp.k, 60, "60 ticks, 60 EVs");
  writeSVG(d, "replay_s1_beta_60");
  d.key(" ");
  ok(!d.api.state().rp.playing, "Space pauses");
  const sp = d.api.state().speed;
  d.key("+"); ok(d.api.state().speed > sp, "+ speeds up");
  d.key("-"); d.key("-"); ok(d.api.state().speed < sp, "- slows down");
  // the scrubber
  d.el("rp-scrub").value = "150"; d.el("rp-scrub").fire("input");
  st = d.api.state();
  eq(st.rp.k, 150, "scrubber");
  const ref = st.rp.R.gameAt(150);
  eq(st.rp.g.loads, ref.loads, "scrubbed state equals re-stepping");
  writeSVG(d, "replay_s1_beta_150");
  // current practice at the end: loads above ymax are in the compressed band
  d.api.loadReplay("current"); d.key("End");
  writeSVG(d, "replay_s1_current_end");
  d.api.newGame();
  eq(d.api.state().mode, "play", "a new game leaves the replay");
});

test("replay buttons (mouse and touch) do what the keys do", () => {
  const d = boot("#s4-9");
  d.el("watch").fire("click");
  eq([d.api.state().mode, d.el("reveal").hidden], ["play", false], "Watch during a game asks first");
  d.el("reveal-no").fire("click");
  eq(d.el("reveal").hidden, true, "Cancel");
  d.el("watch").fire("click"); d.el("reveal-yes").fire("click");
  eq(d.api.state().mode, "replay", "Reveal and watch");
  eq([d.el("pad").hidden, d.el("replay-bar").hidden], [true, false], "replay bar replaces the move pad");
  d.el("rp-fwd").fire("click"); d.el("rp-fwd").fire("click"); d.el("rp-back").fire("click");
  eq(d.api.state().rp.k, 1, "forward, forward, back");
  d.el("rp-last").fire("click"); eq(d.api.state().rp.k, 300, "last");
  d.el("rp-first").fire("click"); eq(d.api.state().rp.k, 0, "first");
  d.el("rp-policy").value = "beta"; d.el("rp-policy").fire("change");
  eq(d.api.state().rp.policy, "beta", "policy menu");
  d.el("rp-speed").value = "5"; d.el("rp-speed").fire("change");
  eq(d.api.state().speed, 50, "speed menu");
  d.el("rp-play").fire("click"); ok(d.api.state().rp.playing, "play button");
  d.runTimers(1000);
  eq([d.api.state().rp.k, d.api.state().rp.playing], [300, false], "plays to the end and stops");
  writeSVG(d, "replay_s4_beta_end");
  d.el("rp-exit").fire("click");
  eq([d.api.state().mode, d.el("pad").hidden], ["play", false], "back to the game");
});

test("dark theme renders with the dark colours", () => {
  const d = boot("#s3-4", "dark");
  const fills = new Set(d.ctx.ops().map(o => o.fill));
  ok(fills.has("#0f141c"), "dark background");
  d.key("v"); d.key("v"); d.key("End");
  writeSVG(d, "replay_s3_dark");
  d.api.loadReplay("current"); d.key("End");
  writeSVG(d, "replay_s3_current_dark");
});

test("overloaded game: replay of the player's moves stops at the overload", () => {
  const d = boot("#warmup-2");
  const st = d.api.state();
  // stack everything at arrival: on the warm-up (capacity 30) this rarely overloads, so force a tight capacity
  st.inst.cap = 4; st.game.cap = 4;
  let guard = 0;
  while (!st.game.done && guard++ < 1000)
    for (const a of C.movesTo(st.game, st.game.feasibleStarts()[0])) d.key({ left: "ArrowLeft", right: "ArrowRight", down: "ArrowDown" }[a[0]]);
  ok(st.game.done, "game should end");
  d.key("v");
  const s2 = d.api.state();
  eq(s2.rp.policy, "you", "your replay");
  d.key("End");
  eq(s2.rp.R.placed, st.game.i, "frames up to the overload");
  ok(st.game.failed ? d.el("ev").textContent.includes("overload") : true, "overload message");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
