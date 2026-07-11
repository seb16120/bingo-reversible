"use strict";

/*
 * Le moteur probabiliste conserve l'alpha-bêta, le filtre tactique et le
 * Monte-Carlo du moteur v3. Cette couche limite toutefois les coups racine
 * à la liste validée par la défense du CPU basique dans le thread principal.
 */
importScripts("strong-cpu-worker-v3.js?v=1");

const v4BaseGenerateLegalMoves = generateLegalMoves;
const v4BaseSearchBestMove = searchBestMoveV3;
let v4RootKey = null;
let v4AllowedRootMoves = null;

generateLegalMoves = function generateLegalMovesV4(position) {
  const moves = v4BaseGenerateLegalMoves(position);
  if (!v4AllowedRootMoves || position.currentPlayer !== CPU_PLAYER) return moves;
  if (rawPositionKey(position) !== v4RootKey) return moves;
  const filtered = moves.filter(move => v4AllowedRootMoves.has(moveKey(move)));
  return filtered.length ? filtered : moves;
};

self.onmessage = event => {
  const message = event.data;
  if (!message || message.type !== "search") return;

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
    const allowed = Array.isArray(payload.allowedRootMoveKeys)
      ? payload.allowedRootMoveKeys
      : [];
    v4AllowedRootMoves = allowed.length ? new Set(allowed) : null;

    const result = v4BaseSearchBestMove(payload);
    self.postMessage({ type: "result", ...result });
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
