// Averages reported in the paper (Ghahtarani et al. 2026, EC Appendix F, Tables 1-4; RL: EC Appendix H, Table 5).
// Means over the paper's 100 test instances of each scenario: Max-Min and RMSE. They are not values for the
// seeds of this page, whose instances come from our own generator (see README). Shown on the page as a reference.
(function (root) {
  "use strict";
  // [method, Max-Min, RMSE, family, key of the policy on this page or null]
  const ROWS = {
    s1: [
      ["Oracle (full information)", 23.83, 7.47, "ip"], ["Re-opt", 40.81, 13.70, "ip"],
      ["2SSP, 1-hour lookahead", 39.48, 12.50, "ip"], ["2SSP, 3-hour lookahead", 33.00, 9.43, "ip"],
      ["2SSP, 4-hour lookahead", 32.92, 8.30, "ip"], ["2SSP, 5-hour lookahead", 31.75, 7.74, "ip"],
      ["2SSP, 6-hour lookahead", 30.97, 7.58, "ip"], ["2SSP, 9-hour lookahead", 29.32, 7.53, "ip"],
      ["2SSP, 12-hour lookahead", 29.51, 7.64, "ip"],
      ["Current practice", 75.24, 25.33, "heur", "current"], ["Greedy (Chau et al. 2023)", 38.38, 13.55, "heur", "greedy"],
      ["Algorithm of Liu et al. (2020)", 88.64, 27.46, "heur"], ["Row-filling (Zhang et al. 2019)", 39.82, 13.97, "heur", "rowfill"],
      ["α-threshold", 35.72, 10.42, "heur", "alpha"], ["β-threshold", 34.20, 10.77, "heur", "beta"],
      ["I2M-SL", 49.04, 12.63, "ml"], ["I2M-DAgger", 33.58, 8.43, "ml"], ["G2M-SL", 34.89, 9.45, "ml"],
      ["G2M-DAgger", 30.89, 8.38, "ml"], ["F2M-SL", 41.68, 10.79, "ml"], ["F2M-DAgger", 34.20, 8.76, "ml"],
      ["V2M-SL", 49.36, 12.81, "ml"], ["V2M-DAgger", 34.19, 8.92, "ml"],
      ["V2M-DQN", 50.35, 15.48, "rl"], ["V2M-PPO", 48.58, 14.18, "rl"], ["V2M-Reinforce", 73.06, 24.94, "rl"],
      ["I2M-DQN", 62.89, 19.58, "rl"], ["I2M-PPO", 56.47, 16.83, "rl"], ["I2M-Reinforce", 65.81, 18.80, "rl"],
      ["G2M-DQN", 44.14, 15.46, "rl"], ["G2M-PPO", 51.88, 14.90, "rl"], ["G2M-Reinforce", 59.42, 16.49, "rl"],
      ["F2M-DQN", 42.54, 11.69, "rl"], ["F2M-PPO", 68.45, 22.60, "rl"], ["F2M-Reinforce", 63.17, 19.87, "rl"],
    ],
    s2: [
      ["Oracle (full information)", 35.90, 15.39, "ip"], ["Re-opt", 45.52, 18.68, "ip"],
      ["2SSP, 1-hour lookahead", 45.03, 17.27, "ip"], ["2SSP, 3-hour lookahead", 42.15, 15.67, "ip"],
      ["2SSP, 4-hour lookahead", 42.23, 15.70, "ip"], ["2SSP, 5-hour lookahead", 42.03, 15.71, "ip"],
      ["2SSP, 6-hour lookahead", 42.07, 15.72, "ip"], ["2SSP, 9-hour lookahead", 42.03, 15.70, "ip"],
      ["2SSP, 12-hour lookahead", 42.00, 15.70, "ip"],
      ["Current practice", 116.19, 37.13, "heur", "current"], ["Greedy (Chau et al. 2023)", 44.05, 18.47, "heur", "greedy"],
      ["Algorithm of Liu et al. (2020)", 133.45, 38.36, "heur"], ["Row-filling (Zhang et al. 2019)", 45.43, 19.17, "heur", "rowfill"],
      ["α-threshold", 43.50, 17.62, "heur", "alpha"], ["β-threshold", 42.24, 17.64, "heur", "beta"],
      ["I2M-SL", 79.32, 22.36, "ml"], ["I2M-DAgger", 42.47, 16.29, "ml"], ["G2M-SL", 47.98, 16.81, "ml"],
      ["G2M-DAgger", 40.93, 16.04, "ml"], ["F2M-SL", 55.14, 17.21, "ml"], ["F2M-DAgger", 45.89, 16.46, "ml"],
      ["V2M-SL", 68.04, 19.17, "ml"], ["V2M-DAgger", 46.63, 16.46, "ml"],
    ],
    s3: [
      ["Oracle (full information)", 34.09, 14.43, "ip"], ["Re-opt", 45.97, 18.14, "ip"],
      ["2SSP, 1-hour lookahead", 45.35, 16.82, "ip"], ["2SSP, 3-hour lookahead", 42.10, 15.36, "ip"],
      ["2SSP, 4-hour lookahead", 42.05, 15.41, "ip"], ["2SSP, 5-hour lookahead", 40.41, 14.82, "ip"],
      ["2SSP, 6-hour lookahead", 40.30, 14.80, "ip"], ["2SSP, 9-hour lookahead", 40.40, 14.80, "ip"],
      ["2SSP, 12-hour lookahead", 40.29, 14.78, "ip"],
      ["Current practice", 90.01, 30.88, "heur", "current"], ["Greedy (Chau et al. 2023)", 44.59, 18.02, "heur", "greedy"],
      ["Algorithm of Liu et al. (2020)", 97.87, 30.60, "heur"], ["Row-filling (Zhang et al. 2019)", 45.90, 18.63, "heur", "rowfill"],
      ["α-threshold", 44.12, 17.46, "heur", "alpha"], ["β-threshold", 43.20, 16.81, "heur", "beta"],
      ["I2M-SL", 65.95, 19.39, "ml"], ["I2M-DAgger", 42.26, 15.44, "ml"], ["G2M-SL", 45.50, 15.69, "ml"],
      ["G2M-DAgger", 39.46, 14.89, "ml"], ["F2M-SL", 56.76, 17.06, "ml"], ["F2M-DAgger", 48.99, 16.57, "ml"],
      ["V2M-SL", 62.76, 19.24, "ml"], ["V2M-DAgger", 47.02, 15.57, "ml"],
    ],
    s4: [
      ["Oracle (full information)", 34.74, 10.78, "ip"], ["Re-opt", 60.00, 20.36, "ip"],
      ["2SSP, 1-hour lookahead", 56.17, 18.33, "ip"], ["2SSP, 3-hour lookahead", 47.16, 13.72, "ip"],
      ["2SSP, 4-hour lookahead", 46.41, 12.04, "ip"], ["2SSP, 5-hour lookahead", 42.25, 11.26, "ip"],
      ["2SSP, 6-hour lookahead", 41.35, 10.88, "ip"], ["2SSP, 9-hour lookahead", 40.46, 11.01, "ip"],
      ["2SSP, 12-hour lookahead", 40.76, 10.95, "ip"],
      ["Current practice", 109.21, 37.59, "heur", "current"], ["Greedy (Chau et al. 2023)", 56.81, 20.17, "heur", "greedy"],
      ["Algorithm of Liu et al. (2020)", 132.60, 41.02, "heur"], ["Row-filling (Zhang et al. 2019)", 58.63, 20.66, "heur", "rowfill"],
      ["α-threshold", 51.72, 14.11, "heur", "alpha"], ["β-threshold", 49.85, 14.55, "heur", "beta"],
      ["I2M-SL", 81.08, 21.02, "ml"], ["I2M-DAgger", 47.74, 10.06, "ml"], ["G2M-SL", 56.27, 15.17, "ml"],
      ["G2M-DAgger", 45.61, 11.70, "ml"], ["F2M-SL", 74.32, 21.79, "ml"], ["F2M-DAgger", 59.32, 14.66, "ml"],
      ["V2M-SL", 66.71, 16.51, "ml"], ["V2M-DAgger", 50.52, 12.71, "ml"],
    ],
  };
  const TABLE = { s1: "EC Table 1", s2: "EC Table 2", s3: "EC Table 3", s4: "EC Table 4" };
  const FAMILIES = { ip: "Integer programming", heur: "Heuristics", ml: "Learned agents (supervised, DAgger)",
                     rl: "Reinforcement learning (EC Table 5)" };
  const api = { ROWS, TABLE, FAMILIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PaperResults = api;
})(this);
