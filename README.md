# Press Start to Charge

A browser version, for human players, of the game in

> Ghahtarani A, Cousineau M, Farahmand A-m, Mendoza JE (2026) Press Start to Charge: Gamifying the Online
> Centralized Charging Scheduling Problem. Under revision at *INFORMS Journal on Computing*. arXiv:2601.12543.

The game casts the online centralized charging scheduling problem (OCCSP) as a Tetris-like game. Electric vehicles
(EVs) plug in at home one at a time; each needs a number of 15-minute charging slots, without interruption, between
its arrival and its departure. A central scheduler decides when each EV charges, without knowing the EVs still to come,
and tries to keep the total load flat over the day.

Open `index.html` in a browser (no build step, no server needed). It uses plain JavaScript; the only remote resource
is the Google Fonts stylesheet.

## Rules as implemented

- The board has T = 96 columns (15-minute slots from noon to noon) and `cap` rows (capacity units). See
  *Vertical scale* below for how the rows are drawn.
- EVs arrive in order of arrival time. The arriving EV is a block of width `l` slots in the action area above the board.
  Columns outside its window (from its arrival to its departure) are shaded red; the window is outlined in green.
- Dropping the block adds one unit of load to every slot it covers (the block settles column by column on top of the
  load already there). A drop that would take any slot above the capacity is not allowed.
- Every EV is placed exactly once, contiguously, inside its window, so it receives its full charge before it leaves.
  If an arriving EV has no start that respects the capacity, the game ends (overload).
- Score: the reward of Equation (1) after each drop (+1 if the max-min load difference shrinks, -1 if it grows, 0
  otherwise), the cumulative reward, and the paper's evaluation metrics, Max-Min load (the OCCSP objective) and
  RMSE of the load around its mean. Lower Max-Min is better.
- No undo: as in the online problem, a decision is final and the next EV is not shown in advance.

## Actions

The player uses the paper's **movement** actions (Section 4.5): left / right shift the block one slot inside its
window, down drops it. The block appears at its arrival slot. After T = 96 shifts the block drops by itself
(Section 4.1). The paper's schedule action (name the start slot directly) leads to the same schedules, so the page
does not offer it; the engine keeps it as `["schedule", s]` because the benchmark policies use it.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` | shift the block one slot |
| `↓`, `Space`, `Enter` | drop |
| `1`-`5` / `N` / `R` | level / next seed / restart |
| `V` | watch the replays (during a game: asks first, a second `V` confirms) |

In a replay:

| Key | Action |
| --- | --- |
| `Space` (or `K`) | play / pause |
| `←` `→` | one EV back / forward |
| `Home` `End` | first / last EV |
| `-` `+` (or `[` `]`) | slower / faster (1, 2, 5, 10, 20 or 50 EVs per second) |
| `P` / `Shift`+`P` | next / previous policy |
| `Esc` (or `V`) | back to your game |

Mouse and touch are optional: buttons for left, drop and right; in a replay, a policy menu, buttons (first,
back, play/pause, forward, last), a speed menu and a slider over the EVs. The level and seed are kept in the URL
(`#s1-7` is Scenario 1, seed 7).

## Vertical scale

One unit of load (one EV charging in one slot) was 396 / 140 = 2.8 pixels tall on the scenarios (capacity 140).
The board is now 820 x 580 (logical pixels) and its vertical axis stops below the capacity: it runs from 0 to
`ymax`, the highest peak of the four benchmark heuristics other than current practice on this instance, plus 15 %,
rounded up to a multiple of 5 (45 to 90 on seeds 1-100). Loads from `ymax` to the capacity are drawn in a
compressed grey band at the top of the board, marked with a zigzag on the axis and "compressed: ymax to 140", in a
darker colour; the capacity line and its label stay at the top. The scale is computed when the level starts and
does not change during the game or the replays. One unit is then about 9 pixels on Scenarios 1-3 and 6.1 pixels on
Scenario 4 (means over seeds 1-100; at least 7.8 and 5.2 pixels) when the board is 820 pixels wide.
The arriving block in the action area is one unit tall, as on the board.

