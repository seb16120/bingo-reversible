"use strict";

const STRONG_CPU_SOFT_LIMIT_MS = 48_000;
const STRONG_CPU_HARD_LIMIT_MS = 50_000;
const STRONG_CPU_MIN_BUDGET_MS = 350;
const STRONG_CPU_CONFIDENCE_CAP = 0.95;

function resetStrongCpuKnowledge() {
  cancelStrongCpuTurn();
  state.strongBeliefs = {};
  state.strongSearchStats = null;
  state.strongBestMove = null;
  state.strongBeliefHistory = [];

  if (state.mode !== "strong") return;

  const cpuColor = state.secretColors[CPU_PLAYER];
  const possibleHumanColors = Object.keys(COLORS).filter(color => color !== cpuColor);
  for (const color of possibleHumanColors) {
    state.strongBeliefs[color] = 1 / possibleHumanColors.length;
  }
}

function beginStrongHumanMoveObservation(move) {
  if (state.mode !== "strong" || state.currentPlayer !== 0 || !state.roundActive) return null;

  return {
    move: { ...move },
    board: cloneBoard(state.board),
    reserves: cloneReserves(state.reserves),
    protectedIndex: state.protectedIndex,
    moveNumber: state.moveNumber
  };
}

function finalizeStrongHumanMoveObservation(observation) {
  if (!observation || state.mode !== "strong") return;

  const cpuColor = state.secretColors[CPU_PLAYER];
  const possibleHumanColors = Object.keys(COLORS).filter(color => color !== cpuColor);
  const likelihoods = {};
  let posteriorTotal = 0;

  for (const color of possibleHumanColors) {
    const likelihood = strongMoveLikelihood(observation, color, cpuColor);
    const prior = Number(state.strongBeliefs[color]) || (1 / possibleHumanColors.length);
    likelihoods[color] = likelihood;
    posteriorTotal += prior * likelihood;
  }

  if (posteriorTotal <= 0) return;

  const posterior = {};
  for (const color of possibleHumanColors) {
    const prior = Number(state.strongBeliefs[color]) || (1 / possibleHumanColors.length);
    posterior[color] = (prior * likelihoods[color]) / posteriorTotal;
  }

  if (possibleHumanColors.length === 2) {
    const first = possibleHumanColors[0];
    const second = possibleHumanColors[1];
    posterior[first] = Math.min(STRONG_CPU_CONFIDENCE_CAP, Math.max(1 - STRONG_CPU_CONFIDENCE_CAP, posterior[first]));
    posterior[second] = 1 - posterior[first];
  }

  state.strongBeliefs = posterior;
  state.strongBeliefHistory.push({
    moveNumber: observation.moveNumber + 1,
    move: { ...observation.move },
    likelihoods: { ...likelihoods },
    posterior: { ...posterior }
  });
}

function strongMoveLikelihood(observation, humanColor, cpuColor) {
  const legalMoves = generateLegalMovesForPosition(
    0,
    observation.board,
    observation.reserves,
    observation.protectedIndex
  );

  if (!legalMoves.length) return 1;

  const observedKey = moveKey(observation.move);
  let observedScore = -Infinity;
  let bestScore = -Infinity;
  let scores = [];

  for (const move of legalMoves) {
    const score = strongInferenceMoveScore(observation, move, humanColor, cpuColor);
    scores.push(score);
    if (score > bestScore) bestScore = score;
    if (moveKey(move) === observedKey) observedScore = score;
  }

  if (!Number.isFinite(observedScore)) return 0.02;

  scores = scores.sort((a, b) => b - a);
  const rank = scores.findIndex(score => score <= observedScore + 1e-9);
  const spread = strongScoreSpread(scores);
  const temperature = Math.max(55, Math.min(260, spread * 0.55));
  const relative = Math.max(-12, (observedScore - bestScore) / temperature);
  const softChoice = Math.exp(relative);
  const rankPenalty = 1 / (1 + Math.max(0, rank) * 0.025);

  // Le plancher permet les erreurs humaines, les bluffs et les coups ambigus.
  return Math.max(0.025, 0.07 + 0.93 * softChoice * rankPenalty);
}

function strongInferenceMoveScore(observation, move, humanColor, cpuColor) {
  const board = cloneBoard(observation.board);
  const reserves = cloneReserves(observation.reserves);
  applyMoveToSnapshot(move, board, reserves, 0);

  if (hasColorWin(board, humanColor)) return 100_000;
  if (hasColorWin(board, cpuColor)) return -100_000;

  const beforeHuman = strongInferenceColorPotential(observation.board, humanColor, observation.protectedIndex);
  const beforeCpu = strongInferenceColorPotential(observation.board, cpuColor, observation.protectedIndex);
  const afterProtected = move.action === "move" ? move.to : move.index;
  const afterHuman = strongInferenceColorPotential(board, humanColor, afterProtected);
  const afterCpu = strongInferenceColorPotential(board, cpuColor, afterProtected);

  let score = (afterHuman - beforeHuman) * 1.15;
  score -= (afterCpu - beforeCpu) * 1.0;
  score += strongThreatCount(board, humanColor) * 240;
  score -= strongThreatCount(board, cpuColor) * 285;
  score += destinationPreference(move) * 1.5;

  if (move.action === "flip") score += 4;
  if (move.action === "place") score += 2;
  return score;
}

