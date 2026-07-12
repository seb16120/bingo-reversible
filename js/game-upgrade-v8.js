"use strict";

/*
 * Upgrade v8
 * - ajoute une croix à l'écran de fin de manche / partie ;
 * - permet de masquer l'écran pour analyser le plateau ;
 * - ajoute dans le panneau latéral un bouton grisé pendant la partie,
 *   puis activé pour rouvrir le dernier résultat.
 */
(() => {
  let resultAvailable = false;
  let resultIsMatch = false;

  function isEnglishV8() {
    return document.documentElement.lang === "en";
  }

  function installResultRecallUiV8() {
    const modal = els.resultOverlay?.querySelector(".result-modal");
    if (modal && !document.querySelector("#closeResultBtn")) {
      const closeButton = document.createElement("button");
      closeButton.id = "closeResultBtn";
      closeButton.className = "modal-close result-close-button";
      closeButton.type = "button";
      closeButton.textContent = "×";
      closeButton.setAttribute("data-no-i18n", "true");
      modal.prepend(closeButton);
      closeButton.addEventListener("click", closeResultOverlayV8);
    }

    if (!document.querySelector("#resultRecallBtn")) {
      const quitButton = document.querySelector("#quitBtn");
      if (quitButton) {
        const button = document.createElement("button");
        button.id = "resultRecallBtn";
        button.className = "secondary-button result-recall-button";
        button.type = "button";
        button.disabled = true;
        button.setAttribute("data-no-i18n", "true");
        quitButton.parentNode.insertBefore(button, quitButton);
        button.addEventListener("click", openResultOverlayV8);
      }
    }

    injectResultRecallStylesV8();
    updateResultRecallUiV8();
  }

  function injectResultRecallStylesV8() {
    if (document.querySelector("#gameUpgradeV8Styles")) return;
    const style = document.createElement("style");
    style.id = "gameUpgradeV8Styles";
    style.textContent = `
      .result-modal { position: relative; }
      .result-close-button {
        top: 14px;
        right: 14px;
        z-index: 3;
      }
      .result-recall-button {
        width: 100%;
        margin-top: 0;
        border-color: rgba(121, 226, 180, .28);
        color: #dff9ed;
        background: rgba(121, 226, 180, .08);
      }
      .result-recall-button:not(:disabled):hover {
        border-color: rgba(121, 226, 180, .55);
        background: rgba(121, 226, 180, .14);
      }
      .result-recall-button:disabled {
        opacity: .36;
        border-color: rgba(255, 255, 255, .08);
        color: var(--muted);
        background: rgba(255, 255, 255, .035);
        cursor: not-allowed;
        filter: grayscale(.4);
      }
      @media (max-width: 680px) {
        .result-close-button {
          top: 10px;
          right: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function closeResultOverlayV8() {
    if (!resultAvailable) return;
    els.resultOverlay.classList.add("hidden");
    updateResultRecallUiV8();
  }

  function openResultOverlayV8() {
    if (!resultAvailable) return;
    els.resultOverlay.classList.remove("hidden");
    updateResultRecallUiV8();
  }

  function updateResultRecallUiV8() {
    const english = isEnglishV8();
    const closeButton = document.querySelector("#closeResultBtn");
    const recallButton = document.querySelector("#resultRecallBtn");

    if (closeButton) {
      const label = english ? "Close result and inspect the board" : "Fermer le résultat et analyser le plateau";
      closeButton.setAttribute("aria-label", label);
      closeButton.title = label;
    }

    if (!recallButton) return;
    recallButton.disabled = !resultAvailable;

    if (!resultAvailable) {
      recallButton.textContent = english ? "Round / match result" : "Fin de manche / partie";
      recallButton.title = english
        ? "Available after a win or a draw"
        : "Disponible après une victoire ou une manche nulle";
      return;
    }

    recallButton.textContent = resultIsMatch
      ? (english ? "Match result" : "Fin de partie")
      : (english ? "Round result" : "Fin de manche");
    recallButton.title = english
      ? "Show the result screen again"
      : "Faire réapparaître l’écran de résultat";
  }

  installResultRecallUiV8();

  const baseFinishRoundV8 = finishRound;
  finishRound = function finishRoundWithRecallV8(result) {
    const output = baseFinishRoundV8(result);
    resultAvailable = true;
    resultIsMatch = els.nextRoundBtn.dataset.matchOver === "true";
    updateResultRecallUiV8();
    return output;
  };

  const baseStartRoundV8 = startRound;
  startRound = function startRoundWithoutOldResultV8(...args) {
    resultAvailable = false;
    resultIsMatch = false;
    els.resultOverlay.classList.add("hidden");
    updateResultRecallUiV8();
    return baseStartRoundV8(...args);
  };

  const baseReturnToMenuV8 = returnToMenu;
  returnToMenu = function returnToMenuWithoutResultV8(...args) {
    resultAvailable = false;
    resultIsMatch = false;
    updateResultRecallUiV8();
    return baseReturnToMenuV8(...args);
  };

  els.resultOverlay.addEventListener("click", event => {
    if (event.target === els.resultOverlay) closeResultOverlayV8();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && resultAvailable && !els.resultOverlay.classList.contains("hidden")) {
      closeResultOverlayV8();
    }
  });

  const languageObserverV8 = new MutationObserver(() => updateResultRecallUiV8());
  languageObserverV8.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();