The board keeps its proportions and is sized to fit the window height (`min(100%, (100vh - 190px) x 820/580)`), so
on a laptop (about 650 pixels of window height) the whole board, the message line and the buttons fit once the board
is scrolled to the top. Compared with the old page at that size (2.9 pixels per unit), one unit is then about 2.5
times taller on Scenarios 1-3 and 1.7 times on Scenario 4; on a 1920 x 1080 screen the board grows (up to 1120
pixels wide) and the ratios are about 4 and 2.8. The canvas is drawn at the screen's pixel density. The warm-up
level (capacity 30) keeps the full axis up to the capacity, at 16 pixels per unit (13 before).

## Replays

After the game (complete or overloaded), `V` or *Watch replays* opens a replay of any benchmark policy, or of your
own game, on the same EVs. During a game, a replay would show the EVs still to come, so the page asks for an
explicit confirmation first (*Reveal and watch*); the score panel then says "replays seen before the end".

A replay re-steps the policy's recorded actions through the engine (`Charge.Replay`; schedule actions for the
benchmark policies, your left / right / down moves for your own game); it is not a separate simulation. Frame k
shows the board after k EVs, with EV k in the action area at the start the policy gives it and its landing place
shaded, and the running values: EVs placed, Max-Min, RMSE and cumulative reward of Equation (1) with the last
reward. At the last frame these equal the values in the score panel (checked by the tests).

## Paper averages

A collapsible panel shows the paper's averages for the current scenario (EC Tables 1-4: Max-Min and RMSE of the
oracle, Re-opt, the rolling 2SSP at seven lookaheads, the six heuristics and the eight supervised / DAgger agents;
for Scenario 1 also the reinforcement-learning agents of EC Table 5). They are means over the paper's 100 test
instances, not values for the seed on screen; the heuristics run on this page are in bold.

## Levels

| Level | EVs | Arrivals (normal) | Capacity |
| --- | --- | --- | --- |
| 1. Warm-up (not in the paper) | 50 | mean 6 PM, sd 3 h | 30 |
| 2. Scenario 1 | 200 | mean 6 PM, sd 3 h | 140 |
| 3. Scenario 2 | 200 | mean 6 PM, sd 1.5 h | 140 |
| 4. Scenario 3 | 200 | 100 at 4 PM and 100 at 8 PM, sd 45 min | 140 |
| 5. Scenario 4 | 300 | mean 6 PM, sd 3 h | 140 |

Common to all (EC Appendix D): departures normal with mean 6 AM next day and sd 3 h; durations uniform between
15 minutes and 5.5 hours (1 to 22 slots), shortened if needed to fit the window.

## Benchmarks shown next to the player's score

On the same EVs, the page shows the full-day result (Max-Min / RMSE) of the online heuristics of Section 6.2 that the
paper specifies fully. Each decides when an EV arrives, from the load so far, without knowledge of later EVs.

- **Current practice**: start charging on arrival.
- **Greedy** (Chau et al. 2023): start where the sum of squared loads grows the least, that is where the sum of the
  loads under the block is smallest (earliest start on ties).
- **Row-filling** (Zhang et al. 2019, as adapted in Section 6.2): scan the load matrix row by row from the bottom and,
  within a row, from left to right, and take the first start at which the block fits in that row inside its window.
  The block fits in row r when every slot it covers has at most r units; this is the start with the lowest highest
  load under the block, earliest on ties.
- **α-threshold** and **β-threshold** (Section 6.2.1): an EV arriving at slot a starts there if the load of slot a
  is below X; otherwise it is placed by Row-filling. α: X = ceil(mean number of EVs charging per slot) over a set D of
  simulated instances. β: X = mean, over D, of the peak load of the oracle solution (Model B.1). D is 100 simulated
  days per level (seeds 1000001-1000100); the oracle was solved exactly with Gurobi by `tools/oracle_peaks.py`, which
  writes the optimal schedules to `tools/oracle_D.json`, and the tests re-check every schedule and both constants
  without Gurobi:

  | | Warm-up | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 |
  | --- | --- | --- | --- | --- | --- |
  | mean load per slot over D (α: X) | 5.97 (6) | 23.93 (24) | 24.02 (25) | 23.99 (24) | 35.77 (36) |
  | mean oracle peak over D (β: X) | 8.02 (9) | 30.32 (31) | 33.67 (34) | 32.17 (33) | 45.04 (46) |

