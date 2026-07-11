"use strict";

const TILE_TYPES = {
  rb: { faces: [{ center: "red", border: "blue" }, { center: "blue", border: "red" }] },
  yr: { faces: [{ center: "yellow", border: "red" }, { center: "red", border: "yellow" }] },
  by: { faces: [{ center: "blue", border: "yellow" }, { center: "yellow", border: "blue" }] }
};

const WIN_LINES = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
  [0, 5, 10, 15], [3, 6, 9, 12]
];

const CPU_PLAYER = 1;
const HUMAN_PLAYER = 0;
const MATE_SCORE = 1_000_000_000;
const INF = 2_000_000_000;
const MAX_DEPTH = 12;

let deadline = 0;
let nodes = 0;
let timeCheckCounter = 0;
let transposition = new Map();
let rootPositionCounts = new Map();
let baseHasRepetitionHistory = false;

class SearchTimeout extends Error {}

self.onmessage = event => {
  const message = event.data;
  if (!message || message.type !== "search") return;

  try {
    const result = searchBestMove(message.payload);
    self.postMessage({ type: "result", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

function searchBestMove(payload) {
  const startedAt = performance.now();
  deadline = startedAt + Math.max(250, Number(payload.budgetMs) || 48_000);
  nodes = 0;
  timeCheckCounter = 0;
  transposition = new Map();
  rootPositionCounts = new Map(payload.positionCounts || []);
  baseHasRepetitionHistory = [...rootPositionCounts.values()].some(count => count > 1);

  const position = {
    board: cloneBoard(payload.board),
    reserves: cloneReserves(payload.reserves),
    protectedIndex: payload.protectedIndex ?? null,
    currentPlayer: CPU_PLAYER,
    moveNumber: Number(payload.moveNumber) || 0
  };

  const cpuColor = payload.cpuColor;
  const beliefs = normalizedBeliefs(payload.beliefs, cpuColor);
  const humanColors = Object.keys(beliefs);
  let rootMoves = generateLegalMoves(position);

  if (!rootMoves.length) {
    return { move: null, depth: 0, nodes, elapsedMs: performance.now() - startedAt, score: 0 };
  }

  rootMoves = orderRootMoves(position, rootMoves, cpuColor, beliefs);
  let bestMove = rootMoves[0];
  let bestScore = quickCombinedRootScore(position, bestMove, cpuColor, beliefs);
  let completedDepth = 0;
  let previousScores = new Map();

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    checkTime(true);
    transposition = new Map();

    if (previousScores.size) {
      rootMoves.sort((a, b) => (previousScores.get(moveKey(b)) ?? -INF) - (previousScores.get(moveKey(a)) ?? -INF));
    }

    try {
      const result = searchRootDepth(position, rootMoves, depth, cpuColor, beliefs, humanColors);
      bestMove = result.move;
      bestScore = result.score;
      completedDepth = depth;
      previousScores = result.scores;
      rootMoves = result.orderedMoves;

      self.postMessage({
        type: "progress",
        move: bestMove,
        score: bestScore,
        depth: completedDepth,
        nodes,
        elapsedMs: performance.now() - startedAt,
        beliefSummary: beliefs
      });

      if (result.forcedWinAgainstAllHypotheses) break;
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error;
      break;
    }
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: completedDepth,
    nodes,
    elapsedMs: performance.now() - startedAt,
    beliefSummary: beliefs
  };
}

function searchRootDepth(position, rootMoves, depth, cpuColor, beliefs, humanColors) {
  let bestMove = rootMoves[0];
  let bestScore = -INF;
  let forcedWinAgainstAllHypotheses = false;
  const scores = new Map();
  const detailByMove = new Map();

  for (const move of rootMoves) {
    checkTime();
    const undo = applyMove(position, move);
    const repetitionKey = rawPositionKey(position);
    const previousCount = rootPositionCounts.get(repetitionKey) || 0;
    rootPositionCounts.set(repetitionKey, previousCount + 1);
    const hasRepeatHistory = baseHasRepetitionHistory || previousCount + 1 > 1;

    const colorScores = {};
    for (const humanColor of humanColors) {
      colorScores[humanColor] = minimax(
        position,
        depth - 1,
        -INF,
        INF,
        humanColor,
        cpuColor,
        rootPositionCounts,
        hasRepeatHistory,
        1
      );
    }

    restoreRepetitionCount(repetitionKey, previousCount);
    undoMove(position, move, undo);

    const combined = combineHypothesisScores(colorScores, beliefs);
    scores.set(moveKey(move), combined);
    detailByMove.set(moveKey(move), colorScores);

    if (combined > bestScore || (combined === bestScore && moveKey(move) < moveKey(bestMove))) {
      bestScore = combined;
      bestMove = move;
      forcedWinAgainstAllHypotheses = humanColors.every(color => colorScores[color] >= MATE_SCORE - 200);
    }
  }

  const orderedMoves = [...rootMoves].sort((a, b) => {
    const delta = (scores.get(moveKey(b)) ?? -INF) - (scores.get(moveKey(a)) ?? -INF);
    return delta || moveKey(a).localeCompare(moveKey(b));
  });

  return { move: bestMove, score: bestScore, scores, detailByMove, orderedMoves, forcedWinAgainstAllHypotheses };
}

function minimax(position, depth, alpha, beta, humanColor, cpuColor, repetitions, hasRepeatHistory, ply) {
  nodes += 1;
  checkTime();

  const repetitionCount = repetitions.get(rawPositionKey(position)) || 0;
  const terminal = terminalScore(position, humanColor, cpuColor, repetitionCount, ply);
  if (terminal !== null) return terminal;

  if (depth <= 0) {
    const tactical = immediateWinScore(position, humanColor, cpuColor, ply);
    if (tactical !== null) return tactical;
    return evaluatePosition(position, humanColor, cpuColor);
  }

  const alphaOriginal = alpha;
  const betaOriginal = beta;
  const ttKey = hasRepeatHistory ? null : `${canonicalPositionKey(position)};h=${humanColor}`;
  let ttEntry = null;

  if (ttKey) {
    ttEntry = transposition.get(ttKey);
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === "exact") return ttEntry.value;
      if (ttEntry.flag === "lower") alpha = Math.max(alpha, ttEntry.value);
      if (ttEntry.flag === "upper") beta = Math.min(beta, ttEntry.value);
      if (alpha >= beta) return ttEntry.value;
    }
  }

  let moves = generateLegalMoves(position);
  if (!moves.length) return 0;

  moves = orderMoves(position, moves, humanColor, cpuColor, ttEntry?.bestMoveKey);
  moves = selectivelyLimitMoves(position, moves, depth);

  const maximizing = position.currentPlayer === CPU_PLAYER;
  let value = maximizing ? -INF : INF;
  let bestMoveKey = moveKey(moves[0]);

  for (const move of moves) {
    const undo = applyMove(position, move);
    const repetitionKey = rawPositionKey(position);
    const previousCount = repetitions.get(repetitionKey) || 0;
    repetitions.set(repetitionKey, previousCount + 1);
    const childHasRepeatHistory = hasRepeatHistory || previousCount + 1 > 1;

    const childValue = minimax(
      position,
      depth - 1,
      alpha,
      beta,
      humanColor,
      cpuColor,
      repetitions,
      childHasRepeatHistory,
      ply + 1
    );

    restoreMapCount(repetitions, repetitionKey, previousCount);
    undoMove(position, move, undo);

    if (maximizing) {
      if (childValue > value) {
        value = childValue;
        bestMoveKey = moveKey(move);
      }
      alpha = Math.max(alpha, value);
    } else {
      if (childValue < value) {
        value = childValue;
        bestMoveKey = moveKey(move);
      }
      beta = Math.min(beta, value);
    }

    if (alpha >= beta) break;
  }

  if (ttKey) {
    let flag = "exact";
    if (value <= alphaOriginal) flag = "upper";
    else if (value >= betaOriginal) flag = "lower";
    transposition.set(ttKey, { depth, value, flag, bestMoveKey });
  }

  return value;
}

function terminalScore(position, humanColor, cpuColor, repetitionCount, ply) {
  // Le jeu réel teste le joueur 1 avant le CPU en cas d’alignements simultanés.
  if (hasColorWin(position.board, humanColor)) return -MATE_SCORE + ply;
  if (hasColorWin(position.board, cpuColor)) return MATE_SCORE - ply;
  if (position.moveNumber >= 50 || repetitionCount >= 3) return 0;
  return null;
}

function immediateWinScore(position, humanColor, cpuColor, ply) {
  const player = position.currentPlayer;
  const targetColor = player === CPU_PLAYER ? cpuColor : humanColor;
  const moves = generateLegalMoves(position);

  for (const move of moves) {
    const undo = applyMove(position, move);
    const wins = hasColorWin(position.board, targetColor);
    undoMove(position, move, undo);
    if (wins) return player === CPU_PLAYER ? MATE_SCORE - ply - 1 : -MATE_SCORE + ply + 1;
  }

  return null;
}

function evaluatePosition(position, humanColor, cpuColor) {
  const cpu = colorPotential(position, cpuColor);
  const human = colorPotential(position, humanColor);
  const cpuMobility = legalMoveCountEstimate(position, CPU_PLAYER);
  const humanMobility = legalMoveCountEstimate(position, HUMAN_PLAYER);
  const tempo = position.currentPlayer === CPU_PLAYER ? 9 : -9;

  return cpu * 1.0 - human * 1.08 + (cpuMobility - humanMobility) * 0.35 + tempo;
}

function colorPotential(position, color) {
  const actualWeights = [0, 12, 95, 980, MATE_SCORE / 2];
  const convertibleWeights = [0, 3, 18, 105, 0];
  let total = 0;

  for (const line of WIN_LINES) {
    let actual = 0;
    let convertible = 0;
    let empty = 0;

    for (const index of line) {
      const tile = position.board[index];
      if (!tile) {
        empty += 1;
        continue;
      }

      if (tileCenter(tile) === color) {
        actual += 1;
      } else if (index !== position.protectedIndex && tileOtherCenter(tile) === color) {
        convertible += 1;
      }
    }

    total += actualWeights[actual];
    total += convertibleWeights[Math.min(convertible, 3)];
    total += actual * convertible * 14;

    if (actual === 3 && (empty > 0 || convertible > 0)) total += 1_650;
    if (actual === 2 && empty + convertible >= 2) total += 170;
  }

  position.board.forEach((tile, index) => {
    if (tile && tileCenter(tile) === color) total += cellWeight(index) * 3;
  });

  return total;
}

function legalMoveCountEstimate(position, player) {
  const empties = emptyIndices(position.board).length;
  let placementChoices = 0;
  for (const type of Object.keys(TILE_TYPES)) {
    if (position.reserves[player][type] > 0) placementChoices += empties * 2;
  }

  if (empties > 2) return placementChoices;

  let special = 0;
  position.board.forEach((tile, index) => {
    if (!tile || index === position.protectedIndex) return;
    special += 1 + adjacentEmptyCells(index, position.board).length;
  });
  return placementChoices + special;
}

function orderRootMoves(position, moves, cpuColor, beliefs) {
  return [...moves].sort((a, b) => {
    const delta = quickCombinedRootScore(position, b, cpuColor, beliefs) - quickCombinedRootScore(position, a, cpuColor, beliefs);
    return delta || moveKey(a).localeCompare(moveKey(b));
  });
}

function quickCombinedRootScore(position, move, cpuColor, beliefs) {
  const undo = applyMove(position, move);
  const scores = {};
  for (const humanColor of Object.keys(beliefs)) {
    const terminal = terminalScore(position, humanColor, cpuColor, 0, 1);
    scores[humanColor] = terminal ?? evaluatePosition(position, humanColor, cpuColor);
  }
  undoMove(position, move, undo);
  return combineHypothesisScores(scores, beliefs) + actionPreference(move);
}

function orderMoves(position, moves, humanColor, cpuColor, preferredMoveKey) {
  const maximizing = position.currentPlayer === CPU_PLAYER;
  const scored = moves.map(move => {
    const undo = applyMove(position, move);
    const terminal = terminalScore(position, humanColor, cpuColor, 0, 1);
    const value = terminal ?? evaluatePosition(position, humanColor, cpuColor);
    undoMove(position, move, undo);
    return {
      move,
      score: value + (maximizing ? actionPreference(move) : -actionPreference(move)),
      preferred: moveKey(move) === preferredMoveKey
    };
  });

  scored.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const delta = maximizing ? b.score - a.score : a.score - b.score;
    return delta || moveKey(a.move).localeCompare(moveKey(b.move));
  });

  return scored.map(entry => entry.move);
}

