function renderBoard() {
  els.board.innerHTML = "";
  const validDestinations = state.action === "move" && state.moveSource !== null
    ? adjacentEmptyCells(state.moveSource)
    : [];

  state.board.forEach((tile, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "board-cell";
    cell.dataset.index = String(index);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", cellAriaLabel(tile, index));

    if (tile) {
      const visual = document.createElement("span");
      visual.className = `tile-visual tile-${tile.type} face-${tile.face}`;
      cell.appendChild(visual);
    }

    if (index === state.protectedIndex && tile) cell.classList.add("protected");
    if (index === state.moveSource) cell.classList.add("selected-source");
    if (validDestinations.includes(index)) cell.classList.add("valid-destination");
    if (state.winningLine?.includes(index)) cell.classList.add("winning");
    if (isCellInteractive(index)) cell.classList.add("interactive");

    cell.addEventListener("click", () => handleBoardClick(index));
    els.board.appendChild(cell);
  });
}

function cellAriaLabel(tile, index) {
  const row = Math.floor(index / 4) + 1;
  const col = (index % 4) + 1;
  if (!tile) return `Case vide, ligne ${row}, colonne ${col}`;
  const face = TILE_TYPES[tile.type].faces[tile.face];
  return `Tuile ${COLORS[face.center].label}, encadrée de ${COLORS[face.border].label}, posée par ${playerName(tile.owner)}`;
}

function renderActions() {
  const special = emptyCells().length <= 2;
  const cpuTurn = isCpuPlayer() || state.cpuThinking;
  const buttons = [...els.actionButtons.querySelectorAll("button")];

  buttons.forEach(button => {
    const action = button.dataset.action;
    button.disabled = cpuTurn || !state.roundActive || (!special && action !== "place");
    button.classList.toggle("active", state.action === action);
  });

  if (!special && state.action !== "place") {
    state.action = "place";
    state.moveSource = null;
  }

  const empty = emptyCells().length;
  els.emptyCount.textContent = `${empty} case${empty > 1 ? "s" : ""} libre${empty > 1 ? "s" : ""}`;
  els.reservePanel.classList.toggle("hidden", state.action !== "place");

  if (cpuTurn && state.roundActive) {
    setHint("Le CPU choisit son coup…");
    return;
  }

  if (state.action === "place") setHint("Choisissez une tuile, puis une case vide.");
  if (state.action === "flip") setHint("Touchez une tuile non protégée pour la retourner.");
  if (state.action === "move") {
    setHint(state.moveSource === null
      ? "Choisissez une tuile non protégée à déplacer."
      : "Choisissez une case vide adjacente, ou retouchez la tuile pour annuler.");
  }
}

function renderReserve() {
  const player = state.currentPlayer;
  const cpuTurn = isCpuPlayer() || state.cpuThinking;
  els.reserveOwner.textContent = playerName(player);
  els.reserveList.innerHTML = "";

  Object.entries(TILE_TYPES).forEach(([type, data]) => {
    const count = state.reserves[player][type];
    const face = state.selectedTileType === type ? state.selectedFace : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reserve-item";
    button.classList.toggle("selected", state.selectedTileType === type);
    button.disabled = count <= 0 || cpuTurn || !state.roundActive;
    button.innerHTML = `
      <span class="tile-visual tile-${type} face-${face}"></span>
      <span><strong>${data.label}</strong><small>${COLORS[data.faces[face].center].label} visible</small></span>
      <span class="reserve-count">${count}</span>
    `;
    button.addEventListener("click", () => selectReserveTile(type));
    els.reserveList.appendChild(button);
  });
}

function selectReserveTile(type) {
  if (!isHumanTurn()) return;
  if (state.selectedTileType === type) state.selectedFace = 1 - state.selectedFace;
  else {
    state.selectedTileType = type;
    state.selectedFace = 0;
  }
  renderReserve();
}

function chooseAction(action) {
  if (!isHumanTurn()) return;
  const special = emptyCells().length <= 2;
  if (!special && action !== "place") return;
  state.action = action;
  state.moveSource = null;
  renderActions();
  renderBoard();
}

function isCellInteractive(index) {
  if (!isHumanTurn()) return false;
  const tile = state.board[index];
  if (state.action === "place") return !tile;
  if (state.action === "flip") return Boolean(tile) && index !== state.protectedIndex;
  if (state.action === "move") {
    if (state.moveSource === null) return Boolean(tile) && index !== state.protectedIndex;
    return index === state.moveSource || adjacentEmptyCells(state.moveSource).includes(index);
  }
  return false;
}

function handleBoardClick(index) {
  if (!isHumanTurn()) return;
  if (state.action === "place") placeTile(index);
  if (state.action === "flip") flipTile(index);
  if (state.action === "move") moveTile(index);
}
