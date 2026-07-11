"use strict";

/*
 * Upgrade v4
 * - renomme le Strong CPU en CPU probabiliste ;
 * - ajoute CPU contre CPU avec niveaux Basique / Probabiliste ;
 * - généralise les CPU aux deux places ;
 * - impose la défense immédiate du CPU basique avant la recherche avancée ;
 * - maintient une croyance probabiliste séparée pour chaque CPU probabiliste.
 */
(() => {
  const HUMAN = "human";
  const BASIC = "basic";
  const PROBABILISTIC = "probabilistic";
  const PROB_SOFT_LIMIT_MS = 56_000;
  const PROB_HARD_LIMIT_MS = 58_000;
  const PROB_MIN_BUDGET_MS = 350;
  const CONFIDENCE_CAP = 0.95;
  const BASIC_DELAY_MS = 620;

  function controllerFor(player) {
    if (Array.isArray(state.controllers) && state.controllers[player]) return state.controllers[player];
    if (state.mode === "local") return HUMAN;
    if (player === 0) return HUMAN;
    if (state.mode === "strong" || state.mode === "probabilistic") return PROBABILISTIC;
    return BASIC;
  }

  function controllersForMode(mode, form = null) {
    if (mode === "local") return [HUMAN, HUMAN];
    if (mode === "cpu") return [HUMAN, BASIC];
    if (mode === "probabilistic") return [HUMAN, PROBABILISTIC];
    if (mode === "cpu-duel") {
      const first = form?.get("cpu1Level") === PROBABILISTIC ? PROBABILISTIC : BASIC;
      const second = form?.get("cpu2Level") === PROBABILISTIC ? PROBABILISTIC : BASIC;
      return [first, second];
    }
    return [HUMAN, HUMAN];
  }

  isCpuMode = function isCpuModeV4() {
    return [0, 1].some(player => controllerFor(player) !== HUMAN);
  };

  isCpuPlayer = function isCpuPlayerV4(player = state.currentPlayer) {
    return controllerFor(player) !== HUMAN;
  };

  isHumanTurn = function isHumanTurnV4() {
    return state.roundActive && controllerFor(state.currentPlayer) === HUMAN && !state.cpuThinking;
  };

  playerName = function playerNameV4(player) {
    const controller = controllerFor(player);
    if (controller === HUMAN) return `Joueur ${player + 1}`;
    const duel = state.mode === "cpu-duel";
    if (controller === PROBABILISTIC) return duel ? `CPU probabiliste ${player + 1}` : "CPU probabiliste";
    return duel ? `CPU basique ${player + 1}` : "CPU";
  };

  function installCpuDuelVisibility() {
    const fieldset = document.querySelector("#cpuDuelOptions");
    const update = () => {
      const selected = document.querySelector("input[name='mode']:checked")?.value;
      fieldset?.classList.toggle("hidden", selected !== "cpu-duel");
    };
    document.querySelectorAll("input[name='mode']").forEach(input => input.addEventListener("change", update));
    update();
  }

  const originalStartMatchV4 = startMatch;
  els.setupForm.removeEventListener("submit", originalStartMatchV4);
  startMatch = function startMatchV4(event) {
    event.preventDefault();
    const form = new FormData(els.setupForm);
    const seriesLength = Number(form.get("series"));
    const requestedMode = String(form.get("mode") || "local");
    const allowedModes = new Set(["local", "cpu", "probabilistic", "cpu-duel"]);
    const mode = allowedModes.has(requestedMode) ? requestedMode : "local";

    state = initialState();
    state.mode = mode;
    state.controllers = controllersForMode(mode, form);
    state.seriesLength = seriesLength;
    state.targetWins = Math.ceil(seriesLength / 2);
    state.timersEnabled = els.timersEnabled.checked;
    state.roundStarter = Math.random() < 0.5 ? 0 : 1;
    state.probBeliefs = [{}, {}];
    state.probBeliefHistory = [[], []];

    els.menuScreen.classList.add("hidden");
    els.gameScreen.classList.remove("hidden");
    startRound(true);
  };
  els.setupForm.addEventListener("submit", startMatch);

  const originalHandleNextRoundV4 = handleNextRound;
  els.nextRoundBtn.removeEventListener("click", originalHandleNextRoundV4);
  handleNextRound = function handleNextRoundV4() {
    if (els.nextRoundBtn.dataset.matchOver === "true") {
      const settings = {
        mode: state.mode,
        controllers: [...(state.controllers || controllersForMode(state.mode))],
        seriesLength: state.seriesLength,
        timersEnabled: state.timersEnabled
      };
      state = initialState();
      state.mode = settings.mode;
      state.controllers = settings.controllers;
      state.seriesLength = settings.seriesLength;
      state.targetWins = Math.ceil(settings.seriesLength / 2);
      state.timersEnabled = settings.timersEnabled;
      state.roundStarter = Math.random() < 0.5 ? 0 : 1;
      state.probBeliefs = [{}, {}];
      state.probBeliefHistory = [[], []];
      startRound(true);
    } else {
      startRound(false);
    }
  };
  els.nextRoundBtn.addEventListener("click", handleNextRound);

  function freshBeliefs(player) {
    const ownColor = state.secretColors[player];
    const possibilities = Object.keys(COLORS).filter(color => color !== ownColor);
    return Object.fromEntries(possibilities.map(color => [color, 1 / possibilities.length]));
  }

  function initializeProbabilisticKnowledge() {
    state.probBeliefs = [{}, {}];
    state.probBeliefHistory = [[], []];
    for (let player = 0; player < 2; player += 1) {
      if (controllerFor(player) === PROBABILISTIC) state.probBeliefs[player] = freshBeliefs(player);
    }
  }

  const originalBeginColorRevealV4 = beginColorReveal;
  beginColorReveal = function beginColorRevealV4() {
    initializeProbabilisticKnowledge();
    if ([0, 1].every(player => controllerFor(player) !== HUMAN)) {
      els.privacyOverlay.classList.add("hidden");
      activateRound();
      return;
    }
    originalBeginColorRevealV4();
  };

  function cloneObservation(move, mover) {
    return {
      move: { ...move },
      mover,
      board: cloneBoard(state.board),
      reserves: cloneReserves(state.reserves),
      protectedIndex: state.protectedIndex,
      moveNumber: state.moveNumber
    };
  }

  function applyMoveSnapshotGeneric(move, board, reserves, player) {
    applyMoveToSnapshot(move, board, reserves, player);
  }

  function destinationOf(move) {
    return move.action === "move" ? move.to : move.index;
  }

  function colorsPossibleForOpponent(player) {
    return Object.keys(COLORS).filter(color => color !== state.secretColors[player]);
  }

  function boardHasWin(board, color) {
    return hasColorWin(board, color);
  }

  function immediateWinningMoves(player, moves, board = state.board, reserves = state.reserves) {
    const ownColor = state.secretColors[player];
    return moves.filter(move => {
      const nextBoard = cloneBoard(board);
      const nextReserves = cloneReserves(reserves);
      applyMoveSnapshotGeneric(move, nextBoard, nextReserves, player);
      return boardHasWin(nextBoard, ownColor);
    });
  }

  function moveAllowsImmediateOpponentWin(player, move, opponentColors) {
    const nextBoard = cloneBoard(state.board);
    const nextReserves = cloneReserves(state.reserves);
    applyMoveSnapshotGeneric(move, nextBoard, nextReserves, player);
    const opponent = 1 - player;
    const nextProtected = destinationOf(move);

    if (opponentColors.some(color => boardHasWin(nextBoard, color))) return true;

    const replies = generateLegalMovesForPosition(opponent, nextBoard, nextReserves, nextProtected);
    for (const reply of replies) {
      const replyBoard = cloneBoard(nextBoard);
      const replyReserves = cloneReserves(nextReserves);
      applyMoveSnapshotGeneric(reply, replyBoard, replyReserves, opponent);
      if (opponentColors.some(color => boardHasWin(replyBoard, color))) return true;
    }
    return false;
  }

  function defensiveRootMoves(player, moves) {
    const opponentColors = colorsPossibleForOpponent(player);
    const safe = moves.filter(move => !moveAllowsImmediateOpponentWin(player, move, opponentColors));
    return safe.length ? safe : moves;
  }

  function countImmediateOpponentWins(player, board, reserves, protectedIndex, colors) {
    const opponent = 1 - player;
    let count = 0;
    const replies = generateLegalMovesForPosition(opponent, board, reserves, protectedIndex);
    for (const reply of replies) {
      const replyBoard = cloneBoard(board);
      const replyReserves = cloneReserves(reserves);
      applyMoveSnapshotGeneric(reply, replyBoard, replyReserves, opponent);
      if (colors.some(color => boardHasWin(replyBoard, color))) count += 1;
    }
    return count;
  }

  function evaluateBasicMoveFor(player, move) {
    const board = cloneBoard(state.board);
    const reserves = cloneReserves(state.reserves);
    applyMoveSnapshotGeneric(move, board, reserves, player);
    const ownColor = state.secretColors[player];
    const opponentColors = colorsPossibleForOpponent(player);

    if (boardHasWin(board, ownColor)) return 1_000_000_000;
    if (opponentColors.some(color => boardHasWin(board, color))) return -1_000_000_000;

    let score = scoreColorPosition(board, ownColor) * 12;
    score -= Math.max(...opponentColors.map(color => scoreColorPosition(board, color))) * 9;
    score -= countImmediateOpponentWins(player, board, reserves, destinationOf(move), opponentColors) * 24_000;
    score += destinationPreference(move);
    if (move.action === "place") score += 3;
    if (move.action === "flip") score += 2;
    return score;
  }

  function chooseBasicMoveFor(player, restrictedMoves = null) {
    const legal = restrictedMoves || generateLegalMovesForPosition(player, state.board, state.reserves, state.protectedIndex);
    if (!legal.length) return null;

    const wins = immediateWinningMoves(player, legal);
    if (wins.length) return [...wins].sort((a, b) => moveKey(a).localeCompare(moveKey(b)))[0];

    const candidates = restrictedMoves ? legal : defensiveRootMoves(player, legal);
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const move of candidates) {
      const score = evaluateBasicMoveFor(player, move);
      if (score > bestScore || (score === bestScore && moveKey(move) < moveKey(best))) {
        best = move;
        bestScore = score;
      }
    }
    return best;
  }

  function inferenceMoveScore(observation, move, hypothesizedMoverColor, observerColor) {
    const board = cloneBoard(observation.board);
    const reserves = cloneReserves(observation.reserves);
    applyMoveSnapshotGeneric(move, board, reserves, observation.mover);

    if (boardHasWin(board, hypothesizedMoverColor)) return 100_000;
    if (boardHasWin(board, observerColor)) return -100_000;

    let score = scoreColorPosition(board, hypothesizedMoverColor) * 12;
    score -= scoreColorPosition(board, observerColor) * 10;
    score += destinationPreference(move) * 1.5;
    if (move.action === "flip") score += 4;
    if (move.action === "place") score += 2;
    return score;
  }

  function updateBeliefOf(observer, observation) {
    if (controllerFor(observer) !== PROBABILISTIC) return;
    const ownColor = state.secretColors[observer];
    const possibilities = Object.keys(COLORS).filter(color => color !== ownColor);
    const legalMoves = generateLegalMovesForPosition(
      observation.mover,
      observation.board,
      observation.reserves,
      observation.protectedIndex
    );
    if (!legalMoves.length) return;

    const observedKey = moveKey(observation.move);
    const likelihoods = {};
    let weightedTotal = 0;
    const prior = state.probBeliefs?.[observer] || freshBeliefs(observer);

    for (const color of possibilities) {
      const scored = legalMoves.map(move => ({ move, score: inferenceMoveScore(observation, move, color, ownColor) }));
      scored.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
      const observed = scored.find(entry => moveKey(entry.move) === observedKey);
      if (!observed) {
        likelihoods[color] = 0.025;
      } else {
        const bestScore = scored[0].score;
        const rank = scored.findIndex(entry => entry === observed);
        const gap = Math.max(-12, (observed.score - bestScore) / 150);
        likelihoods[color] = Math.max(0.025, 0.07 + 0.93 * Math.exp(gap) / (1 + rank * 0.025));
      }
      weightedTotal += (Number(prior[color]) || 1 / possibilities.length) * likelihoods[color];
    }

    if (weightedTotal <= 0) return;
    const posterior = {};
    for (const color of possibilities) {
      posterior[color] = ((Number(prior[color]) || 1 / possibilities.length) * likelihoods[color]) / weightedTotal;
    }

    if (possibilities.length === 2) {
      const first = possibilities[0];
      const second = possibilities[1];
      posterior[first] = Math.min(CONFIDENCE_CAP, Math.max(1 - CONFIDENCE_CAP, posterior[first]));
      posterior[second] = 1 - posterior[first];
    }

    state.probBeliefs[observer] = posterior;
    state.probBeliefHistory[observer].push({
      moveNumber: observation.moveNumber + 1,
      mover: observation.mover,
      move: { ...observation.move },
      likelihoods,
      posterior: { ...posterior }
    });
  }

  function updateProbabilisticObservers(observation) {
    if (!observation) return;
    const observer = 1 - observation.mover;
    updateBeliefOf(observer, observation);
  }

  const basePlaceTileV4 = placeTile;
  placeTile = function placeTileV4(index) {
    const before = state.moveNumber;
    if (isHumanTurn() && !state.board[index]) {
      state.v4PendingObservation = cloneObservation({
        action: "place",
        index,
        type: state.selectedTileType,
        face: state.selectedFace
      }, state.currentPlayer);
    }
    const result = basePlaceTileV4(index);
    if (state.moveNumber === before) state.v4PendingObservation = null;
    return result;
  };

  const baseFlipTileV4 = flipTile;
  flipTile = function flipTileV4(index) {
    const before = state.moveNumber;
    if (isHumanTurn() && state.board[index] && index !== state.protectedIndex) {
      state.v4PendingObservation = cloneObservation({ action: "flip", index }, state.currentPlayer);
    }
    const result = baseFlipTileV4(index);
    if (state.moveNumber === before) state.v4PendingObservation = null;
    return result;
  };

  const baseMoveTileV4 = moveTile;
  moveTile = function moveTileV4(index) {
    const before = state.moveNumber;
    const source = state.moveSource;
    if (isHumanTurn() && Number.isInteger(source) && source !== index && adjacentEmptyCells(source).includes(index)) {
      state.v4PendingObservation = cloneObservation({ action: "move", from: source, to: index }, state.currentPlayer);
    }
    const result = baseMoveTileV4(index);
    if (state.moveNumber === before && Number.isInteger(source)) state.v4PendingObservation = null;
    return result;
  };

  const baseCompleteActionV4 = completeAction;
  completeAction = function completeActionV4(playedIndex, ...rest) {
    const observation = state.v4PendingObservation || null;
    updateProbabilisticObservers(observation);
    const result = baseCompleteActionV4(playedIndex, ...rest);

    if (observation?.move?.action === "move" && state.lastMove) {
      const from = observation.move.from;
      const to = observation.move.to;
      const delta = to - from;
      const symbol = delta === -4 ? "↑" : delta === 4 ? "↓" : delta === -1 ? "←" : "→";
      state.lastMove.from = from;
      state.lastMove.to = to;
      state.lastMove.index = to;
      state.lastMove.symbol = symbol;
      const lastHistory = state.moveHistory?.[state.moveHistory.length - 1];
      if (lastHistory) Object.assign(lastHistory, state.lastMove);
      renderBoard();
    }

    state.v4PendingObservation = null;
    return result;
  };

  function executeAutomatedMove(player, move) {
    if (!move || !state.roundActive || state.currentPlayer !== player || controllerFor(player) === HUMAN) return;
    state.v4PendingObservation = cloneObservation(move, player);
    state.action = move.action;
    state.moveSource = null;
    let playedIndex = destinationOf(move);

    if (move.action === "place") {
      state.selectedTileType = move.type;
      state.selectedFace = move.face;
      state.board[move.index] = { type: move.type, face: move.face, owner: player };
      state.reserves[player][move.type] -= 1;
    } else if (move.action === "flip") {
      state.board[move.index].face = 1 - state.board[move.index].face;
    } else {
      state.board[move.to] = state.board[move.from];
      state.board[move.from] = null;
      playedIndex = move.to;
    }

    completeAction(playedIndex);
  }

  function probabilisticBudget(player) {
    let budget = PROB_SOFT_LIMIT_MS;
    if (state.timersEnabled) {
      const safeTurn = Math.max(PROB_MIN_BUDGET_MS, (state.turnTime - 2.5) * 1_000);
      const safeTotal = Math.max(PROB_MIN_BUDGET_MS, (state.totalTimes[player] - 2.5) * 1_000);
      budget = Math.min(budget, safeTurn, safeTotal);
    }
    return Math.max(PROB_MIN_BUDGET_MS, Math.floor(budget));
  }

  function perspectivePayload(player, allowedMoves, budgetMs) {
    const beliefs = { ...(state.probBeliefs?.[player] || freshBeliefs(player)) };
    if (player === 1) {
      return {
        board: cloneBoard(state.board),
        reserves: cloneReserves(state.reserves),
        protectedIndex: state.protectedIndex,
        moveNumber: state.moveNumber,
        positionCounts: [...state.positionCounts.entries()],
        cpuColor: state.secretColors[player],
        beliefs,
        allowedRootMoveKeys: allowedMoves.map(moveKey),
        budgetMs
      };
    }

    const board = state.board.map(tile => tile ? { ...tile, owner: 1 - tile.owner } : null);
    return {
      board,
      reserves: [
        { ...state.reserves[1] },
        { ...state.reserves[0] }
      ],
      protectedIndex: state.protectedIndex,
      moveNumber: state.moveNumber,
      positionCounts: [],
      cpuColor: state.secretColors[player],
      beliefs,
      allowedRootMoveKeys: allowedMoves.map(moveKey),
      budgetMs
    };
  }

  function finishProbabilisticSearch(player, move, searchId, allowedMoves, fallback) {
    if (state.strongSearchId !== searchId) return;
    state.strongWorker?.terminate();
    state.strongWorker = null;
    if (state.strongHardTimerId !== null) window.clearTimeout(state.strongHardTimerId);
    state.strongHardTimerId = null;
    state.cpuThinking = false;

    if (!state.roundActive || state.currentPlayer !== player || controllerFor(player) !== PROBABILISTIC) return;
    const allowedKeys = new Set(allowedMoves.map(moveKey));
    const chosen = move && allowedKeys.has(moveKey(move)) ? move : fallback;
    if (!chosen) {
      finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
      return;
    }
    executeAutomatedMove(player, chosen);
  }

  function startProbabilisticSearch(player) {
    if (!state.roundActive || state.currentPlayer !== player || controllerFor(player) !== PROBABILISTIC) return;
    const legal = generateLegalMovesForPosition(player, state.board, state.reserves, state.protectedIndex);
    if (!legal.length) {
      state.cpuThinking = false;
      finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
      return;
    }

    const wins = immediateWinningMoves(player, legal);
    if (wins.length) {
      state.cpuThinking = false;
      executeAutomatedMove(player, wins.sort((a, b) => moveKey(a).localeCompare(moveKey(b)))[0]);
      return;
    }

    /* Défense non négociable : même filtre que le CPU basique avant l'analyse. */
    const allowedMoves = defensiveRootMoves(player, legal);
    const fallback = chooseBasicMoveFor(player, allowedMoves);
    state.strongBestMove = fallback;

    if (typeof Worker === "undefined") {
      state.cpuThinking = false;
      executeAutomatedMove(player, fallback);
      return;
    }

    const budgetMs = probabilisticBudget(player);
    const searchId = (state.strongSearchId || 0) + 1;
    state.strongSearchId = searchId;
    state.probActivePlayer = player;

    let worker;
    try {
      worker = new Worker("js/probabilistic-cpu-worker-v4.js?v=1");
    } catch (error) {
      state.cpuThinking = false;
      executeAutomatedMove(player, fallback);
      return;
    }

    state.strongWorker = worker;
    state.strongHardTimerId = window.setTimeout(() => {
      finishProbabilisticSearch(player, state.strongBestMove || fallback, searchId, allowedMoves, fallback);
    }, Math.min(PROB_HARD_LIMIT_MS, budgetMs + 2_000));

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
      } else if (message.type === "result") {
        finishProbabilisticSearch(player, message.move || state.strongBestMove || fallback, searchId, allowedMoves, fallback);
      } else if (message.type === "error") {
        console.warn("Erreur du CPU probabiliste :", message.message || message);
        finishProbabilisticSearch(player, state.strongBestMove || fallback, searchId, allowedMoves, fallback);
      }
    };

    worker.onerror = error => {
      if (state.strongSearchId !== searchId) return;
      console.warn("Erreur du Worker probabiliste :", error);
      finishProbabilisticSearch(player, state.strongBestMove || fallback, searchId, allowedMoves, fallback);
    };

    worker.postMessage({ type: "search", payload: perspectivePayload(player, allowedMoves, budgetMs) });
  }

  cancelCpuTurn = function cancelCpuTurnV4() {
    if (state.cpuTimerId !== null) window.clearTimeout(state.cpuTimerId);
    state.cpuTimerId = null;
    state.strongSearchId = (state.strongSearchId || 0) + 1;
    state.strongWorker?.terminate();
    state.strongWorker = null;
    if (state.strongHardTimerId !== null) window.clearTimeout(state.strongHardTimerId);
    state.strongHardTimerId = null;
    state.cpuThinking = false;
    state.probActivePlayer = null;
  };

  scheduleCpuTurn = function scheduleCpuTurnV4() {
    if (!state.roundActive || !isCpuPlayer() || state.cpuThinking || state.cpuTimerId !== null || state.strongWorker) return;
    const player = state.currentPlayer;
    const controller = controllerFor(player);
    state.cpuThinking = true;
    state.strongSearchStats = controller === PROBABILISTIC
      ? { phase: "défense-basique", depth: 0, nodes: 0, simulations: 0, elapsedMs: 0 }
      : null;
    renderAll();

    state.cpuTimerId = window.setTimeout(() => {
      state.cpuTimerId = null;
      if (!state.roundActive || state.currentPlayer !== player || controllerFor(player) === HUMAN) {
        state.cpuThinking = false;
        return;
      }

      if (controller === BASIC) {
        const move = chooseBasicMoveFor(player);
        state.cpuThinking = false;
        if (move) executeAutomatedMove(player, move);
        else finishRound({ type: "draw", reason: "Aucun coup légal n’est disponible." });
        return;
      }

      startProbabilisticSearch(player);
    }, controller === BASIC ? BASIC_DELAY_MS : 80);
  };

  const baseRenderHeaderV4 = renderHeader;
  renderHeader = function renderHeaderV4() {
    baseRenderHeaderV4();
    const player = state.currentPlayer;
    if (isCpuPlayer(player)) els.turnText.textContent = `Tour de ${playerName(player)}`;

    if (state.cpuThinking && controllerFor(player) === PROBABILISTIC) {
      const stats = state.strongSearchStats;
      const elapsed = ((stats?.elapsedMs || 0) / 1_000).toFixed(1);
      const phase = String(stats?.phase || "");
      if (phase.includes("monte-carlo")) {
        els.phaseText.textContent = `CPU probabiliste · Monte-Carlo · ${(stats?.simulations || 0).toLocaleString("fr-FR")} simulations · ${elapsed} s`;
      } else if ((stats?.depth || 0) > 0) {
        els.phaseText.textContent = `CPU probabiliste · alpha-bêta · profondeur ${stats.depth} · ${elapsed} s`;
      } else {
        els.phaseText.textContent = "CPU probabiliste · contrôle défensif…";
      }
    } else if (state.cpuThinking && controllerFor(player) === BASIC) {
      els.phaseText.textContent = "Le CPU basique choisit son coup…";
    }
  };

  const baseRenderActionsV4 = renderActions;
  renderActions = function renderActionsV4() {
    baseRenderActionsV4();
    const recall = document.querySelector("#recallColorBtn");
    if (recall) {
      const human = controllerFor(state.currentPlayer) === HUMAN;
      recall.classList.toggle("hidden", !human);
      recall.disabled = !state.roundActive || !human || state.cpuThinking;
    }
  };

  installCpuDuelVisibility();
  renderAll();
})();
