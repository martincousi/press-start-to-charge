// Rules engine of the EV charging game (Ghahtarani et al. 2026, Sections 3-4 and EC Appendix D).
// Pure and deterministic: a level is (scenario, seed). Runs in the browser (window.Charge) and in node (require).
// Slots are 0-based here: slot k covers [k, k+1) quarter-hours after noon, k = 0..T-1.
(function (root) {
  "use strict";

  const T = 96;            // 24 h from noon, 15-minute slots (Section 7)
  const LMAX = 22;         // longest block: 5.5 h (EC Appendix D; L + 3T = 310 in EC Appendix E)
  const CAP = 140;         // per-slot capacity p_cap (not given in the paper; see README)

  // Arrival patterns of EC Appendix D, times in slots after noon (6 PM = 24, 4 PM = 16, 8 PM = 32).
  const SCENARIOS = {
    s1: { name: "Scenario 1", n: 200, peaks: [{ mean: 24, sd: 12, share: 1 }] },
    s2: { name: "Scenario 2", n: 200, peaks: [{ mean: 24, sd: 6, share: 1 }] },
    s3: { name: "Scenario 3", n: 200, peaks: [{ mean: 16, sd: 3, share: 0.5 }, { mean: 32, sd: 3, share: 0.5 }] },
    s4: { name: "Scenario 4", n: 300, peaks: [{ mean: 24, sd: 12, share: 1 }] },
    warmup: { name: "Warm-up", n: 50, cap: 30, peaks: [{ mean: 24, sd: 12, share: 1 }] },   // not in the paper
  };
  const DEPARTURE = { mean: 72, sd: 12 };   // 6 AM next day, 3 h standard deviation

  // mulberry32: small seeded generator, identical in every JavaScript engine.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(u, mean, sd) {        // Box-Muller, one draw per call
    const u1 = 1 - u(), u2 = u();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function truncNormal(u, mean, sd, lo, hi, fallback) {   // rejection sampling
    for (let k = 0; k < 1000; k++) { const x = normal(u, mean, sd); if (x >= lo && x <= hi) return x; }
    return fallback;
  }

  // An instance: EVs in order of (continuous) arrival. Each EV: arrival/departure times (slots after noon),
  // first usable slot a = ceil(arrival), last usable slot e = floor(departure) - 1, length l (slots).
  function generate(scenarioKey, seed, opts = {}) {
    const sc = SCENARIOS[scenarioKey];
    if (!sc) throw new Error("unknown scenario " + scenarioKey);
    const n = opts.n || sc.n, cap = opts.cap || sc.cap || CAP;
    const u = rng(seed);
    const evs = [];
    let left = n;
    sc.peaks.forEach((p, k) => {
      const m = k === sc.peaks.length - 1 ? left : Math.round(n * p.share);
      left -= m;
      for (let q = 0; q < m; q++) {
        const arr = truncNormal(u, p.mean, p.sd, 0, T - 1, p.mean);
        const a = Math.ceil(arr);
        // departure: at least one whole slot after the first usable slot, at most the end of the horizon
        const dep = truncNormal(u, DEPARTURE.mean, DEPARTURE.sd, a + 1, T, T);
        const e = Math.floor(dep) - 1;
        const l = Math.min(1 + Math.floor(u() * LMAX), e - a + 1);   // uniform 15 min .. 5.5 h, fitted to the window
        evs.push({ arrival: arr, departure: dep, a, e, l });
      }
    });
    evs.sort((x, y) => x.arrival - y.arrival);
    evs.forEach((ev, i) => { ev.id = i; });
    return { scenario: scenarioKey, seed, T, cap, evs };
  }

  function imbalance(loads) {
    let mx = -Infinity, mn = Infinity;
    for (const c of loads) { if (c > mx) mx = c; if (c < mn) mn = c; }
    return mx - mn;
  }
  function rmse(loads) {
    const m = loads.reduce((s, c) => s + c, 0) / loads.length;
    return Math.sqrt(loads.reduce((s, c) => s + (c - m) * (c - m), 0) / loads.length);
  }
  function reward(before, after) { return after < before ? 1 : after > before ? -1 : 0; }   // Equation (1)

  // Recompute everything from a schedule (start slot per EV, null = not placed), independently of Game.
  function score(inst, starts) {
    const loads = new Array(inst.T).fill(0);
    let total = 0, prev = 0, ok = true;
    starts.forEach((s, i) => {
      if (s === null || s === undefined) return;
      const ev = inst.evs[i];
      if (s < ev.a || s + ev.l - 1 > ev.e) ok = false;
      for (let j = s; j < s + ev.l; j++) loads[j] += 1;
      const now = imbalance(loads);
      total += reward(prev, now); prev = now;
    });
    if (loads.some(c => c > inst.cap)) ok = false;
    return { loads, maxMin: imbalance(loads), peak: Math.max(...loads), rmse: rmse(loads), rewardSum: total, feasible: ok };
  }

  class Game {
    constructor(inst) {
      this.inst = inst; this.T = inst.T; this.cap = inst.cap;
      this.loads = new Array(this.T).fill(0);
      this.stacks = Array.from({ length: this.T }, () => []);   // EV ids per slot, bottom first (for drawing)
      this.starts = new Array(inst.evs.length).fill(null);
      this.i = 0; this.pos = null; this.moves = 0;
      this.rewardSum = 0; this.lastReward = null; this.steps = 0; this.history = [];
      this.done = false; this.failed = false;
      this._arrive();
    }
    get ev() { return this.done ? null : this.inst.evs[this.i]; }
    // range of legal start slots for the current block (its feasible window)
    window() { const ev = this.ev; return [ev.a, ev.e - ev.l + 1]; }
    fits(s) {
      const ev = this.ev, [lo, hi] = this.window();
      if (s < lo || s > hi) return false;
      for (let j = s; j < s + ev.l; j++) if (this.loads[j] + 1 > this.cap) return false;
      return true;
    }
    feasibleStarts() { const [lo, hi] = this.window(), out = []; for (let s = lo; s <= hi; s++) if (this.fits(s)) out.push(s); return out; }
    get maxMoves() { return this.T; }   // action limit = width of the board (Section 4.1)

    _arrive() {
      if (this.i >= this.inst.evs.length) { this.done = true; this.pos = null; return; }
      this.pos = this.ev.a; this.moves = 0;       // a block appears at its arrival slot
      if (this.feasibleStarts().length === 0) { this.done = true; this.failed = true; this.pos = null; }
    }

    legalActions() {
      if (this.done) return [];
      const [lo, hi] = this.window(), out = [];
      if (this.pos > lo) out.push(["left"]);
      if (this.pos < hi) out.push(["right"]);
      if (this.fits(this.pos)) out.push(["down"]);
      for (const s of this.feasibleStarts()) out.push(["schedule", s]);
      return out;
    }

    // Load and imbalance if the current block were dropped at s (for previews).
    preview(s) {
      const loads = this.loads.slice(), ev = this.ev;
      for (let j = s; j < s + ev.l; j++) loads[j] += 1;
      const after = imbalance(loads);
      return { maxMin: after, reward: reward(imbalance(this.loads), after) };
    }

    _place(s) {
      const ev = this.ev, before = imbalance(this.loads);
      for (let j = s; j < s + ev.l; j++) { this.loads[j] += 1; this.stacks[j].push(ev.id); }
      this.starts[this.i] = s;
      const r = reward(before, imbalance(this.loads));
      this.rewardSum += r; this.lastReward = r;
      this.i += 1;
      this._arrive();
      return r;
    }

    // Actions: ["left"], ["right"], ["down"] (movement) or ["schedule", s] (schedule). Returns the reward (0 for a shift).
    step(action) {
      if (this.done) throw new Error("episode is over");
      const kind = action[0], [lo, hi] = this.window();
      let r = 0;
      if (kind === "left" || kind === "right") {
        const t = this.pos + (kind === "left" ? -1 : 1);
        if (t < lo || t > hi) throw new Error("illegal move " + kind);
        this.pos = t; this.moves += 1;
        if (this.moves >= this.maxMoves) {       // action limit reached: automatic drop
          const s = this.fits(this.pos) ? this.pos : nearest(this.feasibleStarts(), this.pos);
          r = this._place(s);
        }
      } else if (kind === "down") {
        if (!this.fits(this.pos)) throw new Error("block exceeds capacity here");
        r = this._place(this.pos);
      } else if (kind === "schedule") {
        if (!this.fits(action[1])) throw new Error("illegal start " + action[1]);
        r = this._place(action[1]);
      } else throw new Error("unknown action " + JSON.stringify(action));
      this.steps += 1; this.history.push(action);
      return r;
    }
  }
  function nearest(list, x) {   // closest value, earlier on ties
    let best = list[0];
    for (const v of list) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
    return best;
  }

  // Thresholds X of the X-threshold heuristics (Section 6.2.1), computed once from a set D of simulated
  // instances: seeds 1000001-1000100 of each level (D_SEEDS), disjoint from the seeds a player normally uses.
  //   alpha: X = ceil(p_bar), p_bar = mean number of EVs charging per slot over D (sum of lengths / T, averaged).
  //   beta:  X = mean over D of the oracle's peak load (Model B.1 solved exactly by tools/oracle_peaks.py;
  //          the schedules are in tools/oracle_D.json and re-checked by the tests). Loads are integers, so
  //          "load < X" is the same as "load < ceil(X)"; we store ceil(X).
  // test/engine_test.js recomputes both from D.
  const D_SEEDS = [1000001, 1000100];
  const THRESHOLDS = {
    warmup: { alpha: 6, beta: 9 },     // p_bar 5.97, oracle peak 8.02
    s1: { alpha: 24, beta: 31 },       // p_bar 23.93, oracle peak 30.32
    s2: { alpha: 25, beta: 34 },       // p_bar 24.02, oracle peak 33.67
    s3: { alpha: 24, beta: 33 },       // p_bar 23.99, oracle peak 32.17
    s4: { alpha: 36, beta: 46 },       // p_bar 35.77, oracle peak 45.04
  };

  // Row-filling (Section 6.2, after the lowest-horizontal-line algorithm of Zhang et al. 2019): scan the
  // load matrix row by row from the bottom and, within a row, from left to right, and take the first start
  // at which the block fits in that row inside the feasible window. The block fits in row r at start s when
  // every slot it covers has at most r units (the cell of row r is free). This is the start with the lowest
  // highest load under the block, earliest on ties.
  function rowFill(g) {
    const ev = g.ev, starts = g.feasibleStarts();
    for (let r = 0; r < g.cap; r++)
      for (const s of starts) {
        let fits = true;
        for (let j = s; j < s + ev.l; j++) if (g.loads[j] > r) { fits = false; break; }
        if (fits) return s;
      }
    return starts[0];   // not reached: a feasible start fits in row cap - 1
  }
  // X-threshold (Section 6.2.1): an EV arriving at slot a starts there if the load of slot a is below X
  // (and the block fits under the capacity); otherwise it is placed by Row-filling.
  function threshold(X) { return g => (g.loads[g.ev.a] < X && g.fits(g.ev.a)) ? g.ev.a : rowFill(g); }
  function levelThreshold(g, which) {
    const t = THRESHOLDS[g.inst.scenario];
    if (!t) throw new Error("no threshold for level " + g.inst.scenario);
    return threshold(t[which])(g);
  }

  // Policies: map a game state to a start slot (played with schedule actions). All are online: they see the
  // load so far and the arriving EV only.
  const POLICIES = {
    // Current practice (Section 6.2): start charging on arrival (earliest feasible start if capacity forbids it).
    current: g => g.fits(g.ev.a) ? g.ev.a : g.feasibleStarts()[0],
    // Greedy rule of Chau et al. (2023): the start that increases the sum of squared loads the least,
    // i.e. the smallest sum of loads under the block; earliest on ties.
    greedy: g => {
      let best = null, bestV = Infinity;
      for (const s of g.feasibleStarts()) {
        let v = 0;
        for (let j = s; j < s + g.ev.l; j++) v += 2 * g.loads[j] + 1;
        if (v < bestV) { bestV = v; best = s; }
      }
      return best;
    },
    rowfill: rowFill,
    alpha: g => levelThreshold(g, "alpha"),
    beta: g => levelThreshold(g, "beta"),
  };
  const POLICY_NAMES = { current: "Current practice", greedy: "Greedy", rowfill: "Row-filling",
                         alpha: "α-threshold", beta: "β-threshold" };
  function play(inst, policy) {
    const g = new Game(inst), f = typeof policy === "function" ? policy : POLICIES[policy];
    while (!g.done) g.step(["schedule", f(g)]);
    return g;
  }

  // Replay of an action sequence (a policy's schedule actions, or a player's movement actions), re-stepped
  // through the engine. Frame k = the state after k EVs have been placed (k = 0..placed). Each frame records
  // the running metrics; gameAt(k) rebuilds the game at frame k by stepping the first actions again.
  class Replay {
    constructor(inst, actions) {
      this.inst = inst; this.actions = actions.map(a => a.slice());
      const g = new Game(inst);
      this.cut = [0];                       // number of actions consumed when k EVs are placed
      this.frames = [frameOf(g)];
      this.actions.forEach((a, t) => {
        const before = g.i;
        g.step(a);
        if (g.i > before) { this.cut.push(t + 1); this.frames.push(frameOf(g)); }
      });
      this.final = g;
      this.placed = g.i;                    // number of frames - 1
      this.starts = g.starts.slice();
    }
    gameAt(k) {
      k = Math.max(0, Math.min(this.placed, k));
      const g = new Game(this.inst);
      for (let t = 0; t < this.cut[k]; t++) g.step(this.actions[t]);
      return g;
    }
  }
  function frameOf(g) {
    return { i: g.i, maxMin: imbalance(g.loads), rmse: rmse(g.loads), peak: Math.max(...g.loads),
             rewardSum: g.rewardSum, lastReward: g.lastReward, done: g.done, failed: g.failed };
  }

  // Movement sequence that brings the current block from its position to start s and drops it.
  function movesTo(g, s) {
    const out = [], d = s > g.pos ? "right" : "left";
    for (let k = 0; k < Math.abs(s - g.pos); k++) out.push([d]);
    out.push(["down"]);
    return out;
  }

  function slotClock(k) {   // start time of slot k, "HH:MM"
    const m = (12 * 60 + 15 * k) % (24 * 60);
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }
  function timeClock(t) {   // continuous time in slots after noon -> "HH:MM"
    const m = Math.round(12 * 60 + 15 * t) % (24 * 60);
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }

  const api = { T, LMAX, CAP, SCENARIOS, DEPARTURE, rng, generate, imbalance, rmse, reward, score,
                Game, POLICIES, POLICY_NAMES, THRESHOLDS, D_SEEDS, rowFill, threshold, play, Replay, movesTo,
                slotClock, timeClock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Charge = api;
})(this);
