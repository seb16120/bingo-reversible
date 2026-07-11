const CPU_PLAYER = 1;
const CPU_DELAY_MS = 650;

function scheduleCpuTurn() {
  if (!state.roundActive || !isCpuPlayer() || state.cpuTimerId !== null) return;

  if (state.mode === "strong") {
    scheduleStrongCpuTurn();
    return;
  }

  state.cpuThinking = true;
  renderAll();
  state.cpuTimerId = window.setTimeout(() => {
    state.cpuTimerId = null;

    if (!state.roundActive || !isCpuPlayer()) {
      state.cpuThinking = false;
      return;
    }

    const move = chooseCpuMove();
    state.cpuThinking = false;

    if (!move) {
      finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
      return;
    }

    executeCpuMove(move);
  }, CPU_DELAY_MS);
}

function cancelCpuTurn() {
  if (state.cpuTimerId !== null) window.clearTimeout(state.cpuTimerId);
  state.cpuTimerId = null;
  if (typeof cancelStrongCpuTurn === "function") cancelStrongCpuTurn();
  state.cpuThinking = false;
}

function chooseCpuMove() {
  const moves = generateLegalMovesForPosition(
    CPU_PLAYER,
    state.board,
    state.reserves,
    state.protectedIndex
  );

  if (!moves.length) return null;

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const score = evaluateCpuMove(move);
    if (score > bestScore || (score === bestScore && moveKey(move) < moveKey(bestMove))) {
      bestMove = move;
      bestScore = score;
    }
  }

  return bestMove;
}

function evaluateCpuMove(move) {
  const board = cloneBoard(state.board);
  const reserves = cloneReserves(state.reserves);
  applyMoveToSnapshot(move, board, reserves, CPU_PLAYER);

  const cpuColor = state.secretColors[CPU_PLAYER];
  // Le CPU respecte l’information secrète : il ne lit pas la couleur réelle
  // du joueur humain. Il se protège donc contre les deux couleurs possibles.
  const possibleHumanColors = Object.keys(COLORS).filter(color => color !== cpuColor);

  const humanAlreadyWins = possibleHumanColors.some(color => hasColorWin(board, color));
  if (humanAlreadyWins) return -100000000;
  if (hasColorWin(board, cpuColor)) return 100000000;

  let score = scoreColorPosition(board, cpuColor) * 12;
  score -= Math.max(...possibleHumanColors.map(color => scoreColorPosition(board, color))) * 9;

  const nextProtectedIndex = move.action === "move" ? move.to : move.index;
  const humanReplies = generateLegalMovesForPosition(0, board, reserves, nextProtectedIndex);
  let immediateThreats = 0;

  for (const reply of humanReplies) {
    const replyBoard = cloneBoard(board);
    const replyReserves = cloneReserves(reserves);
    applyMoveToSnapshot(reply, replyBoard, replyReserves, 0);
    if (possibleHumanColors.some(color => hasColorWin(replyBoard, color))) immediateThreats += 1;
  }

  score -= immediateThreats * 24000;
  score += destinationPreference(move);

  // À score proche, la pose conserve davantage de possibilités de retournement
  // et reste légèrement favorisée par ce CPU volontairement simple.
  if (move.action === "place") score += 3;
  if (move.action === "flip") score += 2;

  return score;
}

function scoreColorPosition(board, color) {
  const weights = [0, 4, 22, 135, 1000000];
  let score = 0;

  for (const line of WIN_LINES) {
    let matching = 0;
    let empty = 0;

    for (const index of line) {
      const tile = board[index];
      if (!tile) {
        empty += 1;
        continue;
      }
      if (tileCenter(tile) === color) matching += 1;
    }

    score += weights[matching];
    if (matching === 3 && empty === 1) score += 180;
    if (matching === 2 && empty >= 1) score += 18;
  }

  return score;
}

function generateLegalMovesForPosition(player, board, reserves, protectedIndex) {
  const moves = [];
  const empties = emptyIndicesOnBoard(board);
  const specialActionsAvailable = empties.length <= 2;

  for (const [type, data] of Object.entries(TILE_TYPES)) {
    if (reserves[player][type] <= 0) continue;
    for (const index of empties) {
      for (let face = 0; face < data.faces.length; face += 1) {
        moves.push({ action: "place", index, type, face });
      }
    }
  }

  if (!specialActionsAvailable) return moves;

  board.forEach((tile, index) => {
    if (!tile || index === protectedIndex) return;
    moves.push({ action: "flip", index });

    for (const destination of adjacentEmptyCellsOnBoard(index, board)) {
      moves.push({ action: "move", from: index, to: destination });
    }
  });

  return moves;
}

function executeCpuMove(move) {
  if (!state.roundActive || !isCpuPlayer()) return;

  let playedIndex;
  state.action = move.action;
  state.moveSource = null;

  if (move.action === "place") {
    state.selectedTileType = move.type;
    state.selectedFace = move.face;
    state.board[move.index] = { type: move.type, face: move.face, owner: CPU_PLAYER };
    state.reserves[CPU_PLAYER][move.type] -= 1;
    playedIndex = move.index;
  } else if (move.action === "flip") {
    state.board[move.index].face = 1 - state.board[move.index].face;
    playedIndex = move.index;
  } else {
    state.board[move.to] = state.board[move.from];
    state.board[move.from] = null;
    playedIndex = move.to;
  }

  completeAction(playedIndex);
}

function applyMoveToSnapshot(move, board, reserves, player) {
  if (move.action === "place") {
    board[move.index] = { type: move.type, face: move.face, owner: player };
    reserves[player][move.type] -= 1;
    return;
  }

  if (move.action === "flip") {
    board[move.index].face = 1 - board[move.index].face;
    return;
  }

  board[move.to] = board[move.from];
  board[move.from] = null;
}

function hasColorWin(board, color) {
  return WIN_LINES.some(line => line.every(index => board[index] && tileCenter(board[index]) === color));
}

function tileCenter(tile) {
  return TILE_TYPES[tile.type].faces[tile.face].center;
}

function cloneBoard(board) {
  return board.map(tile => tile ? { ...tile } : null);
}

function cloneReserves(reserves) {
  return reserves.map(reserve => ({ ...reserve }));
}

function emptyIndicesOnBoard(board) {
  const result = [];
  board.forEach((tile, index) => {
    if (!tile) result.push(index);
  });
  return result;
}

function adjacentEmptyCellsOnBoard(index, board) {
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

function destinationPreference(move) {
  const weights = [
    2, 3, 3, 2,
    3, 6, 6, 3,
    3, 6, 6, 3,
    2, 3, 3, 2
  ];
  const destination = move.action === "move" ? move.to : move.index;
  return weights[destination] || 0;
}

function moveKey(move) {
  if (move.action === "place") return `0-${move.index}-${move.type}-${move.face}`;
  if (move.action === "flip") return `1-${move.index}`;
  return `2-${move.from}-${move.to}`;
}