function strongInferenceColorPotential(board, color, protectedIndex) {
  const weights = [0, 8, 42, 260, 20_000];
  let total = 0;

  for (const line of WIN_LINES) {
    let actual = 0;
    let convertible = 0;
    let empty = 0;

    for (const index of line) {
      const tile = board[index];
      if (!tile) {
        empty += 1;
        continue;
      }

      if (tileCenter(tile) === color) actual += 1;
      else if (index !== protectedIndex && TILE_TYPES[tile.type].faces[1 - tile.face].center === color) convertible += 1;
    }

    total += weights[actual];
    total += convertible * 12 + actual * convertible * 7;
    if (actual === 3 && (empty > 0 || convertible > 0)) total += 520;
  }

  return total;
}

function strongThreatCount(board, color) {
  let threats = 0;
  for (const line of WIN_LINES) {
    let matching = 0;
    let empty = 0;
    for (const index of line) {
      if (!board[index]) empty += 1;
      else if (tileCenter(board[index]) === color) matching += 1;
    }
    if (matching === 3 && empty === 1) threats += 1;
  }
  return threats;
}

function strongScoreSpread(scores) {
  if (scores.length < 2) return 100;
  const top = scores[0];
  const sample = scores.slice(0, Math.min(12, scores.length));
  const averageGap = sample.reduce((sum, score) => sum + (top - score), 0) / sample.length;
  return Math.max(70, averageGap);
}

function scheduleStrongCpuTurn() {
  if (!state.roundActive || state.mode !== "strong" || !isCpuPlayer() || state.strongWorker) return;

  state.cpuThinking = true;
  state.strongSearchStats = { depth: 0, nodes: 0, elapsedMs: 0 };
  state.strongBestMove = null;
  renderAll();

  if (typeof Worker === "undefined") {
    useSimpleCpuFallback("Ce navigateur ne prend pas en charge le calcul en arrière-plan.");
    return;
  }

  const budgetMs = strongCpuBudgetMs();
  const searchId = (state.strongSearchId || 0) + 1;
  state.strongSearchId = searchId;

  let worker;
  try {
    worker = new Worker(`js/strong-cpu-worker.js?v=1`);
  } catch (error) {
    useSimpleCpuFallback("Impossible de lancer le moteur Strong CPU.");
    return;
  }

  state.strongWorker = worker;
  state.strongHardTimerId = window.setTimeout(() => {
    if (state.strongSearchId !== searchId || !state.roundActive || !isCpuPlayer()) return;
    finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
  }, Math.min(STRONG_CPU_HARD_LIMIT_MS, budgetMs + 2_000));

  worker.onmessage = event => {
    if (state.strongSearchId !== searchId) return;
    const message = event.data || {};

    if (message.type === "progress") {
      if (message.move) state.strongBestMove = message.move;
      state.strongSearchStats = {
        depth: Number(message.depth) || 0,
        nodes: Number(message.nodes) || 0,
        elapsedMs: Number(message.elapsedMs) || 0
      };
      renderHeader();
      renderActions();
      return;
    }

    if (message.type === "result") {
      finishStrongCpuSearch(message.move || state.strongBestMove || chooseCpuMove(), searchId);
      return;
    }

    if (message.type === "error") {
      finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
    }
  };

  worker.onerror = () => {
    if (state.strongSearchId !== searchId) return;
    finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
  };

  worker.postMessage({
    type: "search",
    payload: {
      board: cloneBoard(state.board),
      reserves: cloneReserves(state.reserves),
      protectedIndex: state.protectedIndex,
      moveNumber: state.moveNumber,
      positionCounts: [...state.positionCounts.entries()],
      cpuColor: state.secretColors[CPU_PLAYER],
      beliefs: { ...state.strongBeliefs },
      budgetMs
    }
  });
}

function strongCpuBudgetMs() {
  let budget = STRONG_CPU_SOFT_LIMIT_MS;

  if (state.timersEnabled) {
    const safeTurnBudget = Math.max(STRONG_CPU_MIN_BUDGET_MS, (state.turnTime - 8) * 1_000);
    const safeTotalBudget = Math.max(STRONG_CPU_MIN_BUDGET_MS, (state.totalTimes[CPU_PLAYER] - 8) * 1_000);
    budget = Math.min(budget, safeTurnBudget, safeTotalBudget);
  }

  return Math.max(STRONG_CPU_MIN_BUDGET_MS, Math.floor(budget));
}

function finishStrongCpuSearch(move, searchId) {
  if (state.strongSearchId !== searchId) return;

  const worker = state.strongWorker;
  if (worker) worker.terminate();
  state.strongWorker = null;

  if (state.strongHardTimerId !== null) window.clearTimeout(state.strongHardTimerId);
  state.strongHardTimerId = null;
  state.cpuThinking = false;

  if (!state.roundActive || !isCpuPlayer()) return;
  if (!move) {
    finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
    return;
  }

  executeCpuMove(move);
}

function cancelStrongCpuTurn() {
  state.strongSearchId = (state.strongSearchId || 0) + 1;

  if (state.strongWorker) state.strongWorker.terminate();
  state.strongWorker = null;

  if (state.strongHardTimerId !== null) window.clearTimeout(state.strongHardTimerId);
  state.strongHardTimerId = null;
  state.strongBestMove = null;
  state.strongSearchStats = null;
}

function useSimpleCpuFallback(reason) {
  console.warn(reason);
  state.cpuThinking = false;
  const move = chooseCpuMove();
  if (move) executeCpuMove(move);
  else finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
}
