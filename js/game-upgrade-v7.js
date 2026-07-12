"use strict";

/*
 * Upgrade v7
 * - corrige le rappel express ;
 * - mémorise séparément le type sélectionné et les faces visibles de chaque joueur ;
 * - affiche toutes les familles de la réserve avec leur face mémorisée ;
 * - avertit au début du prochain tour lorsqu'une famille vient d'être épuisée.
 */
(() => {
  const TILE_KEYS_V7 = ["rb", "yr", "by"];
  const TOAST_DURATION_MS = 5200;
  let toastTimerId = null;
  let toastScheduledFor = null;
  let quickRulesPatching = false;

  function humanControllerV7(player) {
    if (Array.isArray(state.controllers) && state.controllers[player]) {
      return state.controllers[player] === "human";
    }
    return state.mode === "local" || player === 0;
  }

  function freshSelectedTypesV7() {
    return ["rb", "rb"];
  }

  function ensureReserveStateV7() {
    if (!Array.isArray(state.selectedTypeMemory) || state.selectedTypeMemory.length !== 2) {
      state.selectedTypeMemory = freshSelectedTypesV7();
    }
    if (!Array.isArray(state.reserveDepletionPending) || state.reserveDepletionPending.length !== 2) {
      state.reserveDepletionPending = [[], []];
    }
    if (!("reserveSelectionPlayerV7" in state)) state.reserveSelectionPlayerV7 = null;
  }

  function firstAvailableTypeV7(player, preferred) {
    if (preferred && state.reserves?.[player]?.[preferred] > 0) return preferred;
    return TILE_KEYS_V7.find(type => state.reserves?.[player]?.[type] > 0) || preferred || "rb";
  }

  function syncHumanSelectionV7(force = false) {
    ensureReserveStateV7();
    const player = state.currentPlayer;
    if (!humanControllerV7(player)) return;

    if (!force && state.reserveSelectionPlayerV7 === player) return;

    const remembered = state.selectedTypeMemory[player] || "rb";
    const selected = firstAvailableTypeV7(player, remembered);
    state.selectedTypeMemory[player] = selected;
    state.selectedTileType = selected;
    state.selectedFace = state.faceMemory?.[player]?.[selected] ?? 0;
    state.reserveSelectionPlayerV7 = player;
  }

  function currentLanguageV7() {
    return document.documentElement.lang === "en" ? "en" : "fr";
  }

  function installReserveToastV7() {
    if (document.querySelector("#reserveDepletionToast")) return;
    const toast = document.createElement("div");
    toast.id = "reserveDepletionToast";
    toast.className = "reserve-depletion-toast hidden";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
      <span class="reserve-depletion-icon" aria-hidden="true">!</span>
      <span id="reserveDepletionText"></span>
      <button type="button" aria-label="Fermer">×</button>
    `;
    document.body.appendChild(toast);
    toast.querySelector("button")?.addEventListener("click", hideReserveToastV7);
  }

  function hideReserveToastV7() {
    if (toastTimerId !== null) window.clearTimeout(toastTimerId);
    toastTimerId = null;
    const toast = document.querySelector("#reserveDepletionToast");
    toast?.classList.add("hidden");
  }

  function showReserveToastV7(type) {
    installReserveToastV7();
    const toast = document.querySelector("#reserveDepletionToast");
    const text = document.querySelector("#reserveDepletionText");
    if (!toast || !text) return;

    const label = TILE_TYPES[type]?.label || type;
    text.textContent = currentLanguageV7() === "en"
      ? `You have no ${label} tiles left. Another available family has been selected.`
      : `Vous n’avez plus de tuile ${label}. Une autre famille disponible a été sélectionnée.`;

    toast.querySelector("button")?.setAttribute(
      "aria-label",
      currentLanguageV7() === "en" ? "Close" : "Fermer"
    );
    toast.classList.remove("hidden");
    if (toastTimerId !== null) window.clearTimeout(toastTimerId);
    toastTimerId = window.setTimeout(hideReserveToastV7, TOAST_DURATION_MS);
  }

  function schedulePendingReserveToastV7() {
    ensureReserveStateV7();
    const player = state.currentPlayer;
    const pending = state.reserveDepletionPending[player];
    if (!state.roundActive || !humanControllerV7(player) || !pending?.length) return;
    if (toastScheduledFor === player) return;

    toastScheduledFor = player;
    window.setTimeout(() => {
      toastScheduledFor = null;
      if (!state.roundActive || state.currentPlayer !== player || !humanControllerV7(player)) return;
      const type = state.reserveDepletionPending[player]?.shift();
      if (type) showReserveToastV7(type);
    }, 0);
  }

  function injectV7Styles() {
    if (document.querySelector("#gameUpgradeV7Styles")) return;
    const style = document.createElement("style");
    style.id = "gameUpgradeV7Styles";
    style.textContent = `
      .reserve-depletion-toast {
        position: fixed;
        z-index: 1200;
        left: 50%;
        bottom: max(18px, env(safe-area-inset-bottom));
        width: min(520px, calc(100% - 28px));
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 10px;
        padding: 13px 14px;
        border: 1px solid rgba(255, 206, 91, .5);
        border-radius: 15px;
        color: #fff5d8;
        background: rgba(28, 31, 43, .94);
        box-shadow: 0 16px 44px rgba(0, 0, 0, .42);
        backdrop-filter: blur(8px);
        font-weight: 780;
        line-height: 1.35;
        animation: reserve-toast-in .2s ease-out;
      }
      .reserve-depletion-toast.hidden { display: none; }
      .reserve-depletion-icon {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 10px;
        color: #191b24;
        background: #ffd568;
        font-weight: 950;
      }
      .reserve-depletion-toast button {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        color: #d9deeb;
        background: rgba(255, 255, 255, .08);
        cursor: pointer;
        font: inherit;
        font-size: 1.2rem;
      }
      @keyframes reserve-toast-in {
        from { opacity: 0; transform: translate(-50%, 12px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .reserve-depletion-toast { transform: translateX(-50%); }
      @media (max-width: 680px) {
        .reserve-depletion-toast {
          bottom: max(10px, env(safe-area-inset-bottom));
          font-size: .86rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const baseStartRoundV7 = startRound;
  startRound = function startRoundWithReserveSelectionMemoryV7(...args) {
    hideReserveToastV7();
    state.selectedTypeMemory = freshSelectedTypesV7();
    state.reserveDepletionPending = [[], []];
    state.reserveSelectionPlayerV7 = null;
    toastScheduledFor = null;
    return baseStartRoundV7(...args);
  };

  const baseCompleteActionV7 = completeAction;
  completeAction = function completeActionWithReserveWarningsV7(playedIndex, ...rest) {
    ensureReserveStateV7();
    const mover = state.currentPlayer;
    const action = state.action || "place";
    const tile = state.board[playedIndex];

    if (action === "place" && tile && humanControllerV7(mover)) {
      state.selectedTypeMemory[mover] = tile.type;
      if (state.faceMemory?.[mover]) state.faceMemory[mover][tile.type] = tile.face;

      if (state.reserves[mover][tile.type] === 0) {
        const pending = state.reserveDepletionPending[mover];
        if (!pending.includes(tile.type)) pending.push(tile.type);
      }
    }

    state.reserveSelectionPlayerV7 = null;
    return baseCompleteActionV7(playedIndex, ...rest);
  };

  renderReserve = function renderReserveWithCompleteMemoryV7() {
    ensureReserveStateV7();
    syncHumanSelectionV7();

    const player = state.currentPlayer;
    const cpuTurn = isCpuPlayer() || state.cpuThinking;
    const human = humanControllerV7(player);
    els.reserveOwner.textContent = playerName(player);
    els.reserveList.innerHTML = "";

    Object.entries(TILE_TYPES).forEach(([type, data]) => {
      const count = state.reserves[player][type];
      const rememberedFace = human ? (state.faceMemory?.[player]?.[type] ?? 0) : 0;
      const face = state.selectedTileType === type ? state.selectedFace : rememberedFace;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reserve-item";
      button.dataset.tileType = type;
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

    schedulePendingReserveToastV7();
  };

  selectReserveTile = function selectReserveTileWithTypeMemoryV7(type) {
    if (!isHumanTurn()) return;
    ensureReserveStateV7();
    const player = state.currentPlayer;

    if (state.selectedTileType === type) {
      state.selectedFace = 1 - state.selectedFace;
    } else {
      state.selectedTileType = type;
      state.selectedFace = state.faceMemory?.[player]?.[type] ?? 0;
    }

    state.selectedTypeMemory[player] = type;
    state.reserveSelectionPlayerV7 = player;
    renderReserve();
  };

  function patchQuickRulesV7() {
    const overlay = document.querySelector("#quickRulesOverlay");
    if (!overlay || quickRulesPatching) return;
    const placement = document.querySelector("#quickPlacementText");
    const special = document.querySelector("#quickSpecialText");
    if (!placement || !special) return;

    quickRulesPatching = true;
    const english = currentLanguageV7() === "en";
    const placementText = english
      ? "While more than 2 squares are empty, each player can only place tiles; no other action is available."
      : "Tant qu’il reste plus de 2 cases libres, chaque joueur ne peut que poser des tuiles, sans autre action possible.";
    const specialText = english
      ? "Only when exactly 2 empty squares remain (after the 14th move) do the Flip and Move actions become available."
      : "Uniquement lorsqu’il reste exactement 2 cases libres (après le 14e coup), les actions Retourner et Déplacer deviennent disponibles.";

    if (placement.textContent !== placementText) placement.textContent = placementText;
    if (special.textContent !== specialText) special.textContent = specialText;
    quickRulesPatching = false;
  }

  function watchQuickRulesV7() {
    patchQuickRulesV7();
    const observer = new MutationObserver(() => {
      if (quickRulesPatching) return;
      window.requestAnimationFrame(patchQuickRulesV7);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "lang"]
    });
    document.addEventListener("click", event => {
      if (event.target.closest("#languageSwitch button[data-language]")) {
        window.setTimeout(patchQuickRulesV7, 0);
      }
    });
  }

  injectV7Styles();
  installReserveToastV7();
  watchQuickRulesV7();
  ensureReserveStateV7();
})();