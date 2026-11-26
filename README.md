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

- The board has T = 96 columns (15-minute slots from noon to noon) and `cap` rows (capacity units).
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

Mouse and touch are optional: buttons for left, drop and right.
The level and seed are kept in the URL (`#s1-7` is Scenario 1, seed 7).

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

## Benchmark shown next to the player's score

On the same EVs, the page shows the full-day result of **Greedy** (Chau et al. 2023, Section 6.2): each EV starts
where it increases the sum of squared loads the least, that is where the sum of the loads under the block is smallest
(earliest start on ties). It is the simplest of the paper's heuristics. **Current practice** (start on arrival), the
paper's reference benchmark, is shown as well. Over seeds 1-100 our generator gives these Max-Min means (paper values,
EC Tables 1-4, in brackets):

| | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 |
| --- | --- | --- | --- | --- |
| Current practice | 76.35 (75.24) | 116.36 (116.19) | 89.72 (90.01) | 113.84 (109.21) |
| Greedy | 42.36 (38.38) | 40.33 (44.05) | 40.99 (44.59) | 62.33 (56.81) |

These figures were computed with the engine with the capacity removed; with capacity 140 the current-practice
figures are the same (its largest peak over these seeds is 134).

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
14. **Display**: on narrow screens the canvas scales down with the page (`max-width: 100%`), so axis labels become
    small; the numbers are repeated in the score panel.

## Files

| File | What |
| --- | --- |
| `index.html`, `ui.js` | Page and user interface (canvas drawing, keyboard) |
| `engine.js` | Rules engine: instance generator, game, reward, scores, heuristics; UMD module usable from node |
| `test/engine_test.js` | Node tests of the engine |

Test: `node test/engine_test.js`