function selectivelyLimitMoves(position, moves, depth) {
  if (moves.length <= 18 || depth <= 2) return moves;

  const empties = emptyIndices(position.board).length;
  let cap;
  if (empties <= 2) {
    cap = depth >= 7 ? 18 : depth >= 5 ? 24 : 34;
  } else {
    cap = depth >= 7 ? 12 : depth >= 5 ? 18 : depth >= 3 ? 30 : moves.length;
  }
  return moves.slice(0, Math.min(cap, moves.length));
}

function combineHypothesisScores(scores, beliefs) {
  const colors = Object.keys(beliefs);
  let expected = 0;
  let worst = INF;
  let confidence = 0;

  for (const color of colors) {
    const probability = beliefs[color];
    expected += probability * scores[color];
    worst = Math.min(worst, scores[color]);
    confidence = Math.max(confidence, probability);
  }

  // Plus la couleur adverse est incertaine, plus le CPU se rapproche du pire cas.
  const caution = (1 - confidence) * 0.7;
  return expected + caution * (worst - expected);
}

function normalizedBeliefs(rawBeliefs, cpuColor) {
  const possible = ["red", "blue", "yellow"].filter(color => color !== cpuColor);
  const result = {};
  let total = 0;

  for (const color of possible) {
    const value = Math.max(0, Number(rawBeliefs?.[color]) || 0);
    result[color] = value;
    total += value;
  }

  if (total <= 0) {
    for (const color of possible) result[color] = 1 / possible.length;
    return result;
  }

  for (const color of possible) result[color] /= total;
  return result;
}

