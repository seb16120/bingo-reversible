function startTimer() {
  stopTimer();
  if (!state.timersEnabled) return;
  state.lastTimerTick = performance.now();
  state.timerId = window.setInterval(tickTimer, 200);
}

function stopTimer() {
  if (state.timerId !== null) window.clearInterval(state.timerId);
  state.timerId = null;
  state.lastTimerTick = null;
}

function tickTimer() {
  if (!state.roundActive || !state.timersEnabled) return;
  const now = performance.now();
  const elapsed = (now - state.lastTimerTick) / 1000;
  state.lastTimerTick = now;
  state.turnTime = Math.max(0, state.turnTime - elapsed);
  state.totalTimes[state.currentPlayer] = Math.max(0, state.totalTimes[state.currentPlayer] - elapsed);
  renderTimers();

  if (state.turnTime <= 0) {
    finishRound({ type: "win", winner: 1 - state.currentPlayer, reason: `Le joueur ${state.currentPlayer + 1} a dépassé une minute pour son coup.` });
  } else if (state.totalTimes[state.currentPlayer] <= 0) {
    finishRound({ type: "win", winner: 1 - state.currentPlayer, reason: `Le joueur ${state.currentPlayer + 1} a épuisé ses trente minutes.` });
  }
}

function renderTimers() {
  const enabled = state.timersEnabled;
  els.clockP1Wrap.classList.toggle("hidden", !enabled);
  els.clockP2Wrap.classList.toggle("hidden", !enabled);
  els.turnClockWrap.classList.toggle("hidden", !enabled);
  if (!enabled) return;

  els.clockP1.textContent = formatTime(state.totalTimes[0]);
  els.clockP2.textContent = formatTime(state.totalTimes[1]);
  els.turnClock.textContent = formatTime(state.turnTime);
  applyTimerClass(els.clockP1Wrap, state.totalTimes[0], 300, 60);
  applyTimerClass(els.clockP2Wrap, state.totalTimes[1], 300, 60);
  applyTimerClass(els.turnClockWrap, state.turnTime, 15, 5);
}

function applyTimerClass(element, seconds, warningAt, dangerAt) {
  element.classList.toggle("warning", seconds <= warningAt && seconds > dangerAt);
  element.classList.toggle("danger", seconds <= dangerAt);
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function finishRound(result) {
  if (!state.roundActive) return;
  state.roundActive = false;
  stopTimer();

  if (result.type === "win") state.scores[result.winner] += 1;
  renderHeader();

  const matchWinner = state.scores.findIndex(score => score >= state.targetWins);
  els.resultKicker.textContent = matchWinner >= 0 ? "Fin de la partie" : "Fin de la manche";

  if (result.type === "draw") {
    els.resultTitle.textContent = "Manche nulle";
  } else if (matchWinner >= 0) {
    els.resultTitle.textContent = `Joueur ${matchWinner + 1} remporte la partie !`;
  } else {
    els.resultTitle.textContent = `Joueur ${result.winner + 1} remporte la manche !`;
  }

  els.resultText.textContent = result.reason;
  els.revealedColors.innerHTML = [0, 1].map(player => {
    const color = state.secretColors[player];
    return `<div class="color-chip"><span>Joueur ${player + 1}</span><span class="color-name ${COLORS[color].css}">${COLORS[color].label}</span></div>`;
  }).join("");

  els.nextRoundBtn.textContent = matchWinner >= 0 ? "Rejouer" : "Manche suivante";
  els.nextRoundBtn.dataset.matchOver = matchWinner >= 0 ? "true" : "false";
  els.resultOverlay.classList.remove("hidden");
}

function handleNextRound() {
  if (els.nextRoundBtn.dataset.matchOver === "true") {
    const settings = { seriesLength: state.seriesLength, timersEnabled: state.timersEnabled };
    state = initialState();
    state.seriesLength = settings.seriesLength;
    state.targetWins = Math.ceil(settings.seriesLength / 2);
    state.timersEnabled = settings.timersEnabled;
    state.roundStarter = Math.random() < 0.5 ? 0 : 1;
    startRound(true);
  } else {
    startRound(false);
  }
}

function returnToMenu() {
  stopTimer();
  state.roundActive = false;
  els.privacyOverlay.classList.add("hidden");
  els.resultOverlay.classList.add("hidden");
  els.rulesOverlay.classList.add("hidden");
  els.gameScreen.classList.add("hidden");
  els.menuScreen.classList.remove("hidden");
}

function confirmQuit() {
  if (window.confirm("Abandonner la partie et revenir au menu ?")) returnToMenu();
}

els.setupForm.addEventListener("submit", startMatch);
els.privacyButton.addEventListener("click", handlePrivacyButton);
els.nextRoundBtn.addEventListener("click", handleNextRound);
els.backToMenuBtn.addEventListener("click", returnToMenu);
els.quitBtn.addEventListener("click", confirmQuit);
els.actionButtons.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (button) chooseAction(button.dataset.action);
});
els.rulesBtn.addEventListener("click", () => els.rulesOverlay.classList.remove("hidden"));
els.closeRulesBtn.addEventListener("click", () => els.rulesOverlay.classList.add("hidden"));
els.rulesOverlay.addEventListener("click", event => {
  if (event.target === els.rulesOverlay) els.rulesOverlay.classList.add("hidden");
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !els.rulesOverlay.classList.contains("hidden")) {
    els.rulesOverlay.classList.add("hidden");
  }
});

renderAll();
