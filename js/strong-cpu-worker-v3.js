"use strict";

/* Strong CPU v3 :
   - recherche alpha-bêta et Monte-Carlo du moteur v2 ;
   - évaluation renforcée des menaces de retournement à l’entrée de la phase spéciale ;
   - filtre tactique de sécurité contre les gains forcés en deux tours humains. */
importScripts("strong-cpu-worker-v2.js?v=1");

const V3_HUMAN_PLAYER = 0;
const V3_CPU_PLAYER = 1;
const V3_SAFETY_SCAN_MAX_MS = 3_200;
const V3_HYPOTHESIS_MIN_PROBABILITY = 0.08;
const v3BaseEvaluatePosition = evaluatePosition;
const v3BaseSelectivelyLimitMoves = selectivelyLimitMoves;

class V3SafetyTimeout extends Error {}

self.onmessage = event => {
  const message = event.data;
  if (!message || message.type !== "search") return;

  try {
    const result = searchBestMoveV3(message.payload);
    self.postMessage({ type: "result", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

evaluatePosition = function evaluatePositionV3(position, humanColor, cpuColor) {
  const base = v3BaseEvaluatePosition(position, humanColor, cpuColor);
  const cpuThreat = v3StrategicThreatScore(position, cpuColor);
  const humanThreat = v3StrategicThreatScore(position, humanColor);
  const cpuTurnFactor = position.currentPlayer === V3_CPU_PLAYER ? 1.12 : 1;
  const humanTurnFactor = position.currentPlayer === V3_HUMAN_PLAYER ? 1.2 : 1;

  return base + cpuThreat * cpuTurnFactor - humanThreat * 1.24 * humanTurnFactor;
};

selectivelyLimitMoves = function selectivelyLimitMovesV3(position, moves, depth) {
  const empties = emptyIndices(position.board).length;

  // Les quelques coups autour du passage à deux cases libres sont décisifs :
  // on évite l’élagage agressif qui pouvait faire disparaître une défense préventive.
  if (empties <= 2) {
    if (moves.length <= 64 || depth <= 4) return moves;
    const cap = depth >= 9 ? 40 : depth >= 7 ? 48 : 56;
    return moves.slice(0, Math.min(cap, moves.length));
  }

  if (empties <= 4) {
    if (moves.length <= 56 || depth <= 4) return moves;
    const cap = depth >= 9 ? 34 : depth >= 7 ? 42 : 50;
    return moves.slice(0, Math.min(cap, moves.length));
  }

  return v3BaseSelectivelyLimitMoves(position, moves, depth);
};

function searchBestMoveV3(payload) {
  const startedAt = performance.now();
  const totalBudgetMs = Math.max(500, Number(payload.budgetMs) || 56_000);
  const overallDeadline = startedAt + totalBudgetMs;
  const beliefs = normalizedBeliefs(payload.beliefs, payload.cpuColor);

  const safety = v3ScanRootSafety(
    payload,
    beliefs,
    Math.min(overallDeadline - 500, startedAt + V3_SAFETY_SCAN_MAX_MS)
  );

  const remainingAfterSafety = Math.max(400, overallDeadline - performance.now());
  const minimaxBudgetMs = Math.max(350, Math.floor(remainingAfterSafety * 0.76));
  const baseResult = baseSearchBestMoveV1({
    ...payload,
    budgetMs: minimaxBudgetMs
  });

  if (!baseResult.move) return baseResult;

  let chosenMove = baseResult.move;
  let phase = "alpha-beta";
  let simulations = 0;
  let monteCarloValue = null;

  if (baseResult.score < MATE_SCORE - 5_000 && performance.now() < overallDeadline - 450) {
    const monteCarlo = runMonteCarloRoot(payload, baseResult, overallDeadline, startedAt);
    chosenMove = monteCarlo.move;
    simulations = monteCarlo.simulations;
    monteCarloValue = monteCarlo.value;
    phase = "monte-carlo";
  }

  if (safety.complete && safety.safeMoveKeys.size > 0 && !safety.safeMoveKeys.has(moveKey(chosenMove))) {
    const root = createRootPosition(payload);
    const ordered = orderRootMoves(root, generateLegalMoves(root), payload.cpuColor, beliefs);
    const baseKey = moveKey(baseResult.move);
    chosenMove = safety.safeMoveKeys.has(baseKey)
      ? baseResult.move
      : ordered.find(move => safety.safeMoveKeys.has(moveKey(move))) || chosenMove;
    phase = `${phase}+sécurité`;
  }

  return {
    ...baseResult,
    move: chosenMove,
    phase,
    simulations,
    monteCarloValue,
    tacticalSafetyChecked: safety.complete,
    safeRootMoves: safety.safeMoveKeys.size,
    elapsedMs: performance.now() - startedAt
  };
}

function v3ScanRootSafety(payload, beliefs, safetyDeadline) {
  const root = createRootPosition(payload);
  const empties = emptyIndices(root.board).length;
  const safeMoveKeys = new Set();

  // Le motif dangereux signalé apparaît surtout juste avant ou pendant la phase spéciale.
  if (empties > 5) return { complete: false, safeMoveKeys };

  const rootMoves = orderRootMoves(root, generateLegalMoves(root), payload.cpuColor, beliefs);
  const relevantHumanColors = Object.entries(beliefs)
    .filter(([, probability]) => probability >= V3_HYPOTHESIS_MIN_PROBABILITY)
    .map(([color]) => color);

  try {
    for (const move of rootMoves) {
      v3EnsureSafetyTime(safetyDeadline);

      const undo = applyMove(root, move);
      let unsafe = false;

      for (const humanColor of relevantHumanColors) {
        if (hasColorWin(root.board, humanColor)) {
          unsafe = true;
          break;
        }
      }

      if (!unsafe && !hasColorWin(root.board, payload.cpuColor)) {
        for (const humanColor of relevantHumanColors) {
          if (v3HumanCanForceWinOnFollowingTurn(root, humanColor, payload.cpuColor, safetyDeadline)) {
            unsafe = true;
            break;
          }
        }
      }

      undoMove(root, move, undo);
      if (!unsafe) safeMoveKeys.add(moveKey(move));
    }
  } catch (error) {
    if (error instanceof V3SafetyTimeout) return { complete: false, safeMoveKeys: new Set() };
    throw error;
  }

  return { complete: true, safeMoveKeys };
}

function v3HumanCanForceWinOnFollowingTurn(positionAfterCpu, humanColor, cpuColor, safetyDeadline) {
  if (positionAfterCpu.currentPlayer !== V3_HUMAN_PLAYER) return false;
  const humanMoves = orderMoves(positionAfterCpu, generateLegalMoves(positionAfterCpu), humanColor, cpuColor, null);

  for (const humanMove of humanMoves) {
    v3EnsureSafetyTime(safetyDeadline);
    const humanUndo = applyMove(positionAfterCpu, humanMove);

    if (hasColorWin(positionAfterCpu.board, humanColor)) {
      undoMove(positionAfterCpu, humanMove, humanUndo);
      return true;
    }

    // Un coup humain qui offre immédiatement la victoire au CPU n’est pas un plan forcé rationnel.
    if (hasColorWin(positionAfterCpu.board, cpuColor)) {
      undoMove(positionAfterCpu, humanMove, humanUndo);
      continue;
    }

    const cpuReplies = orderMoves(positionAfterCpu, generateLegalMoves(positionAfterCpu), humanColor, cpuColor, null);
    let everyCpuReplyLoses = cpuReplies.length > 0;

    for (const cpuReply of cpuReplies) {
      v3EnsureSafetyTime(safetyDeadline);

      const cpuUndo = applyMove(positionAfterCpu, cpuReply);
      const humanAlreadyWins = hasColorWin(positionAfterCpu.board, humanColor);
      const cpuEscapes = !humanAlreadyWins && (
        hasColorWin(positionAfterCpu.board, cpuColor)
        || !v3HasImmediateWinningMove(positionAfterCpu, humanColor, safetyDeadline)
      );
      undoMove(positionAfterCpu, cpuReply, cpuUndo);

      if (cpuEscapes) {
        everyCpuReplyLoses = false;
        break;
      }
    }

    undoMove(positionAfterCpu, humanMove, humanUndo);
    if (everyCpuReplyLoses) return true;
  }

  return false;
}

function v3HasImmediateWinningMove(position, color, safetyDeadline) {
  const moves = generateLegalMoves(position);
  for (const move of moves) {
    v3EnsureSafetyTime(safetyDeadline);
    const undo = applyMove(position, move);
    const wins = hasColorWin(position.board, color);
    undoMove(position, move, undo);
    if (wins) return true;
  }
  return false;
}

function v3EnsureSafetyTime(deadlineValue) {
  if (performance.now() >= deadlineValue) throw new V3SafetyTimeout("Analyse tactique interrompue");
}

function v3StrategicThreatScore(position, color) {
  const emptiesOnBoard = emptyIndices(position.board).length;
  const special = emptiesOnBoard <= 2;
  let total = 0;
  let dangerousLines = 0;

  for (const line of WIN_LINES) {
    let actual = 0;
    let convertible = 0;
    let empty = 0;

    for (const index of line) {
      const tile = position.board[index];
      if (!tile) {
        empty += 1;
      } else if (tileCenter(tile) === color) {
        actual += 1;
      } else if (index !== position.protectedIndex && tileOtherCenter(tile) === color) {
        convertible += 1;
      }
    }

    const routes = empty + convertible;
    if (actual === 3 && routes > 0) {
      dangerousLines += 1;
      if (special) total += 92_000 + convertible * 18_000;
      else if (emptiesOnBoard === 3) total += 31_000 + convertible * 9_000;
      else if (emptiesOnBoard === 4) total += 12_000 + convertible * 4_000;
      else total += 4_500;
    } else if (actual === 2 && routes >= 2) {
      if (special) total += 6_500 + convertible * 1_100;
      else if (emptiesOnBoard <= 4) total += 2_800 + convertible * 650;
      else total += 700;
    } else if (actual === 1 && convertible >= 2 && emptiesOnBoard <= 3) {
      total += 650;
    }
  }

  if (dangerousLines >= 2) total += special ? 140_000 : emptiesOnBoard <= 4 ? 42_000 : 8_000;
  return total;
}
