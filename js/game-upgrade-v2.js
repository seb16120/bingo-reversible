"use strict";

/* Correctifs et améliorations ajoutés sans perturber les modes déjà publiés. */
(() => {
  const STRONG_V2_SOFT_LIMIT_MS = 56_000;
  const STRONG_V2_HARD_LIMIT_MS = 58_000;
  const STRONG_V2_MIN_BUDGET_MS = 350;

  let audioContext = null;

  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
    return audioContext;
  }

  function unlockTileAudio() {
    const context = getAudioContext();
    if (context?.state === "suspended") context.resume().catch(() => {});
  }

  function playTileSound(action = "place") {
    try {
      const context = getAudioContext();
      if (!context) return;
      if (context.state === "suspended") context.resume().catch(() => {});

      const now = context.currentTime;
      const duration = action === "move" ? 0.085 : 0.07;
      const baseFrequency = action === "flip" ? 235 : action === "move" ? 175 : 195;

      const oscillator = context.createOscillator();
      const oscillatorGain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(baseFrequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, baseFrequency * 0.55), now + duration);
      oscillatorGain.gain.setValueAtTime(0.0001, now);
      oscillatorGain.gain.exponentialRampToValueAtTime(0.13, now + 0.004);
      oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(oscillatorGain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);

      const sampleCount = Math.max(1, Math.floor(context.sampleRate * 0.045));
      const noiseBuffer = context.createBuffer(1, sampleCount, context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < sampleCount; index += 1) {
        const envelope = 1 - index / sampleCount;
        noiseData[index] = (Math.random() * 2 - 1) * envelope;
      }

      const noise = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const noiseGain = context.createGain();
      noise.buffer = noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.value = action === "flip" ? 1_150 : 850;
      filter.Q.value = 0.8;
      noiseGain.gain.setValueAtTime(0.055, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      noise.connect(filter).connect(noiseGain).connect(context.destination);
      noise.start(now);
    } catch (error) {
      console.debug("Son de tuile indisponible", error);
    }
  }

  document.addEventListener("pointerdown", unlockTileAudio, { once: true, passive: true });

  const completeActionBeforeUpgrade = completeAction;
  completeAction = function completeActionWithSound(...args) {
    playTileSound(state.action);
    return completeActionBeforeUpgrade(...args);
  };

  function strongCpuBudgetV2() {
    let budget = STRONG_V2_SOFT_LIMIT_MS;

    if (state.timersEnabled) {
      const safeTurnBudget = Math.max(STRONG_V2_MIN_BUDGET_MS, (state.turnTime - 4) * 1_000);
      const safeTotalBudget = Math.max(STRONG_V2_MIN_BUDGET_MS, (state.totalTimes[CPU_PLAYER] - 4) * 1_000);
      budget = Math.min(budget, safeTurnBudget, safeTotalBudget);
    }

    return Math.max(STRONG_V2_MIN_BUDGET_MS, Math.floor(budget));
  }

  scheduleStrongCpuTurn = function scheduleStrongCpuTurnV2() {
    if (!state.roundActive || state.mode !== "strong" || !isCpuPlayer() || state.strongWorker) return;

    state.cpuThinking = true;
    state.strongSearchStats = { phase: "alpha-beta", depth: 0, nodes: 0, simulations: 0, elapsedMs: 0 };
    state.strongBestMove = null;
    renderAll();

    if (typeof Worker === "undefined") {
      useSimpleCpuFallback("Ce navigateur ne prend pas en charge le calcul en arrière-plan.");
      return;
    }

    const budgetMs = strongCpuBudgetV2();
    const searchId = (state.strongSearchId || 0) + 1;
    state.strongSearchId = searchId;

    let worker;
    try {
      worker = new Worker("js/strong-cpu-worker-v2.js?v=1");
    } catch (error) {
      useSimpleCpuFallback("Impossible de lancer le moteur Strong CPU amélioré.");
      return;
    }

    state.strongWorker = worker;
    state.strongHardTimerId = window.setTimeout(() => {
      if (state.strongSearchId !== searchId || !state.roundActive || !isCpuPlayer()) return;
      finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
    }, Math.min(STRONG_V2_HARD_LIMIT_MS, budgetMs + 2_000));

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
        console.warn("Erreur du moteur Strong CPU v2 :", message.message || message);
        finishStrongCpuSearch(state.strongBestMove || chooseCpuMove(), searchId);
      }
    };

    worker.onerror = error => {
      if (state.strongSearchId !== searchId) return;
      console.warn("Erreur du Web Worker Strong CPU v2 :", error);
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

  const renderHeaderBeforeUpgrade = renderHeader;
  renderHeader = function renderHeaderWithStrongStats() {
    renderHeaderBeforeUpgrade();

    if (!state.cpuThinking || state.mode !== "strong") return;
    const stats = state.strongSearchStats;
    if (!stats) return;

    const elapsed = (stats.elapsedMs / 1_000).toFixed(1);
    if (stats.phase === "monte-carlo") {
      els.phaseText.textContent = `Monte-Carlo · ${stats.simulations.toLocaleString("fr-FR")} simulations · ${elapsed} s`;
    } else if (stats.depth > 0) {
      els.phaseText.textContent = `Alpha-bêta · profondeur ${stats.depth} · ${elapsed} s`;
    }
  };
})();
