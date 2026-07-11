function startMatch(event) {
  event.preventDefault();
  const form = new FormData(els.setupForm);
  const seriesLength = Number(form.get("series"));
  const requestedMode = form.get("mode");
  const mode = requestedMode === "cpu" || requestedMode === "strong" ? requestedMode : "local";

  state = initialState();
  state.mode = mode;
  state.seriesLength = seriesLength;
  state.targetWins = Math.ceil(seriesLength / 2);
  state.timersEnabled = els.timersEnabled.checked;
  state.roundStarter = Math.random() < 0.5 ? 0 : 1;

  els.menuScreen.classList.add("hidden");
  els.gameScreen.classList.remove("hidden");
  startRound(true);
}

function startRound(firstRound = false) {
  stopTimer();
  cancelCpuTurn();
  state.roundNumber += 1;
  if (!firstRound) state.roundStarter = 1 - state.roundStarter;
  state.currentPlayer = state.roundStarter;
  state.secretColors = drawDistinctColors();
  state.board = Array(16).fill(null);
  state.reserves = [freshReserve(), freshReserve()];
  state.protectedIndex = null;
  state.moveNumber = 0;
  state.action = "place";
  state.selectedTileType = "rb";
  state.selectedFace = 0;
  state.moveSource = null;
  state.positionCounts = new Map();
  state.roundActive = false;
  state.revealPlayer = 0;
  state.revealStage = "concealed";
  state.totalTimes = [30 * 60, 30 * 60];
  state.turnTime = 60;
  state.lastTimerTick = null;
  state.winningLine = null;
  state.cpuThinking = false;
  resetStrongCpuKnowledge();

  els.resultOverlay.classList.add("hidden");
  renderAll();
  beginColorReveal();
}

function drawDistinctColors() {
  const shuffled = Object.keys(COLORS).sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function beginColorReveal() {
  els.privacyOverlay.classList.remove("hidden");
  renderPrivacy();
}

function renderPrivacy() {
  const player = state.revealPlayer;
  const revealed = state.revealStage === "revealed";
  els.privacyStep.textContent = `Manche ${state.roundNumber} · Couleur secrète`;
  els.privacyTitle.textContent = `${playerName(player)}, regarde seul l’écran`;
  els.secretColorCard.className = "secret-card";

  if (!revealed) {
    els.privacyInstruction.textContent = isCpuMode()
      ? `Révèle ta couleur. Celle du ${playerName(1)} restera secrète jusqu’à la fin de la manche.`
      : "Quand l’autre joueur ne regarde plus, révèle ta couleur.";
    els.secretColorCard.classList.add("concealed");
    els.secretColorName.textContent = "?";
    els.privacyButton.textContent = "Révéler ma couleur";
  } else {
    const color = state.secretColors[player];
    els.privacyInstruction.textContent = isCpuMode()
      ? "Mémorise-la, puis masque-la pour commencer."
      : "Mémorise-la, puis masque-la avant de passer l’appareil.";
    els.secretColorCard.classList.add(COLORS[color].css);
    els.secretColorName.textContent = COLORS[color].label;

    if (isCpuMode()) {
      els.privacyButton.textContent = "Masquer et commencer";
    } else {
      els.privacyButton.textContent = player === 0 ? "Masquer et passer au joueur 2" : "Masquer et commencer";
    }
  }
}

function handlePrivacyButton() {
  if (state.revealStage === "concealed") {
    state.revealStage = "revealed";
    renderPrivacy();
    return;
  }

  if (isCpuMode()) {
    activateRound();
    return;
  }

  if (state.revealPlayer === 0) {
    state.revealPlayer = 1;
    state.revealStage = "concealed";
    renderPrivacy();
    return;
  }

  activateRound();
}

function activateRound() {
  els.privacyOverlay.classList.add("hidden");
  state.roundActive = true;
  registerPosition();
  startTimer();
  renderAll();
  scheduleCpuTurn();
}

function renderAll() {
  renderHeader();
  renderBoard();
  renderActions();
  renderReserve();
  renderTimers();
}

function renderHeader() {
  els.seriesLabel.textContent = state.seriesLength === 1 ? "1 manche" : `BO${state.seriesLength}`;
  els.roundLabel.textContent = `Manche ${state.roundNumber}`;
  els.moveLabel.textContent = `Coup ${Math.min(state.moveNumber + 1, 50)} / 50`;
  els.scoreP1.textContent = state.scores[0];
  els.scoreP2.textContent = state.scores[1];
  els.player1Name.textContent = playerName(0);
  els.player2Name.textContent = playerName(1);

  els.turnText.textContent = isCpuPlayer()
    ? `Tour du ${playerName(1)}`
    : `Tour du joueur ${state.currentPlayer + 1}`;

  els.player1Card.classList.toggle("active", state.currentPlayer === 0 && state.roundActive);
  els.player2Card.classList.toggle("active", state.currentPlayer === 1 && state.roundActive);
  els.gameScreen.classList.toggle("cpu-turn", isCpuPlayer() && state.roundActive);

  const special = emptyCells().length <= 2;
  if (state.cpuThinking && state.mode === "strong") {
    const stats = state.strongSearchStats;
    els.phaseText.textContent = stats?.depth > 0
      ? `Analyse forte · profondeur ${stats.depth} · ${(stats.elapsedMs / 1000).toFixed(1)} s`
      : "Le Strong CPU analyse la position…";
  } else if (state.cpuThinking) {
    els.phaseText.textContent = "Le CPU réfléchit…";
  } else {
    els.phaseText.textContent = special ? "Pose, retournement ou déplacement" : "Pose obligatoire";
  }
}
