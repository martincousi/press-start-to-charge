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

test("a complete game charges every EV for its full length before departure", () => {
  for (const k of KEYS) for (let seed = 1; seed <= 20; seed++) {
    const inst = C.generate(k, seed);
    for (const p of ["greedy", "current"]) {
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