function generateLegalMoves(position) {
  const moves = [];
  const player = position.currentPlayer;
  const empties = emptyIndices(position.board);
  const special = empties.length <= 2;

  for (const [type, data] of Object.entries(TILE_TYPES)) {
    if (position.reserves[player][type] <= 0) continue;
    for (const index of empties) {
      for (let face = 0; face < data.faces.length; face += 1) {
        moves.push({ action: "place", index, type, face });
      }
    }
  }

  if (!special) return moves;

  position.board.forEach((tile, index) => {
    if (!tile || index === position.protectedIndex) return;
    moves.push({ action: "flip", index });
    for (const destination of adjacentEmptyCells(index, position.board)) {
      moves.push({ action: "move", from: index, to: destination });
    }
  });

  return moves;
}

function applyMove(position, move) {
  const undo = {
    protectedIndex: position.protectedIndex,
    currentPlayer: position.currentPlayer,
    moveNumber: position.moveNumber,
    movedTile: null
  };

  if (move.action === "place") {
    position.board[move.index] = { type: move.type, face: move.face, owner: position.currentPlayer };
    position.reserves[position.currentPlayer][move.type] -= 1;
  } else if (move.action === "flip") {
    position.board[move.index].face = 1 - position.board[move.index].face;
  } else {
    undo.movedTile = position.board[move.from];
    position.board[move.to] = position.board[move.from];
    position.board[move.from] = null;
  }

  position.protectedIndex = move.action === "move" ? move.to : move.index;
  position.moveNumber += 1;
  position.currentPlayer = 1 - position.currentPlayer;
  return undo;
}

