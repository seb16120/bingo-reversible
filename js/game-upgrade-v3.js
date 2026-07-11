"use strict";

/* Ergonomie des réserves, rappel de couleur et historique visuel des coups. */
(() => {
  const TILE_KEYS = ["rb", "yr", "by"];
  const STRONG_V3_SOFT_LIMIT_MS = 56_000;
  const STRONG_V3_HARD_LIMIT_MS = 58_000;
  const STRONG_V3_MIN_BUDGET_MS = 350;
  let debugRequested = false;
  let pendingMoveDescriptor = null;
  let recalledPlayer = 0;
  let recallRevealed = false;

  function freshFaceMemory() {
    return TILE_KEYS.reduce((memory, type) => {
      memory[type] = 0;
      return memory;
    }, {});
  }

  function ensureUpgradeState() {
    if (!Array.isArray(state.faceMemory) || state.faceMemory.length !== 2) {
      state.faceMemory = [freshFaceMemory(), freshFaceMemory()];
    }
    if (!Array.isArray(state.moveHistory)) state.moveHistory = [];
    if (!("lastMove" in state)) state.lastMove = null;
    if (!("debugEnabled" in state)) state.debugEnabled = debugRequested;
    if (!("reserveMemoryPlayer" in state)) state.reserveMemoryPlayer = null;
  }

  function isHumanController(player) {
    return state.mode === "local" || player === 0;
  }

  function installSetupDebugOption() {
    if (document.querySelector("#debugEnabled")) return;
    const timerRow = document.querySelector("label[for='timersEnabled']");
    if (!timerRow) return;

    const debugRow = document.createElement("label");
    debugRow.className = "toggle-row debug-toggle-row";
    debugRow.htmlFor = "debugEnabled";
    debugRow.innerHTML = `
      <span>
        <strong>Mode débogage</strong>
        <small>Conserve sur le plateau les symboles numérotés des coups précédents pour faciliter l’analyse.</small>
      </span>
      <input id="debugEnabled" type="checkbox">
      <span class="toggle" aria-hidden="true"></span>
    `;
    timerRow.parentNode.insertBefore(debugRow, timerRow);
  }

  function installColorRecallUi() {
    if (!document.querySelector("#recallColorBtn")) {
      const quitButton = document.querySelector("#quitBtn");
      if (quitButton) {
        const button = document.createElement("button");
        button.id = "recallColorBtn";
        button.className = "secondary-button recall-color-button";
        button.type = "button";
        button.textContent = "Regarder une nouvelle fois sa couleur";
        quitButton.parentNode.insertBefore(button, quitButton);
      }
    }

    if (!document.querySelector("#colorRecallOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "colorRecallOverlay";
      overlay.className = "overlay hidden";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "colorRecallTitle");
      overlay.innerHTML = `
        <div class="modal privacy-modal">
          <p class="eyebrow">Couleur secrète</p>
          <h2 id="colorRecallTitle">Joueur 1, regarde seul l’écran</h2>
          <p id="colorRecallInstruction">Quand l’autre joueur ne regarde plus, révèle ta couleur.</p>
          <div id="colorRecallCard" class="secret-card concealed" aria-live="polite">
            <span id="colorRecallName">?</span>
          </div>
          <button id="colorRecallAction" class="primary-button" type="button">Révéler ma couleur</button>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    document.querySelector("#recallColorBtn")?.addEventListener("click", openColorRecall);
    document.querySelector("#colorRecallAction")?.addEventListener("click", handleColorRecallAction);
  }

  function openColorRecall() {
    if (!state.roundActive || !isHumanController(state.currentPlayer) || state.cpuThinking) return;
    recalledPlayer = state.currentPlayer;
    recallRevealed = false;
    renderColorRecall();
    document.querySelector("#colorRecallOverlay")?.classList.remove("hidden");
  }

  function handleColorRecallAction() {
    if (!recallRevealed) {
      recallRevealed = true;
      renderColorRecall();
      return;
    }
    document.querySelector("#colorRecallOverlay")?.classList.add("hidden");
  }

  function renderColorRecall() {
    const title = document.querySelector("#colorRecallTitle");
    const instruction = document.querySelector("#colorRecallInstruction");
    const card = document.querySelector("#colorRecallCard");
    const name = document.querySelector("#colorRecallName");
    const action = document.querySelector("#colorRecallAction");
    if (!title || !instruction || !card || !name || !action) return;

    title.textContent = `${playerName(recalledPlayer)}, regarde seul l’écran`;
    card.className = "secret-card";

    if (!recallRevealed) {
      instruction.textContent = state.mode === "local"
        ? "Quand l’autre joueur ne regarde plus, révèle ta couleur."
        : `Révèle ta couleur. Celle du ${playerName(1)} reste secrète.`;
      card.classList.add("concealed");
      name.textContent = "?";
      action.textContent = "Révéler ma couleur";
      return;
    }

    const color = state.secretColors[recalledPlayer];
    instruction.textContent = "Mémorise-la, puis masque-la pour reprendre la partie.";
    card.classList.add(COLORS[color].css);
    name.textContent = COLORS[color].label;
    action.textContent = "Masquer et reprendre";
  }

  function directionSymbol(from, to) {
    const delta = to - from;
    if (delta === -4) return "↑";
    if (delta === 4) return "↓";
    if (delta === -1) return "←";
    if (delta === 1) return "→";
    return "→";
  }

  function descriptorForAction(playedIndex) {
    const player = state.currentPlayer;
    const action = state.action || "place";
    const descriptor = {
      number: state.moveNumber + 1,
      player,
      action,
      index: playedIndex,
      symbol: "•"
    };

    if (action === "flip") descriptor.symbol = "↻";
    if (action === "move") {
      const from = pendingMoveDescriptor?.from;
      const to = pendingMoveDescriptor?.to ?? playedIndex;
      descriptor.from = from;
      descriptor.to = to;
      descriptor.index = to;
      descriptor.symbol = Number.isInteger(from) ? directionSymbol(from, to) : "→";
    }
    return descriptor;
  }

  function renderMoveMarkers() {
    ensureUpgradeState();
    const cells = [...els.board.querySelectorAll(".board-cell")];
    for (const cell of cells) {
      cell.querySelectorAll(".current-move-marker, .debug-move-stack").forEach(marker => marker.remove());
    }

    if (state.debugEnabled && state.moveHistory.length > 1) {
      const historyByCell = new Map();
      for (const entry of state.moveHistory.slice(0, -1)) {
        const list = historyByCell.get(entry.index) || [];
        list.push(entry);
        historyByCell.set(entry.index, list);
      }

      for (const [index, entries] of historyByCell.entries()) {
        const cell = cells[index];
        if (!cell) continue;
        const stack = document.createElement("span");
        stack.className = "debug-move-stack";
        stack.setAttribute("aria-hidden", "true");

        const visibleEntries = entries.slice(-8);
        for (const entry of visibleEntries) {
          const marker = document.createElement("span");
          marker.className = `debug-move-marker player-${entry.player}`;
          marker.innerHTML = `<span class="debug-symbol">${entry.symbol}</span><span class="debug-number">${entry.number}</span>`;
          stack.appendChild(marker);
        }
        if (entries.length > visibleEntries.length) {
          const overflow = document.createElement("span");
          overflow.className = "debug-move-overflow";
          overflow.textContent = `+${entries.length - visibleEntries.length}`;
          stack.appendChild(overflow);
        }
        cell.appendChild(stack);
      }
    }

    const last = state.lastMove;
    if (!last || !cells[last.index]) return;
    const marker = document.createElement("span");
    marker.className = `current-move-marker action-${last.action} player-${last.player}`;
    marker.setAttribute("aria-hidden", "true");
    marker.innerHTML = `<span>${last.symbol}</span>${state.debugEnabled ? `<small>${last.number}</small>` : ""}`;
    cells[last.index].appendChild(marker);
  }

  installSetupDebugOption();
  installColorRecallUi();

  els.setupForm.addEventListener("submit", () => {
    debugRequested = Boolean(document.querySelector("#debugEnabled")?.checked);
  }, true);

  function strongCpuBudgetV3() {
    let budget = STRONG_V3_SOFT_LIMIT_MS;
    if (state.timersEnabled) {
      const safeTurnBudget = Math.max(STRONG_V3_MIN_BUDGET_MS, (state.turnTime - 4) * 1_000);
      const safeTotalBudget = Math.max(STRONG_V3_MIN_BUDGET_MS, (state.totalTimes[CPU_PLAYER] - 4) * 1_000);
      budget = Math.min(budget, safeTurnBudget, safeTotalBudget);
    }
    return Math.max(STRONG_V3_MIN_BUDGET_MS, Math.floor(budget));
  }

  scheduleStrongCpuTurn = function scheduleStrongCpuTurnV3() {
    if (!state.roundActive || state.mode !== "strong" || !isCpuPlayer() || state.strongWorker) return;

    state.cpuThinking = true;
    state.strongSearchStats = { phase: "alpha-beta", depth: 0, nodes: 0, simulations: 0, elapsedMs: 0 };
    state.strongBestMove = null;
    renderAll();

    if (typeof Worker === "undefined") {
      useSimpleCpuFallback("Ce navigateur ne prend pas en charge le calcul en arrière-plan.");
      return;
    }

    const budgetMs = strongCpuBudgetV3();
    const searchId = (state.strongSearchId || 0) + 1;
    state.strongSearchId = searchId;

    let worker;
    try {
      worker = new Worker("js/strong-cpu-worker-v3.js?v=1");
    } catch (error) {
      useSimpleCpuFallback("Impossible de lancer le moteur Strong CPU v3.");
      return;
    }

    state.strongWorker = worker;
    state.strongHardTimerId = window.setTimeout(() => {
      if (state.strongSearchId !== searchId || !state.roundActive || !isCpuPlayer()) return;
      finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
    }, Math.min(STRONG_V3_HARD_LIMIT_MS, budgetMs + 2_000));

    worker.onmessage = event => {
      if (state.strongSearchId !== searchId) return;
      const message = event.data || {};

      if (message.type === "progress") {
        if (message.move) state.strongBestMove = message.move;
        state.strongSearchStats = {
          phase: message.phase || "alpha-beta",
          depth: Number(message.depth) || 0,
          nodes: Number(message.nodes) || 0,
          simulations: Number(message.simulations) || 0,
          elapsedMs: Number(message.elapsedMs) || 0
        };
        renderHeader();
        renderActions();
        return;
      }

      if (message.type === "result") {
        state.strongSearchStats = {
          phase: message.phase || "alpha-beta",
          depth: Number(message.depth) || 0,
          nodes: Number(message.nodes) || 0,
          simulations: Number(message.simulations) || 0,
          elapsedMs: Number(message.elapsedMs) || 0
        };
        finishStrongCpuSearch(message.move || state.strongBestMove || chooseCpuMove(), searchId);
        return;
      }

      if (message.type === "error") {
        console.warn("Erreur du moteur Strong CPU v3 :", message.message || message);
        finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
      }
    };

    worker.onerror = error => {
      if (state.strongSearchId !== searchId) return;
      console.warn("Erreur du Web Worker Strong CPU v3 :", error);
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
  };

  const baseStartRoundV3 = startRound;
  startRound = function startRoundWithUpgradeV3(...args) {
    state.debugEnabled = debugRequested;
    state.faceMemory = [freshFaceMemory(), freshFaceMemory()];
    state.reserveMemoryPlayer = null;
    state.moveHistory = [];
    state.lastMove = null;
    pendingMoveDescriptor = null;
    document.querySelector("#colorRecallOverlay")?.classList.add("hidden");
    return baseStartRoundV3(...args);
  };

  const baseRenderReserveV3 = renderReserve;
  renderReserve = function renderReserveWithFaceMemory() {
    ensureUpgradeState();
    const player = state.currentPlayer;
    if (isHumanController(player) && state.reserveMemoryPlayer !== player) {
      state.selectedFace = state.faceMemory[player][state.selectedTileType] ?? 0;
      state.reserveMemoryPlayer = player;
    }
    return baseRenderReserveV3();
  };

  selectReserveTile = function selectReserveTileWithFaceMemory(type) {
    if (!isHumanTurn()) return;
    ensureUpgradeState();
    const player = state.currentPlayer;
    if (state.selectedTileType === type) {
      state.selectedFace = 1 - state.selectedFace;
    } else {
      state.selectedTileType = type;
      state.selectedFace = state.faceMemory[player][type] ?? 0;
    }
    renderReserve();
  };

  const baseMoveTileV3 = moveTile;
  moveTile = function moveTileWithDescriptor(index) {
    const source = state.moveSource;
    const isFinalMove = Number.isInteger(source)
      && source !== index
      && adjacentEmptyCells(source).includes(index);
    if (isFinalMove) pendingMoveDescriptor = { action: "move", from: source, to: index };
    const before = state.moveNumber;
    const result = baseMoveTileV3(index);
    if (state.moveNumber === before) pendingMoveDescriptor = null;
    return result;
  };

  const baseExecuteCpuMoveV3 = executeCpuMove;
  executeCpuMove = function executeCpuMoveWithDescriptor(move) {
    pendingMoveDescriptor = move ? { ...move } : null;
    return baseExecuteCpuMoveV3(move);
  };

  const baseCompleteActionV3 = completeAction;
  completeAction = function completeActionWithMemoryAndHistory(playedIndex, ...rest) {
    ensureUpgradeState();
    const descriptor = descriptorForAction(playedIndex);

    if (descriptor.action === "place" && isHumanController(descriptor.player)) {
      const tile = state.board[playedIndex];
      if (tile) state.faceMemory[descriptor.player][tile.type] = tile.face;
    }

    state.lastMove = descriptor;
    state.moveHistory.push(descriptor);
    pendingMoveDescriptor = null;
    return baseCompleteActionV3(playedIndex, ...rest);
  };

  const baseRenderBoardV3 = renderBoard;
  renderBoard = function renderBoardWithMoveMarkers() {
    baseRenderBoardV3();
    renderMoveMarkers();
  };

  const baseRenderActionsV3 = renderActions;
  renderActions = function renderActionsWithRecallButton() {
    baseRenderActionsV3();
    const button = document.querySelector("#recallColorBtn");
    if (!button) return;
    const available = state.roundActive && isHumanController(state.currentPlayer) && !state.cpuThinking;
    button.disabled = !available;
    button.classList.toggle("hidden", !isHumanController(state.currentPlayer) && state.roundActive);
  };

  const baseReturnToMenuV3 = returnToMenu;
  returnToMenu = function returnToMenuWithRecallClose(...args) {
    document.querySelector("#colorRecallOverlay")?.classList.add("hidden");
    return baseReturnToMenuV3(...args);
  };

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.querySelector("#colorRecallOverlay")?.classList.add("hidden");
  });

  const baseRenderHeaderV3 = renderHeader;
  renderHeader = function renderHeaderWithV3Stats() {
    baseRenderHeaderV3();
    if (!state.cpuThinking || state.mode !== "strong" || !state.strongSearchStats) return;
    const stats = state.strongSearchStats;
    const elapsed = (stats.elapsedMs / 1_000).toFixed(1);
    const phase = String(stats.phase || "");
    if (phase.includes("monte-carlo")) {
      const safety = phase.includes("sécurité") ? " · filtre tactique" : "";
      els.phaseText.textContent = `Monte-Carlo · ${stats.simulations.toLocaleString("fr-FR")} simulations · ${elapsed} s${safety}`;
    } else if (stats.depth > 0) {
      els.phaseText.textContent = `Alpha-bêta · profondeur ${stats.depth} · ${elapsed} s`;
    }
  };

  renderAll();
})();
