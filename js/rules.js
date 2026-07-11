function placeTile(index) {
  if (!isHumanTurn()) return;
  if (state.board[index]) return setHint("Cette case est déjà occupée.", true);
  const type = state.selectedTileType;
  if (state.reserves[state.currentPlayer][type] <= 0) return setHint("Cette tuile n’est plus disponible.", true);

  state.board[index] = { type, face: state.selectedFace, owner: state.currentPlayer };
  state.reserves[state.currentPlayer][type] -= 1;
  completeAction(index);
}

function flipTile(index) {
  if (!isHumanTurn()) return;
  const tile = state.board[index];
  if (!tile) return setHint("Choisissez une tuile à retourner.", true);
  if (index === state.protectedIndex) return setHint("La tuile du coup précédent est protégée.", true);
  tile.face = 1 - tile.face;
  completeAction(index);
}

function moveTile(index) {
  if (!isHumanTurn()) return;

  if (state.moveSource === null) {
    if (!state.board[index]) return setHint("Choisissez d’abord une tuile.", true);
    if (index === state.protectedIndex) return setHint("La tuile du coup précédent est protégée.", true);
    state.moveSource = index;
    renderBoard();
    renderActions();
    return;
  }

  if (index === state.moveSource) {
    state.moveSource = null;
    renderBoard();
    renderActions();
    return;
  }

  if (!adjacentEmptyCells(state.moveSource).includes(index)) {
    return setHint("Le déplacement doit se faire d’une case, horizontalement ou verticalement, vers une case vide.", true);
  }

  state.board[index] = state.board[state.moveSource];
  state.board[state.moveSource] = null;
  state.moveSource = null;
  completeAction(index);
}

function completeAction(playedIndex) {
  state.moveNumber += 1;
  state.protectedIndex = playedIndex;
  state.winningLine = null;

  const outcome = findWinner();
  if (outcome) {
    state.winningLine = outcome.line;
    renderAll();
    finishRound({ type: "win", winner: outcome.player, reason: `Quatre centres ${COLORS[outcome.color].label.toLowerCase()}s sont alignés.` });
    return;
  }

  if (state.moveNumber >= 50) {
    renderAll();
    finishRound({ type: "draw", reason: "Aucun joueur n’a gagné après 50 coups." });
    return;
  }

  state.currentPlayer = 1 - state.currentPlayer;
  state.turnTime = 60;
  state.lastTimerTick = performance.now();
  state.action = "place";
  state.moveSource = null;

  const repetitions = registerPosition();
  renderAll();
  if (repetitions >= 3) {
    finishRound({ type: "draw", reason: "La même position complète est apparue trois fois." });
    return;
  }

  scheduleCpuTurn();
}

function findWinner() {
  for (let player = 0; player < 2; player += 1) {
    const color = state.secretColors[player];
    for (const line of WIN_LINES) {
      const won = line.every(index => {
        const tile = state.board[index];
        return tile && TILE_TYPES[tile.type].faces[tile.face].center === color;
      });
      if (won) return { player, color, line };
    }
  }
  return null;
}

function registerPosition() {
  const key = positionKey();
  const count = (state.positionCounts.get(key) || 0) + 1;
  state.positionCounts.set(key, count);
  return count;
}

function positionKey() {
  const board = state.board.map(tile => tile ? `${tile.type}${tile.face}p${tile.owner}` : "_").join("|");
  const reserves = state.reserves.map(r => `${r.rb},${r.yr},${r.by}`).join("/");
  return `${board};r=${reserves};p=${state.currentPlayer};x=${state.protectedIndex ?? "-"}`;
}

function emptyCells() {
  const result = [];
  state.board.forEach((tile, index) => { if (!tile) result.push(index); });
  return result;
}

function adjacentEmptyCells(index) {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const candidates = [
    [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]
  ];
  return candidates
    .filter(([r, c]) => r >= 0 && r < 4 && c >= 0 && c < 4)
    .map(([r, c]) => r * 4 + c)
    .filter(i => !state.board[i]);
}

function setHint(message, error = false) {
  els.boardHint.textContent = message;
  els.boardHint.classList.toggle("error", error);
}