function undoMove(position, move, undo) {
  position.currentPlayer = undo.currentPlayer;
  position.moveNumber = undo.moveNumber;
  position.protectedIndex = undo.protectedIndex;

  if (move.action === "place") {
    position.board[move.index] = null;
    position.reserves[position.currentPlayer][move.type] += 1;
  } else if (move.action === "flip") {
    position.board[move.index].face = 1 - position.board[move.index].face;
  } else {
    position.board[move.from] = undo.movedTile;
    position.board[move.to] = null;
  }
}

function hasColorWin(board, color) {
  return WIN_LINES.some(line => line.every(index => board[index] && tileCenter(board[index]) === color));
}

function tileCenter(tile) {
  return TILE_TYPES[tile.type].faces[tile.face].center;
}

function tileOtherCenter(tile) {
  return TILE_TYPES[tile.type].faces[1 - tile.face].center;
}

function emptyIndices(board) {
  const result = [];
  board.forEach((tile, index) => {
    if (!tile) result.push(index);
  });
  return result;
}

function adjacentEmptyCells(index, board) {
  const row = Math.floor(index / 4);
  const col = index % 4;
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1]
  ]
    .filter(([r, c]) => r >= 0 && r < 4 && c >= 0 && c < 4)
    .map(([r, c]) => r * 4 + c)
    .filter(destination => !board[destination]);
}

