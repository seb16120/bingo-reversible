"use strict";

(() => {
  const button = document.querySelector("#onlineVersionButton");
  const kicker = document.querySelector("#onlineVersionKicker");
  const label = document.querySelector("#onlineVersionLabel");
  if (!button || !kicker || !label) return;

  function updateLanguage() {
    const english = document.documentElement.lang === "en";
    kicker.textContent = english ? "Remote multiplayer mode" : "Mode multijoueur à distance";
    label.textContent = english ? "Play Online" : "Jouer en ligne";
    button.setAttribute("aria-label", english ? "Open the Online version" : "Accéder à la version Online");
  }

  updateLanguage();
  new MutationObserver(updateLanguage).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"]
  });
})();