Over seeds 1-100 our generator gives these means (paper values, EC Tables 1-4, in brackets). Max-Min:

| | Warm-up | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 |
| --- | --- | --- | --- | --- | --- |
| Current practice | 20.49 | 76.35 (75.24) | 116.36 (116.19) | 89.72 (90.01) | 113.84 (109.21) |
| Greedy | 11.55 | 42.36 (38.38) | 40.33 (44.05) | 40.99 (44.59) | 62.33 (56.81) |
| Row-filling | 11.69 | 43.46 (39.82) | 41.84 (45.43) | 42.75 (45.90) | 64.10 (58.63) |
| α-threshold | 10.87 | 39.44 (35.72) | 39.81 (43.50) | 40.56 (44.12) | 57.66 (51.72) |
| β-threshold | 10.43 | 37.10 (34.20) | 38.83 (42.24) | 38.29 (43.20) | 54.21 (49.85) |

RMSE:

| | Warm-up | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 |
| --- | --- | --- | --- | --- | --- |
| Current practice | 6.70 | 26.17 (25.33) | 37.12 (37.13) | 30.80 (30.88) | 39.17 (37.59) |
| Greedy | 3.82 | 15.14 (13.55) | 15.87 (18.47) | 15.47 (18.02) | 22.65 (20.17) |
| Row-filling | 4.05 | 15.52 (13.97) | 16.45 (19.17) | 16.01 (18.63) | 23.11 (20.66) |
| α-threshold | 3.51 | 12.33 (10.42) | 14.83 (17.62) | 14.47 (17.46) | 18.07 (14.11) |
| β-threshold | 3.63 | 12.27 (10.77) | 14.88 (17.64) | 14.19 (16.81) | 17.91 (14.55) |

The levels differ from the paper's (our generator is not theirs; Greedy is about 10 % worse than in the paper on
Scenarios 1 and 4 and 10 % better on Scenarios 2 and 3), but the ranking is the paper's on every scenario:
β-threshold < α-threshold < Greedy < Row-filling < current practice, and each heuristic's ratio to Greedy is within
0.05 of the paper's (a test checks this). Computed with capacity 140; the capacity never binds for these policies on
these seeds (current practice peaks at 134 at most, the others at 74). Our oracle means over D are higher than the
paper's oracle averages (23.83, 35.90, 34.09, 34.74), for the same reason.

Not implemented:

- **Algorithm of Liu et al. (2020a)**: the paper describes it in one sentence (EVs grouped by charging duration and
  released slot by slot at a rate set by a reference schedule; EC Appendix F adds that it starts EVs in batches at
  fixed times, about 1 + e times as many as their deadlines require). That is not enough to reproduce it faithfully
  without the original article.
- **Re-opt** (Section 6.1.2): online, and its per-arrival problem is small enough to solve by enumeration, but it
  only asks whether a start increases Max-Min, so most starts tie and the paper's solver picks "any of them"
  (EC Appendix F). The tie rule decides the result: on our seeds 1-100 of Scenario 1, earliest start gives 55.5,
  latest start 47.1, a random tie 51.7 and Greedy's tie-break 42.6. With no rule given, any choice would be ours,
  not the paper's.
- **Rolling 2SSP** (Section 6.1.3): needs a scenario sampler and an integer program per arrival, with the number of
  scenarios not given; not suited to a browser page.
- **Oracle** (Section 6.1.1): not online (it knows all EVs in advance).
- The learned agents (SL, DAgger, RL): they need the trained networks.

## Assumptions and deviations from the paper

1. **Capacity** (Section 3; Model B.1e; Section 6.1). The paper uses a per-slot capacity `p_cap` but gives no value.
   We use 140 for the four scenarios: current practice must stay feasible, and its peak reaches 134 over seeds 1-100
   (Scenario 4). The warm-up level uses 30 (its current-practice peak is at most 27 over seeds 1-100).
2. **Slot discretization** (Section 3, `ar = ceil`, `d = floor`). Slot k (0-based) covers [k, k+1) quarter-hours after
   noon. The first usable slot is `ceil(arrival)` and the last is `floor(departure) - 1`, so charging always lies inside
   the stay. Read literally with 1-based slots, the paper's formula would allow one more slot at the end.
