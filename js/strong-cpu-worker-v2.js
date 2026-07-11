"use strict";

/* Extension du moteur alpha-bêta existant :
   - environ 70 % du temps pour la recherche déterministe ;
   - le reste pour des simulations Monte-Carlo tactiques sur les meilleurs coups racine.
   Le moteur historique reste la base et est chargé dans le même Web Worker. */
importScripts("strong-cpu-worker.js?v=1");

const baseSearchBestMoveV1 = searchBestMove;
const MC_ROOT_MAX = 14;
const MC_SAMPLE_MOVES = 30;
const MC_PROGRESS_EVERY = 96;

self.onmessage = event => {
  const message = event.data;
  if (!message || message.type !== "search") return;

  try {
    const result = searchBestMoveV2(message.payload);
    self.postMessage({ type: "result", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

function searchBestMoveV2(payload) {
  const startedAt = performance.now();
  const totalBudgetMs = Math.max(500, Number(payload.budgetMs) || 56_000);
  const overallDeadline = startedAt + totalBudgetMs;
  const minimaxBudgetMs = Math.max(350, Math.floor(totalBudgetMs * 0.70));

  const baseResult = baseSearchBestMoveV1({
    ...payload,
    budgetMs: minimaxBudgetMs
  });

  if (!baseResult.move) return baseResult;

  // Une victoire prouvée contre toutes les hypothèses ne mérite pas d'attendre.
  if (baseResult.score >= MATE_SCORE - 5_000) {
    return {
      ...baseResult,
      phase: "alpha-beta",
      simulations: 0,
      elapsedMs: performance.now() - startedAt
    };
  }

  if (performance.now() >= overallDeadline - 450) {
    return {
      ...baseResult,
      phase: "alpha-beta",
      simulations: 0,
      elapsedMs: performance.now() - startedAt
    };
  }

  const monteCarlo = runMonteCarloRoot(payload, baseResult, overallDeadline, startedAt);
  return {
    ...baseResult,
    move: monteCarlo.move,
    phase: "monte-carlo",
    simulations: monteCarlo.simulations,
    monteCarloValue: monteCarlo.value,
    elapsedMs: performance.now() - startedAt
  };
}

function runMonteCarloRoot(payload, baseResult, overallDeadline, startedAt) {
  const root = createRootPosition(payload);
  const cpuColor = payload.cpuColor;
  const beliefs = normalizedBeliefs(payload.beliefs, cpuColor);
  const humanColors = Object.keys(beliefs);
  const allMoves = orderRootMoves(root, generateLegalMoves(root), cpuColor, beliefs);
  const candidates = uniqueCandidateMoves(baseResult.move, allMoves, MC_ROOT_MAX);
  const rng = createSeededRandom(`${rawPositionKey(root)}|${JSON.stringify(beliefs)}|${payload.moveNumber}`);

  const stats = candidates.map(move => ({
    move,
    visits: 0,
    byColor: Object.fromEntries(humanColors.map(color => [color, { visits: 0, sum: 0 }]))
  }));

  let simulations = 0;

  // Échantillonnage initial équitable de chaque coup sous chaque hypothèse de couleur.
  outerWarmup:
  for (const entry of stats) {
    for (const humanColor of humanColors) {
      if (performance.now() >= overallDeadline - 180) break outerWarmup;
      const value = rolloutCandidate(payload, entry.move, humanColor, cpuColor, rng);
      recordSimulation(entry, humanColor, value);
      simulations += 1;
    }
  }

  while (performance.now() < overallDeadline - 180) {
    const entry = selectUcbCandidate(stats, beliefs, simulations);
    const humanColor = selectHypothesisForSimulation(entry, beliefs);
    const value = rolloutCandidate(payload, entry.move, humanColor, cpuColor, rng);
    recordSimulation(entry, humanColor, value);
    simulations += 1;

    if (simulations % MC_PROGRESS_EVERY === 0) {
      const leader = bestMonteCarloEntry(stats, beliefs);
      self.postMessage({
        type: "progress",
        phase: "monte-carlo",
        move: chooseFinalMonteCarloMove(stats, beliefs, baseResult).move,
        depth: baseResult.depth || 0,
        nodes: baseResult.nodes || 0,
        simulations,
        elapsedMs: performance.now() - startedAt,
        monteCarloValue: monteCarloCombinedValue(leader, beliefs)
      });
    }
  }

  const chosen = chooseFinalMonteCarloMove(stats, beliefs, baseResult);
  return {
    move: chosen.move,
    value: chosen.value,
    simulations
  };
}

function createRootPosition(payload) {
  return {
    board: cloneBoard(payload.board),
    reserves: cloneReserves(payload.reserves),
    protectedIndex: payload.protectedIndex ?? null,
    currentPlayer: CPU_PLAYER,
    moveNumber: Number(payload.moveNumber) || 0
  };
}

function uniqueCandidateMoves(baseMove, orderedMoves, maximum) {
  const result = [];
  const seen = new Set();

  for (const move of [baseMove, ...orderedMoves]) {
    if (!move) continue;
    const key = moveKey(move);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(move);
    if (result.length >= maximum) break;
  }
  return result;
}

function rolloutCandidate(payload, rootMove, humanColor, cpuColor, rng) {
  const position = createRootPosition(payload);
  const repetitions = new Map(payload.positionCounts || []);

  applyMove(position, rootMove);
  let key = rawPositionKey(position);
  repetitions.set(key, (repetitions.get(key) || 0) + 1);

  const maxPlies = emptyIndices(position.board).length <= 2 ? 26 : 18;

  for (let ply = 1; ply <= maxPlies; ply += 1) {
    const terminal = terminalScore(position, humanColor, cpuColor, repetitions.get(key) || 0, ply);
    if (terminal !== null) return normalizeTerminalScore(terminal);

    const moves = generateLegalMoves(position);
    if (!moves.length) return 0;

    const selected = selectRolloutMove(position, moves, humanColor, cpuColor, rng);
    applyMove(position, selected);
    key = rawPositionKey(position);
    repetitions.set(key, (repetitions.get(key) || 0) + 1);
  }

  const evaluation = evaluatePosition(position, humanColor, cpuColor);
  return Math.tanh(evaluation / 5_500);
}

function selectRolloutMove(position, moves, humanColor, cpuColor, rng) {
  const player = position.currentPlayer;
  const targetColor = player === CPU_PLAYER ? cpuColor : humanColor;

  // Toute victoire immédiate est toujours prise.
  for (const move of moves) {
    const undo = applyMove(position, move);
    const wins = hasColorWin(position.board, targetColor);
    undoMove(position, move, undo);
    if (wins) return move;
  }

  const sampled = sampleRolloutMoves(moves, rng);
  const scored = sampled.map(move => {
    const undo = applyMove(position, move);
    const terminal = terminalScore(position, humanColor, cpuColor, 0, 1);
    const score = terminal ?? evaluatePosition(position, humanColor, cpuColor);
    undoMove(position, move, undo);
    return { move, score };
  });

  scored.sort((a, b) => player === CPU_PLAYER ? b.score - a.score : a.score - b.score);

  const roll = rng();
  if (roll < 0.72 || scored.length === 1) return scored[0].move;
  if (roll < 0.91 || scored.length === 2) return scored[Math.min(1, scored.length - 1)].move;
  return scored[Math.floor(rng() * Math.min(5, scored.length))].move;
}

function sampleRolloutMoves(moves, rng) {
  if (moves.length <= MC_SAMPLE_MOVES) return moves;

  const preferred = [...moves]
    .sort((a, b) => actionPreference(b) - actionPreference(a) || moveKey(a).localeCompare(moveKey(b)))
    .slice(0, 10);
  const result = [...preferred];
  const seen = new Set(result.map(moveKey));

  while (result.length < MC_SAMPLE_MOVES) {
    const move = moves[Math.floor(rng() * moves.length)];
    const key = moveKey(move);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(move);
  }
  return result;
}

function recordSimulation(entry, humanColor, value) {
  entry.visits += 1;
  entry.byColor[humanColor].visits += 1;
  entry.byColor[humanColor].sum += value;
}

function selectUcbCandidate(stats, beliefs, simulations) {
  let best = stats[0];
  let bestScore = -Infinity;
  const logTotal = Math.log(simulations + 2);

  for (const entry of stats) {
    const mean = monteCarloCombinedValue(entry, beliefs);
    const exploration = 0.48 * Math.sqrt(logTotal / Math.max(1, entry.visits));
    const score = mean + exploration;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function selectHypothesisForSimulation(entry, beliefs) {
  let selected = Object.keys(beliefs)[0];
  let bestNeed = -Infinity;

  for (const [color, probability] of Object.entries(beliefs)) {
    const visits = entry.byColor[color].visits;
    const need = (0.18 + probability) / (visits + 1);
    if (need > bestNeed) {
      bestNeed = need;
      selected = color;
    }
  }
  return selected;
}

function monteCarloCombinedValue(entry, beliefs) {
  const scores = {};
  for (const color of Object.keys(beliefs)) {
    const colorStats = entry.byColor[color];
    scores[color] = colorStats.visits ? colorStats.sum / colorStats.visits : 0;
  }
  return combineHypothesisScores(scores, beliefs);
}

function bestMonteCarloEntry(stats, beliefs) {
  return [...stats].sort((a, b) => {
    const delta = monteCarloCombinedValue(b, beliefs) - monteCarloCombinedValue(a, beliefs);
    return delta || moveKey(a.move).localeCompare(moveKey(b.move));
  })[0];
}

function chooseFinalMonteCarloMove(stats, beliefs, baseResult) {
  const leader = bestMonteCarloEntry(stats, beliefs);
  const baseKey = moveKey(baseResult.move);
  const baseEntry = stats.find(entry => moveKey(entry.move) === baseKey) || leader;
  const leaderValue = monteCarloCombinedValue(leader, beliefs);
  const baseValue = monteCarloCombinedValue(baseEntry, beliefs);

  const depth = Number(baseResult.depth) || 0;
  const threshold = depth >= 8 ? 0.12 : depth >= 5 ? 0.075 : 0.035;
  const enoughEvidence = leader.visits >= 8 && baseEntry.visits >= 8;

  if (enoughEvidence && leaderValue > baseValue + threshold) {
    return { move: leader.move, value: leaderValue };
  }
  return { move: baseResult.move, value: baseValue };
}

function normalizeTerminalScore(score) {
  if (score > MATE_SCORE / 2) return 1;
  if (score < -MATE_SCORE / 2) return -1;
  return 0;
}

function createSeededRandom(seedText) {
  let seed = 2166136261 >>> 0;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619) >>> 0;
  }

  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}
