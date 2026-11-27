// Tests of the rules engine. Run: node test/engine_test.js
"use strict";
const path = require("path");
const C = require(path.join(__dirname, "..", "engine.js"));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("PASS", name); }
  catch (e) { fail++; console.log("FAIL", name, "-", e.message); }
}
function eq(a, b, what) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what}: got ${sa}, expected ${sb}`);
}
function ok(c, what) { if (!c) throw new Error(what); }
const KEYS = Object.keys(C.SCENARIOS);

// Independent recomputation from a schedule (no engine code): loads, Max-Min, rewards of Eq. (1).
function recompute(inst, starts) {
  const loads = new Array(inst.T).fill(0);
  let prev = 0, sum = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] === null) continue;
    for (let k = 0; k < inst.evs[i].l; k++) loads[starts[i] + k]++;
    const d = Math.max(...loads) - Math.min(...loads);
    sum += d < prev ? 1 : d > prev ? -1 : 0;
    prev = d;
  }
  return { loads, maxMin: Math.max(...loads) - Math.min(...loads), rewardSum: sum };
}
function hand(T, cap, evs) { return { T, cap, evs: evs.map((e, id) => ({ id, arrival: e.a, departure: e.e + 1, ...e })) }; }

test("same seed gives the same instance and the same heuristic schedules", () => {
  for (const k of KEYS) {
    eq(C.generate(k, 7), C.generate(k, 7), k + " instance");
    eq(C.play(C.generate(k, 7), "greedy").starts, C.play(C.generate(k, 7), "greedy").starts, k + " greedy");
  }
  ok(JSON.stringify(C.generate("s1", 1)) !== JSON.stringify(C.generate("s1", 2)), "seeds 1 and 2 give the same instance");
});

test("generated EVs are well formed (window inside the stay, 1 <= l <= 22, sorted by arrival)", () => {
  for (const k of KEYS) for (let seed = 1; seed <= 50; seed++) {
    const inst = C.generate(k, seed);
    eq(inst.evs.length, C.SCENARIOS[k].n, k + " number of EVs");
    inst.evs.forEach((ev, i) => {
      ok(ev.id === i, "id");
      ok(i === 0 || inst.evs[i - 1].arrival <= ev.arrival, "not sorted");
      ok(Number.isInteger(ev.a) && Number.isInteger(ev.e) && 0 <= ev.a && ev.a <= ev.e && ev.e < inst.T, "window " + JSON.stringify(ev));
      ok(ev.arrival <= ev.a && ev.departure >= ev.e + 1 && ev.departure <= inst.T, "charging outside the stay " + JSON.stringify(ev));
      ok(ev.l >= 1 && ev.l <= C.LMAX && ev.l <= ev.e - ev.a + 1, "length " + JSON.stringify(ev));
    });
  }
});

// Random play mixing movement and schedule actions; every legal action must be accepted, and the
// capacity must hold after every step. A tight capacity (8) forces overloads to occur.
function randomPlay(inst, u) {
  const g = new C.Game(inst);
  while (!g.done) {
    const legal = g.legalActions();
    ok(legal.length > 0, "no legal action in a running game");
    const a = legal[Math.floor(u() * legal.length)];
    const before = g.i;
    g.step(a);
    ok(g.loads.every(c => c <= inst.cap), "capacity exceeded");
    if (g.i > before) {                                   // a block was placed
      const ev = inst.evs[before], s = g.starts[before];
      ok(s >= ev.a && s + ev.l - 1 <= ev.e, "block outside its window");
    }
  }
  return g;
}
test("capacity never exceeded and blocks stay in their windows (random play, 2000 episodes)", () => {
  const u = C.rng(12345);
  let overloads = 0, complete = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    for (const cap of [C.CAP, 8]) {
      const inst = C.generate(seed % 2 ? "s1" : "warmup", seed, { cap });
      const g = randomPlay(inst, u);
      if (g.failed) {
        overloads++;
        const ev = inst.evs[g.i];                         // the EV that ended the game truly has no feasible start
        for (let s = ev.a; s + ev.l - 1 <= ev.e; s++) {
          let fits = true;
          for (let j = s; j < s + ev.l; j++) if (g.loads[j] + 1 > cap) fits = false;
          ok(!fits, "game ended although a feasible start existed");
        }
      } else complete++;
    }
  }
  ok(overloads > 0 && complete > 0, `expected both outcomes, got ${overloads} overloads and ${complete} complete games`);
});

test("a complete game charges every EV for its full length before departure (every policy)", () => {
  for (const k of KEYS) for (let seed = 1; seed <= 20; seed++) {
    const inst = C.generate(k, seed);
    for (const p of Object.keys(C.POLICIES)) {
      const g = C.play(inst, p);
      ok(!g.failed && g.done, `${k}/${seed}/${p} did not finish`);
      g.starts.forEach((s, i) => {
        const ev = inst.evs[i];
        ok(s !== null && s >= ev.a && s + ev.l - 1 <= ev.e, `EV ${i} not charged in its window`);
      });
      const charged = g.loads.reduce((x, y) => x + y, 0), needed = inst.evs.reduce((x, e) => x + e.l, 0);
      eq(charged, needed, "total charging slots");
    }
  }
});

test("score equals an independent recomputation from the final schedule", () => {
  const u = C.rng(99);
  for (let seed = 1; seed <= 200; seed++) {
    const inst = C.generate(KEYS[seed % KEYS.length], seed);
    for (const g of [randomPlay(inst, u), C.play(inst, "greedy")]) {
      const r = recompute(inst, g.starts), sc = C.score(inst, g.starts);
      eq(g.loads, r.loads, "loads");
      eq(g.rewardSum, r.rewardSum, "cumulative reward");
      eq(sc.maxMin, r.maxMin, "Max-Min");
      eq(sc.rewardSum, r.rewardSum, "score() reward");
      const m = r.loads.reduce((x, y) => x + y, 0) / inst.T;
      const rm = Math.sqrt(r.loads.reduce((x, c) => x + (c - m) ** 2, 0) / inst.T);
      ok(Math.abs(sc.rmse - rm) < 1e-12, "RMSE");
      if (!g.failed) ok(sc.feasible, "complete schedule flagged infeasible");
    }
  }
});

test("scripted episode, checked by hand (movement actions, capacity 2)", () => {
  // T = 8 slots, capacity 2.
  // EV0 window 0..5, length 3: right, right, down -> slots 2-4, loads 0 0 1 1 1 0 0 0, imbalance 0 -> 1, reward -1.
  // EV1 window 1..7, length 2: down at arrival -> slots 1-2, loads 0 1 2 1 1 0 0 0, imbalance 1 -> 2, reward -1.
  // EV2 window 2..7, length 3: dropping at 2 would put 3 EVs in slot 2 (> 2), so down is illegal there;
  //     right x3 -> slots 5-7, loads 0 1 2 1 1 1 1 1, imbalance 2 -> 2, reward 0.
  // EV3 window 2..3, length 2: slot 2 is full, no start fits -> the game ends in an overload.
  const inst = hand(8, 2, [{ a: 0, e: 5, l: 3 }, { a: 1, e: 7, l: 2 }, { a: 2, e: 7, l: 3 }, { a: 2, e: 3, l: 2 }]);
  const g = new C.Game(inst);
  eq(g.pos, 0, "EV0 appears at its arrival slot");
  eq(g.legalActions().filter(a => a[0] !== "schedule"), [["right"], ["down"]], "EV0 movement actions");
  eq([g.step(["right"]), g.step(["right"]), g.step(["down"])], [0, 0, -1], "EV0 rewards");
  eq(g.loads, [0, 0, 1, 1, 1, 0, 0, 0], "loads after EV0");
  eq(g.step(["down"]), -1, "EV1 reward");
  eq(g.loads, [0, 1, 2, 1, 1, 0, 0, 0], "loads after EV1");
  eq(g.pos, 2, "EV2 appears at slot 2");
  ok(!g.legalActions().some(a => a[0] === "down"), "down should be illegal over capacity");
  let threw = false; try { g.step(["down"]); } catch (e) { threw = true; }
  ok(threw, "down over capacity was accepted");
  eq(g.feasibleStarts(), [3, 4, 5], "EV2 feasible starts");
  g.step(["right"]); g.step(["right"]); g.step(["right"]);
  let left = false; try { g.step(["right"]); } catch (e) { left = true; }
  ok(left, "moved past the end of the window");
  eq(g.step(["down"]), 0, "EV2 reward");
  eq(g.loads, [0, 1, 2, 1, 1, 1, 1, 1], "loads after EV2");
  eq([g.done, g.failed, g.i], [true, true, 3], "overload at EV3");
  eq(g.starts, [2, 1, 5, null], "starts");
  eq(g.rewardSum, -2, "cumulative reward");
  eq(C.score(inst, g.starts).maxMin, 2, "Max-Min");
  eq(g.steps, 8, "steps: 3 + 1 + 4 (the refused down is not counted)");
});

test("scripted episode with a +1 reward (schedule actions)", () => {
  // T = 4. EV0 window 0..1, length 2 -> loads 1 1 0 0, imbalance 1, reward -1.
  // EV1 window 0..3, length 2, scheduled at 2 -> loads 1 1 1 1, imbalance 0, reward +1. Max-Min 0, RMSE 0.
  const inst = hand(4, 5, [{ a: 0, e: 1, l: 2 }, { a: 0, e: 3, l: 2 }]);
  const g = new C.Game(inst);
  eq(g.step(["schedule", 0]), -1, "EV0");
  eq(g.preview(1), { maxMin: 2, reward: -1 }, "preview at 1 (loads 1 2 1 0)");
  eq(g.step(["schedule", 2]), 1, "EV1");
  eq([g.done, g.failed, g.rewardSum], [true, false, 0], "end");
  eq(C.score(inst, g.starts), { loads: [1, 1, 1, 1], maxMin: 0, peak: 1, rmse: 0, rewardSum: 0, feasible: true }, "score");
});

test("action limit: after T shifts the block drops where it is", () => {
  const inst = hand(8, 5, [{ a: 0, e: 7, l: 1 }, { a: 0, e: 7, l: 1 }]);
  const g = new C.Game(inst);
  for (let k = 0; k < 7; k++) g.step([k % 2 ? "left" : "right"]);   // 7 shifts, ends at slot 1
  eq([g.i, g.pos, g.moves], [0, 1, 7], "before the limit");
  g.step(["right"]);                                                // 8th shift = T: automatic drop at slot 2
  eq([g.i, g.starts[0]], [1, 2], "auto drop");
});

test("greedy and current practice by hand; movement reaches the same schedule as schedule actions", () => {
  // Loads after EV0 (slots 0-1): 1 1 0 0 0 0. EV1 (window 0..5, length 2): greedy picks the earliest
  // start with the lowest load under it, slot 2; current practice starts at arrival, slot 0.
  const inst = hand(6, 5, [{ a: 0, e: 1, l: 2 }, { a: 0, e: 5, l: 2 }]);
  eq(C.play(inst, "greedy").starts, [0, 2], "greedy");
  eq(C.play(inst, "current").starts, [0, 0], "current practice");
  for (const k of KEYS) {
    const big = C.generate(k, 3), ref = C.play(big, "greedy"), g = new C.Game(big);
    while (!g.done) for (const a of C.movesTo(g, C.POLICIES.greedy(g))) g.step(a);
    eq(g.starts, ref.starts, k + " movement vs schedule");
  }
});

// ---------------------------------------------------------------- heuristics of Section 6.2 / 6.2.1
// Loads 1 2 1 0 1 0 on T = 6, built with schedule actions; then an EV with window 1..5 and length 2.
function sixSlots(last) {
  const inst = hand(6, 5, [{ a: 0, e: 1, l: 2 }, { a: 2, e: 2, l: 1 }, { a: 4, e: 4, l: 1 }, { a: 1, e: 1, l: 1 }, last]);
  const g = new C.Game(inst);
  for (const s of [0, 2, 4, 1]) g.step(["schedule", s]);
  eq(g.loads, [1, 2, 1, 0, 1, 0], "loads");
  return g;
}
test("Row-filling by hand: lowest row first, then leftmost start", () => {
  // Window 0..5, length 2. Row 0 (slots with load 0 under the whole block): starts 3 -> (0, 1) no, 4 -> (1, 0) no.
  // Row 1: start 0 -> loads (1, 2) no; 1 -> (2, 1) no; 2 -> (1, 0) yes.
  const g = sixSlots({ a: 0, e: 5, l: 2 });
  eq(C.rowFill(g), 2, "Row-filling");
  eq(C.POLICIES.rowfill(g), 2, "Row-filling policy");
  // A case where Row-filling and Greedy differ: loads 0 2 1 1, block of length 2 in window 0..3.
  // Greedy: sums 2 (start 0), 3, 2 (start 2) -> earliest, 0. Row-filling: row 0 none, row 1 -> start 2 (loads 1, 1).
  const inst = hand(4, 5, [{ a: 1, e: 1, l: 1 }, { a: 1, e: 1, l: 1 }, { a: 2, e: 3, l: 2 }, { a: 0, e: 3, l: 2 }]);
  const h = new C.Game(inst);
  for (const s of [1, 1, 2]) h.step(["schedule", s]);
  eq(h.loads, [0, 2, 1, 1], "loads");
  eq([C.POLICIES.greedy(h), C.rowFill(h)], [0, 2], "greedy vs Row-filling");
  // With a block of length 1 in window 0..5, row 0 has slots 3 and 5: the leftmost, 3.
  eq(C.rowFill(sixSlots({ a: 0, e: 5, l: 1 })), 3, "length 1");
});
test("X-threshold by hand: start on arrival if the load there is below X, Row-filling otherwise", () => {
  // EV with window 1..5, length 2; load of its arrival slot 1 is 2.
  const g = sixSlots({ a: 1, e: 5, l: 2 });
  eq(C.threshold(3)(g), 1, "X = 3: 2 < 3, starts on arrival");
  eq(C.threshold(2)(g), 2, "X = 2: 2 is not below 2, Row-filling");
  eq(C.rowFill(g), 2, "Row-filling");
  // capacity: with capacity 2 the arrival slot is full, so the rule falls back to Row-filling even with X large
  const tight = sixSlots({ a: 1, e: 5, l: 2 }); tight.cap = 2;
  eq(C.threshold(99)(tight), 2, "full arrival slot");
});
test("Row-filling equals 'lowest highest load under the block, earliest' (random states)", () => {
  const u = C.rng(7);
  for (let seed = 1; seed <= 60; seed++) {
    const inst = C.generate(KEYS[seed % KEYS.length], seed), g = new C.Game(inst);
    while (!g.done) {
      let best = null, bv = Infinity;
      for (const s of g.feasibleStarts()) {
        let m = 0; for (let j = s; j < s + g.ev.l; j++) m = Math.max(m, g.loads[j]);
        if (m < bv) { bv = m; best = s; }
      }
      eq(C.rowFill(g), best, `seed ${seed} EV ${g.i}`);
      const fs = g.feasibleStarts();
      g.step(["schedule", fs[Math.floor(u() * fs.length)]]);   // random states, not only Row-filling's own
    }
  }
});
test("threshold constants: alpha = ceil(mean load per slot over D), beta = ceil(mean oracle peak over D)", () => {
  const fs = require("fs");
  const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "oracle_D.json"), "utf8"));
  const [s0, s1] = C.D_SEEDS;
  for (const k of KEYS) {
    let pbar = 0, peaks = 0;
    const rows = oracle.levels[k].instances;
    eq(rows.map(r => r.seed), Array.from({ length: s1 - s0 + 1 }, (_, i) => s0 + i), k + " oracle seeds");
    for (const r of rows) {
      const inst = C.generate(k, r.seed);
      pbar += inst.evs.reduce((x, e) => x + e.l, 0) / inst.T;
      // re-check the solver's schedule independently: complete, in the windows, under the capacity, same Max-Min
      const sc = C.score(inst, r.starts), rc = recompute(inst, r.starts);
      ok(sc.feasible && r.starts.every(s => s !== null), `${k}/${r.seed}: oracle schedule infeasible`);
      eq(rc.maxMin, r.maxMin, `${k}/${r.seed}: oracle Max-Min`);
      eq(Math.min(...rc.loads), 0, `${k}/${r.seed}: min load (so the peak is the Max-Min)`);
      // no online policy beats the full-information optimum
      for (const p of Object.keys(C.POLICIES)) ok(C.score(inst, C.play(inst, p).starts).maxMin >= r.maxMin, `${k}/${r.seed}: ${p} below the oracle`);
      peaks += r.maxMin;
    }
    pbar /= rows.length; peaks /= rows.length;
    ok(Math.abs(peaks - oracle.levels[k].meanPeak) < 1e-9, k + " mean peak");
    eq([C.THRESHOLDS[k].alpha, C.THRESHOLDS[k].beta], [Math.ceil(pbar), Math.ceil(peaks)], k + " thresholds");
  }
});

// ---------------------------------------------------------------- replays
test("replay of every policy's actions reproduces its final metrics through the engine", () => {
  for (const k of KEYS) for (let seed = 1; seed <= 10; seed++) {
    const inst = C.generate(k, seed);
    for (const p of Object.keys(C.POLICIES)) {
      const g = C.play(inst, p), R = new C.Replay(inst, g.history);
      eq(R.placed, inst.evs.length, `${k}/${seed}/${p} frames`);
      eq(R.starts, g.starts, "starts");
      const f = R.frames[R.placed], sc = C.score(inst, g.starts);
      eq([f.maxMin, f.rmse, f.rewardSum, f.done, f.failed], [sc.maxMin, sc.rmse, sc.rewardSum, true, false], `${k}/${seed}/${p} final`);
      eq(R.final.loads, g.loads, "final loads");
      // running values at a few frames, against an independent recomputation of the prefix
      for (const kk of [0, 1, 37, R.placed - 1]) {
        const pre = g.starts.map((s, i) => i < kk ? s : null), rc = recompute(inst, pre), fr = R.frames[kk];
        eq([fr.i, fr.maxMin, fr.rewardSum], [kk, rc.maxMin, rc.rewardSum], `${k}/${seed}/${p} frame ${kk}`);
        eq(R.gameAt(kk).loads, rc.loads, `${k}/${seed}/${p} gameAt(${kk})`);
      }
    }
  }
});
test("replay of movement actions (random play, with overloads) matches the game frame by frame", () => {
  const u = C.rng(2024);
  let failed = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const inst = C.generate("warmup", seed, { cap: seed % 3 ? C.SCENARIOS.warmup.cap : 6 });
    const g = randomPlay(inst, u), R = new C.Replay(inst, g.history);
    if (g.failed) failed++;
    eq([R.placed, R.final.done, R.final.failed, R.final.rewardSum], [g.i, true, g.failed, g.rewardSum], `seed ${seed}`);
    eq(R.final.loads, g.loads, "loads");
    eq(R.cut[R.placed] <= g.history.length, true, "cut");
    for (let k = 0; k <= R.placed; k += 7) {
      const gk = R.gameAt(k);
      eq([gk.i, gk.rewardSum], [k, R.frames[k].rewardSum], `seed ${seed} frame ${k}`);
    }
  }
  ok(failed > 0, "expected some overloaded games");
});

test("calibration: heuristics vs Greedy, same ratios as the paper within 0.05 (EC Tables 1-4, 100 seeds)", () => {
  const paper = { s1: { greedy: 38.38, rowfill: 39.82, alpha: 35.72, beta: 34.20 },
                  s2: { greedy: 44.05, rowfill: 45.43, alpha: 43.50, beta: 42.24 },
                  s3: { greedy: 44.59, rowfill: 45.90, alpha: 44.12, beta: 43.20 },
                  s4: { greedy: 56.81, rowfill: 58.63, alpha: 51.72, beta: 49.85 } };
  for (const k of Object.keys(paper)) {
    const m = {}, r = {};
    for (const p of Object.keys(paper[k])) { m[p] = 0; r[p] = 0; }
    for (let seed = 1; seed <= 100; seed++) {
      const inst = C.generate(k, seed);
      for (const p of Object.keys(m)) { const sc = C.score(inst, C.play(inst, p).starts); m[p] += sc.maxMin / 100; r[p] += sc.rmse / 100; }
    }
    console.log(`     ${k}: ` + Object.keys(m).map(p => `${p} ${m[p].toFixed(2)} / ${r[p].toFixed(2)} (paper ${paper[k][p]})`).join(", "));
    for (const p of ["rowfill", "alpha", "beta"]) {
      const ours = m[p] / m.greedy, theirs = paper[k][p] / paper[k].greedy;
      ok(Math.abs(ours - theirs) < 0.05, `${k} ${p}: ratio ${ours.toFixed(3)} vs paper ${theirs.toFixed(3)}`);
    }
  }
});

test("calibration: current practice Max-Min within 10% of the paper (EC Tables 1-4, 100 seeds)", () => {
  const paper = { s1: 75.24, s2: 116.19, s3: 90.01, s4: 109.21 };
  for (const k of Object.keys(paper)) {
    let s = 0;
    for (let seed = 1; seed <= 100; seed++) s += C.score(C.generate(k, seed), C.play(C.generate(k, seed), "current").starts).maxMin;
    const m = s / 100;
    console.log(`     ${k}: current practice mean Max-Min ${m.toFixed(2)} (paper ${paper[k]})`);
    ok(Math.abs(m - paper[k]) / paper[k] < 0.10, `${k}: ${m}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
