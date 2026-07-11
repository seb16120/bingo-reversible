"use strict";

/*
 * Upgrade v5
 * - journal permanent des coups et coordonnées A–D / 1–4 ;
 * - passage automatique à la manche suivante en duel de CPU ;
 * - informations supplémentaires dans l'historique visuel.
 */
(() => {
  const AUTO_ADVANCE_SECONDS = 30;
  const COLUMN_LABELS = ["A", "B", "C", "D"];
  let autoAdvanceRequested = false;
  let autoAdvanceTimerId = null;
  let autoAdvanceDeadline = 0;

  function isCpuDuel() {
    return state.mode === "cpu-duel"
      && Array.isArray(state.controllers)
      && state.controllers.every(controller => controller !== "human");
  }

  function installAutoAdvanceOption() {
    const fieldset = document.querySelector("#cpuDuelOptions");
    if (!fieldset || document.querySelector("#autoAdvanceCpuRounds")) return;

    const row = document.createElement("label");
    row.className = "toggle-row cpu-auto-advance-row";
    row.htmlFor = "autoAdvanceCpuRounds";
    row.innerHTML = `
      <span>
        <strong>Enchaîner automatiquement les manches</strong>
        <small>Après une fin de manche, lance la suivante au bout de 30 secondes. L'écran final du BO reste affiché.</small>
      </span>
      <input id="autoAdvanceCpuRounds" type="checkbox">
      <span class="toggle" aria-hidden="true"></span>
    `;
    fieldset.appendChild(row);
  }

  function installBoardCoordinates() {
    if (document.querySelector(".board-coordinate-frame")) return;
    const board = els.board;
    const parent = board?.parentNode;
    if (!board || !parent) return;

    const frame = document.createElement("div");
    frame.className = "board-coordinate-frame";

    const columns = document.createElement("div");
    columns.className = "board-column-labels";
    columns.setAttribute("aria-hidden", "true");
    columns.innerHTML = COLUMN_LABELS.map(label => `<span>${label}</span>`).join("");

    const row = document.createElement("div");
    row.className = "board-coordinate-row";

    const rows = document.createElement("div");
    rows.className = "board-row-labels";
    rows.setAttribute("aria-hidden", "true");
    rows.innerHTML = [1, 2, 3, 4].map(label => `<span>${label}</span>`).join("");

    parent.insertBefore(frame, board);
    row.appendChild(board);
    row.appendChild(rows);
    frame.appendChild(columns);
    frame.appendChild(row);
  }

  function installMoveLog() {
    if (document.querySelector("#moveLogPanel")) return;
    const layout = document.querySelector(".game-layout");
    const boardPanel = document.querySelector(".board-panel");
    if (!layout || !boardPanel) return;

    const panel = document.createElement("aside");
    panel.id = "moveLogPanel";
    panel.className = "move-log-panel";
    panel.setAttribute("aria-label", "Journal des coups");
    panel.innerHTML = `
      <div class="move-log-heading">
        <div>
          <p class="eyebrow">Manche en cours</p>
          <h2>Journal des coups</h2>
        </div>
        <span id="moveLogCount">0</span>
      </div>
      <ol id="moveLogList" class="move-log-list"></ol>
      <p id="moveLogEmpty" class="move-log-empty">Aucun coup joué.</p>
    `;
    layout.insertBefore(panel, boardPanel);
    layout.classList.add("with-move-log");
  }

  function installAutoAdvanceCountdown() {
    if (document.querySelector("#autoAdvanceCountdown")) return;
    const actions = els.resultOverlay?.querySelector(".modal-actions");
    if (!actions) return;
    const text = document.createElement("p");
    text.id = "autoAdvanceCountdown";
    text.className = "auto-advance-countdown hidden";
    text.setAttribute("aria-live", "polite");
    actions.parentNode.insertBefore(text, actions);
  }

  function cellCoordinate(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 16) return "?";
    return `${COLUMN_LABELS[index % 4]}${Math.floor(index / 4) + 1}`;
  }

  function playerMarker(player) {
    return `<span class="move-log-player player-${player}" aria-label="${playerName(player)}"></span>`;
  }

  function tileDescription(entry) {
    const center = entry.center && COLORS[entry.center] ? COLORS[entry.center].label : null;
    const border = entry.border && COLORS[entry.border] ? COLORS[entry.border].label : null;
    if (center && border) return `${center}, bord ${border.toLowerCase()}`;
    if (center) return center;
    return "tuile";
  }

  function moveDescription(entry) {
    const destination = cellCoordinate(entry.index);
    if (entry.action === "flip") return `<strong>${destination}</strong><span>↻ Retournement · ${tileDescription(entry)}</span>`;
    if (entry.action === "move") {
      return `<strong>${cellCoordinate(entry.from)} → ${cellCoordinate(entry.to)}</strong><span>${entry.symbol || "→"} Déplacement · ${tileDescription(entry)}</span>`;
    }
    return `<strong>${destination}</strong><span>• Pose · ${tileDescription(entry)}</span>`;
  }

  function renderMoveLog() {
    const list = document.querySelector("#moveLogList");
    const empty = document.querySelector("#moveLogEmpty");
    const count = document.querySelector("#moveLogCount");
    if (!list || !empty || !count) return;

    const history = Array.isArray(state.moveHistory) ? state.moveHistory : [];
    count.textContent = String(history.length);
    empty.classList.toggle("hidden", history.length > 0);
    list.innerHTML = history.map(entry => `
      <li class="move-log-entry player-${entry.player}">
        <span class="move-log-number">${entry.number}</span>
        ${playerMarker(entry.player)}
        <div class="move-log-content">${moveDescription(entry)}</div>
      </li>
    `).join("");
    list.scrollTop = list.scrollHeight;
  }

  function enrichLatestMove() {
    const history = Array.isArray(state.moveHistory) ? state.moveHistory : [];
    const entry = history[history.length - 1];
    if (!entry) return;
    const tile = state.board[entry.index];
    if (!tile) return;
    entry.type = tile.type;
    entry.face = tile.face;
    const face = TILE_TYPES[tile.type]?.faces?.[tile.face];
    if (face) {
      entry.center = face.center;
      entry.border = face.border;
    }
    if (state.lastMove) Object.assign(state.lastMove, entry);
  }

  function clearAutoAdvanceCountdown() {
    if (autoAdvanceTimerId !== null) window.clearInterval(autoAdvanceTimerId);
    autoAdvanceTimerId = null;
    autoAdvanceDeadline = 0;
    const text = document.querySelector("#autoAdvanceCountdown");
    if (text) {
      text.classList.add("hidden");
      text.textContent = "";
    }
  }

  function updateAutoAdvanceCountdown() {
    const text = document.querySelector("#autoAdvanceCountdown");
    if (!text) return;
    const remaining = Math.max(0, Math.ceil((autoAdvanceDeadline - Date.now()) / 1000));
    text.textContent = `Manche suivante automatique dans ${remaining} seconde${remaining > 1 ? "s" : ""}.`;

    if (remaining <= 0) {
      clearAutoAdvanceCountdown();
      if (!els.resultOverlay.classList.contains("hidden") && els.nextRoundBtn.dataset.matchOver !== "true") {
        els.nextRoundBtn.click();
      }
    }
  }

  function startAutoAdvanceCountdown() {
    clearAutoAdvanceCountdown();
    const text = document.querySelector("#autoAdvanceCountdown");
    if (!text) return;
    text.classList.remove("hidden");
    autoAdvanceDeadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    updateAutoAdvanceCountdown();
    autoAdvanceTimerId = window.setInterval(updateAutoAdvanceCountdown, 250);
  }

  installAutoAdvanceOption();
  installBoardCoordinates();
  installMoveLog();
  installAutoAdvanceCountdown();

  els.setupForm.addEventListener("submit", () => {
    autoAdvanceRequested = Boolean(document.querySelector("#autoAdvanceCpuRounds")?.checked);
  }, true);

  const baseRenderBoardV5 = renderBoard;
  renderBoard = function renderBoardV5() {
    baseRenderBoardV5();
    renderMoveLog();
  };

  const baseCompleteActionV5 = completeAction;
  completeAction = function completeActionV5(...args) {
    const result = baseCompleteActionV5(...args);
    enrichLatestMove();
    renderMoveLog();
    return result;
  };

  const baseStartRoundV5 = startRound;
  startRound = function startRoundV5(...args) {
    clearAutoAdvanceCountdown();
    const result = baseStartRoundV5(...args);
    renderMoveLog();
    return result;
  };

  const baseFinishRoundV5 = finishRound;
  finishRound = function finishRoundV5(result) {
    clearAutoAdvanceCountdown();
    baseFinishRoundV5(result);
    renderMoveLog();

    const isMatchOver = els.nextRoundBtn.dataset.matchOver === "true";
    if (autoAdvanceRequested && isCpuDuel() && !isMatchOver) startAutoAdvanceCountdown();
  };

  els.nextRoundBtn.addEventListener("click", clearAutoAdvanceCountdown, true);
  els.backToMenuBtn.addEventListener("click", clearAutoAdvanceCountdown, true);

  window.addEventListener("beforeunload", clearAutoAdvanceCountdown);
  renderMoveLog();
})();