3. **Truncations** (EC Appendix D). Arrival times are truncated to [0, 95] slots (the paper does not say how arrivals
   outside the horizon are handled); departures are truncated to [first usable slot + 1, 96] so that every window
   has at least one slot. Both use rejection sampling (redraw), with a fallback after 1000 draws (mean arrival; end of
   horizon for departure).
4. **Durations** (EC Appendix D). "Uniformly between 15 minutes and 5.5 hours" is read as a uniform integer of
   1 to 22 slots (L = 22 agrees with the 310-entry vector of EC Appendix E: L + 3T = 22 + 288).
5. **Scenario 3 split** (EC Appendix D): exactly 100 EVs per peak.
6. **How a block falls** (Section 4.1). The paper says the block descends "in each column it covers" until it reaches
   the bottom or another block. We read this as column by column (each covered slot gains one unit), which is what
   the MDP's load update does (Section 3). The board therefore shows load bars, not rigid Tetris pieces.
7. **Capacity in movement mode** (Section 4.5). The block can be shifted over any slot of its window; "down" is
   refused where it would exceed the capacity.
8. **Action limit** (Section 4.1): after T = 96 shifts the block drops where it is; if that position exceeds the
   capacity, it drops at the nearest start that does not (earlier on ties). The paper does not cover this case.
9. **Overload** (not in the paper): if an arriving EV has no feasible start, the game ends. The paper's experiments
   never reach this case; here a player can cause it by stacking load.
10. **Schedule action** (Section 4.5): not offered to the player, since it reaches the same schedules as movement;
    kept in the engine for the benchmark policies.
11. **Reward with an empty board** (Equation 1): the imbalance before the first EV is 0, so the first drop
    always gets -1.
12. **Greedy tie-breaking** (Section 6.2): earliest start. Current practice, if its arrival slot is over capacity,
    uses the earliest feasible start (never needed with capacity 140 on the seeds above).
13. **Random numbers**: mulberry32 with Box-Muller normals, so instances are reproducible in any browser and in node,
    but they are not the paper's instances.
14. **Display**: on narrow screens the canvas scales down with the page, so axis labels become small; the numbers
    are repeated in the score panel.
15. **Row-filling** (Section 6.2): "fits in a row" is read as every covered slot having at most r units, since the
    block falls column by column (item 6). The paper's animation is not available to us.
16. **Thresholds** (Section 6.2.1): D is not described beyond "historical or simulated instances"; we use 100
    simulated days per level from our generator, disjoint from seeds 1-100. "The current load of slot j is below X"
    is read with j the EV's first usable slot (its arrival slot) and a strict inequality; for integer loads, below
    X and below ceil(X) are the same, so the mean oracle peak is stored rounded up. If the arrival slot is full (never
    with capacity 140), the rule falls back to Row-filling. In our generator slot 0 (noon to 12:15) is always empty,
    so the oracle's peak equals its optimal Max-Min and is the same for every optimal schedule.
17. **Vertical scale**: see *Vertical scale*. The axis range is computed from the benchmark heuristics on the same
    EVs; it says little about the EVs to come, and the benchmark results are already in the score panel.

## Files

| File | What |
| --- | --- |
| `index.html`, `ui.js` | Page and user interface (canvas drawing, keyboard, replays) |
| `engine.js` | Rules engine: instance generator, game, reward, scores, heuristics, replays; UMD module usable from node |
| `paper.js` | Averages reported in the paper (EC Tables 1-5), for the paper-averages panel |
| `tools/oracle_peaks.py` | Offline: solves the oracle (Model B.1, Gurobi) on the instances D of the β-threshold |
| `tools/oracle_D.json` | Its output: optimal schedule and Max-Min of each instance of D |
| `test/engine_test.js` | Node tests of the engine (rules, heuristics, threshold constants, replays) |
| `test/ui_smoke.js` | Node smoke test of the page with a fake DOM and canvas; `SVG_OUT=dir` writes the frames as SVG |

Tests (node 22): `node test/engine_test.js && node test/ui_smoke.js`
