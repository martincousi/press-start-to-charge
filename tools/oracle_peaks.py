"""Oracle peaks for the beta-threshold heuristic (Ghahtarani et al. 2026, Section 6.2.1).

X_beta is the mean, over a set D of simulated instances, of the peak load of the oracle solution
(Model B.1: minimise p_max - p_min with full information). This script generates D with engine.js
(seeds 1000001-1000100 of each level, disjoint from the seeds a player is likely to use), solves
Model B.1 exactly with Gurobi, and writes tools/oracle_D.json with each instance's optimal
schedule, so that test/engine_test.js can re-check every schedule and the constants in engine.js
without Gurobi. Offline only: the page never runs it.

Model B.1 is written with one binary per feasible start (equivalent to the x/z form of the
paper: contiguity and the window are built into the start variables). Slot 0 (noon-12:15) is
always empty in our generator (arrivals are > 0 slots after noon), so p_min = 0 and the
oracle's peak equals its optimal Max-Min, the same for every optimal schedule.

Run: python tools/oracle_peaks.py   (needs gurobipy and node; about 3 minutes, 4 threads)
"""
import json
import os
import subprocess
import time

import gurobipy as gp
from gurobipy import GRB

HERE = os.path.dirname(os.path.abspath(__file__))
LEVELS = ["warmup", "s1", "s2", "s3", "s4"]
SEEDS = range(1000001, 1000101)

DUMP = """
const C = require(process.argv[1]);
const out = {};
for (const k of JSON.parse(process.argv[2])) out[k] = JSON.parse(process.argv[3]).map(seed => {
  const i = C.generate(k, seed); return { seed, T: i.T, evs: i.evs.map(e => [e.a, e.e, e.l]) }; });
process.stdout.write(JSON.stringify(out));
"""


def solve(T, evs):
    m = gp.Model()
    m.Params.OutputFlag = 0
    m.Params.Threads = 4
    z = {}
    for i, (a, e, l) in enumerate(evs):
        for s in range(a, e - l + 2):
            z[i, s] = m.addVar(vtype=GRB.BINARY)
        m.addConstr(gp.quicksum(z[i, s] for s in range(a, e - l + 2)) == 1)
    pmax, pmin = m.addVar(), m.addVar()
    for j in range(T):
        load = gp.quicksum(v for (i, s), v in z.items() if s <= j < s + evs[i][2])
        m.addConstr(load <= pmax)
        m.addConstr(load >= pmin)
    m.setObjective(pmax - pmin, GRB.MINIMIZE)
    m.optimize()
    assert m.Status == GRB.OPTIMAL and abs(m.ObjVal - m.ObjBound) < 1e-6, (m.Status, m.ObjVal, m.ObjBound)
    starts = [None] * len(evs)
    for (i, s), v in z.items():
        if v.X > 0.5:
            starts[i] = s
    return round(m.ObjVal), starts


def main():
    engine = os.path.join(HERE, "..", "engine.js")
    raw = subprocess.run(["node", "-e", DUMP, engine, json.dumps(LEVELS), json.dumps(list(SEEDS))],
                         check=True, capture_output=True, text=True).stdout
    data = json.loads(raw)
    out = {"source": "tools/oracle_peaks.py, Gurobi " + ".".join(map(str, gp.gurobi.version())), "levels": {}}
    for k in LEVELS:
        t0, rows = time.time(), []
        for inst in data[k]:
            obj, starts = solve(inst["T"], inst["evs"])
            rows.append({"seed": inst["seed"], "maxMin": obj, "starts": starts})
        peaks = [r["maxMin"] for r in rows]
        out["levels"][k] = {"meanPeak": sum(peaks) / len(peaks), "instances": rows}
        print(f"{k}: mean oracle peak {sum(peaks) / len(peaks):.2f} over {len(peaks)} instances "
              f"({time.time() - t0:.0f} s)", flush=True)
    with open(os.path.join(HERE, "oracle_D.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
