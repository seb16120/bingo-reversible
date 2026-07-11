"use strict";

/*
 * Le moteur probabiliste conserve l'alpha-bêta, le filtre tactique et le
 * Monte-Carlo du moteur v3. Cette couche limite les coups racine aux choix
 * validés par la défense basique. Si une seule défense subsiste, elle est
 * jouée immédiatement. Avec deux ou trois défenses évidentes, la recherche
 * est volontairement raccourcie au lieu d'épuiser les 56 secondes.
 */
importScripts("strong-cpu-worker-v3.js?v=1");

const v4BaseGenerateLegalMoves = generateLegalMoves;
const v4BaseSearchBestMove = searchBestMoveV3;
const V4_SHORT_DEFENSE_BUDGET_MS = 8_000;
let v4RootKey = null;
let v4AllowedRootMoves = null;

generateLegalMoves = function generateLegalMovesV4(position) {
  const moves = v4BaseGenerateLegalMoves(position);
  if (!v4AllowedRootMoves || position.currentPlayer !== CPU_PLAYER) return moves;
  if (rawPositionKey(position) !== v4RootKey) return moves;
  const filtered = moves.filter(move => v4AllowedRootMoves.has(moveKey(move)));
  return filtered.length ? filtered : moves;
};

function rootMoveDanger(root, move, humanColors, cpuColor) {
  const undo = applyMove(root, move);

  if (hasColorWin(root.board, cpuColor)) {
    undoMove(root, move, undo);
    return -1_000_000;
  }

  let danger = humanColors.some(color => hasColorWin(root.board, color)) ? 10_000 : 0;
  const replies = v4BaseGenerateLegalMoves(root);

  for (const reply of replies) {
    const replyUndo = applyMove(root, reply);
    if (humanColors.some(color => hasColorWin(root.board, color))) danger += 1;
    undoMove(root, reply, replyUndo);
  }

  undoMove(root, move, undo);
  return danger;
}

function defensiveRootKeys(payload, root, requestedKeys, allMoves) {
  let moves = allMoves;
  if (requestedKeys?.size) {
    const requested = moves.filter(move => requestedKeys.has(moveKey(move)));
    if (requested.length) moves = requested;
  }
  if (!moves.length) return requestedKeys;

  const beliefs = normalizedBeliefs(payload.beliefs, payload.cpuColor);
  const humanColors = Object.keys(beliefs);
  const scored = moves.map(move => ({
    move,
    danger: rootMoveDanger(root, move, humanColors, payload.cpuColor)
  }));
  const minimum = Math.min(...scored.map(entry => entry.danger));
  return new Set(scored.filter(entry => entry.danger === minimum).map(entry => moveKey(entry.move)));
}

function immediateForcedDefenseResult(allMoves, allowedKeys, startedAt) {
  if (!allowedKeys || allowedKeys.size !== 1) return null;
  const onlyKey = [...allowedKeys][0];
  const move = allMoves.find(candidate => moveKey(candidate) === onlyKey);
  if (!move) return null;
  return {
    move,
    score: 0,
    depth: 0,
    nodes: 0,
    phase: "défense-forcée",
    simulations: 0,
    elapsedMs: performance.now() - startedAt
  };
}

self.onmessage = event => {
  const message = event.data;
  if (!message || message.type !== "search") return;

  const startedAt = performance.now();
  try {
    const payload = message.payload || {};
    const root = {
      board: cloneBoard(payload.board || []),
      reserves: cloneReserves(payload.reserves || []),
      protectedIndex: payload.protectedIndex ?? null,
      currentPlayer: CPU_PLAYER,
      moveNumber: Number(payload.moveNumber) || 0
    };

    v4RootKey = rawPositionKey(root);
    const allMoves = v4BaseGenerateLegalMoves(root);
    const requested = Array.isArray(payload.allowedRootMoveKeys) && payload.allowedRootMoveKeys.length
      ? new Set(payload.allowedRootMoveKeys)
      : null;
    v4AllowedRootMoves = defensiveRootKeys(payload, root, requested, allMoves);

    const forced = immediateForcedDefenseResult(allMoves, v4AllowedRootMoves, startedAt);
    if (forced) {
      self.postMessage({ type: "result", ...forced });
      return;
    }

    const defenseConstrained = Boolean(v4AllowedRootMoves && v4AllowedRootMoves.size < allMoves.length);
    const shortDefense = defenseConstrained && v4AllowedRootMoves.size <= 3;
    const searchPayload = shortDefense
      ? { ...payload, budgetMs: Math.min(Number(payload.budgetMs) || 56_000, V4_SHORT_DEFENSE_BUDGET_MS) }
      : payload;

    const result = v4BaseSearchBestMove(searchPayload);
    self.postMessage({
      type: "result",
      ...result,
      phase: shortDefense ? `${result.phase || "alpha-beta"}+défense-courte` : result.phase
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    v4RootKey = null;
    v4AllowedRootMoves = null;
  }
};