function actionPreference(move) {
  const destination = move.action === "move" ? move.to : move.index;
  const actionBonus = move.action === "place" ? 3 : move.action === "flip" ? 2 : 0;
  return cellWeight(destination) + actionBonus;
}

function cellWeight(index) {
  const weights = [
    4, 2, 2, 4,
    2, 5, 5, 2,
    2, 5, 5, 2,
    4, 2, 2, 4
  ];
  return weights[index] || 0;
}

function rawPositionKey(position) {
  const board = position.board.map(tile => tile ? `${tile.type}${tile.face}p${tile.owner}` : "_").join("|");
  const reserves = position.reserves.map(r => `${r.rb},${r.yr},${r.by}`).join("/");
  return `${board};r=${reserves};p=${position.currentPlayer};x=${position.protectedIndex ?? "-"}`;
}

function canonicalPositionKey(position) {
  const reservePart = position.reserves.map(r => `${r.rb},${r.yr},${r.by}`).join("/");
  let best = null;

  for (let transform = 0; transform < 8; transform += 1) {
    const transformed = Array(16).fill("_");
    position.board.forEach((tile, index) => {
      if (!tile) return;
      const destination = transformIndex(index, transform);
      transformed[destination] = `${tile.type}${tile.face}p${tile.owner}`;
    });
    const transformedProtected = position.protectedIndex === null
      ? "-"
      : transformIndex(position.protectedIndex, transform);
    const key = `${transformed.join("|")};r=${reservePart};p=${position.currentPlayer};x=${transformedProtected};m=${position.moveNumber}`;
    if (best === null || key < best) best = key;
  }

  return best;
}

function transformIndex(index, transform) {
  let row = Math.floor(index / 4);
  let col = index % 4;

  if (transform >= 4) col = 3 - col;
  const rotations = transform % 4;
  for (let step = 0; step < rotations; step += 1) {
    const nextRow = col;
    const nextCol = 3 - row;
    row = nextRow;
    col = nextCol;
  }
  return row * 4 + col;
}

function moveKey(move) {
  if (move.action === "place") return `0-${move.index}-${move.type}-${move.face}`;
  if (move.action === "flip") return `1-${move.index}`;
  return `2-${move.from}-${move.to}`;
}

function cloneBoard(board) {
  return board.map(tile => tile ? { ...tile } : null);
}

function cloneReserves(reserves) {
  return reserves.map(reserve => ({ ...reserve }));
}

function restoreRepetitionCount(key, previousCount) {
  restoreMapCount(rootPositionCounts, key, previousCount);
}

function restoreMapCount(map, key, previousCount) {
  if (previousCount <= 0) map.delete(key);
  else map.set(key, previousCount);
}

function checkTime(force = false) {
  timeCheckCounter += 1;
  if (!force && timeCheckCounter % 256 !== 0) return;
  if (performance.now() >= deadline) throw new SearchTimeout("Temps de recherche écoulé");
}
