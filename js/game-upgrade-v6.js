"use strict";

/*
 * Upgrade v6
 * - rappel express avant la révélation des couleurs ;
 * - sélecteur FR / EN toujours visible ;
 * - traduction de l'interface statique et des messages dynamiques.
 */
(() => {
  const LANGUAGE_STORAGE_KEY = "bingo-reversible-language";
  const SUPPORTED_LANGUAGES = new Set(["fr", "en"]);
  let currentLanguage = SUPPORTED_LANGUAGES.has(localStorage.getItem(LANGUAGE_STORAGE_KEY))
    ? localStorage.getItem(LANGUAGE_STORAGE_KEY)
    : "fr";
  let introPending = false;
  let translating = false;

  const exactPairs = [
    ["Local à deux ou contre CPU", "Local two-player or vs CPU"],
    ["Bingo réversible", "Reversible Bingo"],
    ["Afficher les règles", "Show rules"],
    ["Règles", "Rules"],
    ["Retournez. Déplacez. Alignez.", "Flip. Move. Align."],
    ["Préparer la partie", "Set up the game"],
    ["Chaque joueur reçoit une couleur secrète. Le premier à en aligner quatre gagne la manche.", "Each player receives a secret color. The first to align four of it wins the round."],
    ["Mode de jeu", "Game mode"],
    ["2 joueurs", "2 players"],
    ["Vs. CPU probabiliste", "Vs. Probabilistic CPU"],
    ["Le CPU probabiliste analyse jusqu’à 56 secondes et force son meilleur coup trouvé au plus tard à 58 secondes.", "The Probabilistic CPU analyzes for up to 56 seconds and plays its best move found no later than 58 seconds."],
    ["Niveaux des CPU", "CPU levels"],
    ["CPU joueur 1", "Player 1 CPU"],
    ["CPU joueur 2", "Player 2 CPU"],
    ["Basique", "Basic"],
    ["Probabiliste", "Probabilistic"],
    ["Format", "Format"],
    ["1 manche", "1 round"],
    ["Mode débogage", "Debug mode"],
    ["Conserve sur le plateau les symboles numérotés des coups précédents pour faciliter l’analyse.", "Keeps numbered symbols from previous moves on the board to make analysis easier."],
    ["Partie chronométrée", "Timed match"],
    ["1 min par coup et 30 min par joueur, réinitialisées à chaque manche.", "1 min per move and 30 min per player, reset at the start of each round."],
    ["Lancer la partie", "Start game"],
    ["Manches", "Rounds"],
    ["Ce coup", "This move"],
    ["Action", "Action"],
    ["Poser", "Place"],
    ["Retourner", "Flip"],
    ["Déplacer", "Move"],
    ["Réserve", "Reserve"],
    ["Touchez une tuile pour la choisir. Touchez-la à nouveau pour changer de face.", "Tap a tile to select it. Tap it again to change its visible side."],
    ["Protégée pendant ce tour", "Protected this turn"],
    ["Seule la couleur centrale compte", "Only the center color counts"],
    ["Regarder une nouvelle fois sa couleur", "View your color again"],
    ["Abandonner la partie", "Forfeit match"],
    ["Couleur secrète", "Secret color"],
    ["Quand l’autre joueur ne regarde plus, révèle ta couleur.", "When the other player is no longer looking, reveal your color."],
    ["Révéler ma couleur", "Reveal my color"],
    ["Mémorise-la, puis masque-la pour commencer.", "Memorize it, then hide it to begin."],
    ["Mémorise-la, puis masque-la avant de passer l’appareil.", "Memorize it, then hide it before passing the device."],
    ["Mémorise-la, puis masque-la pour reprendre la partie.", "Memorize it, then hide it to resume the game."],
    ["Masquer et commencer", "Hide and begin"],
    ["Masquer et passer au joueur 2", "Hide and pass to player 2"],
    ["Masquer et reprendre", "Hide and resume"],
    ["Fin de la manche", "End of round"],
    ["Fin de la partie", "End of match"],
    ["Manche nulle", "Drawn round"],
    ["Score de la série", "Series score"],
    ["Manche suivante", "Next round"],
    ["Rejouer", "Play again"],
    ["Retour au menu", "Back to menu"],
    ["Comment jouer", "How to play"],
    ["Règles de Bingo réversible", "Reversible Bingo rules"],
    ["But", "Goal"],
    ["Les tuiles", "Tiles"],
    ["Déroulement", "How a round works"],
    ["Protection", "Protection"],
    ["CPU basique", "Basic CPU"],
    ["CPU probabiliste", "Probabilistic CPU"],
    ["CPU contre CPU", "CPU vs CPU"],
    ["Fin de manche", "End of round"],
    ["Chaque joueur reçoit secrètement une couleur parmi rouge, jaune et bleu. Alignez quatre centres de votre couleur horizontalement, verticalement ou sur une grande diagonale.", "Each player secretly receives red, yellow or blue. Align four centers of your color horizontally, vertically or along a long diagonal."],
    ["Chaque joueur possède trois exemplaires de chacune des trois tuiles réversibles : rouge/bleu, jaune/rouge et bleu/jaune. Vous choisissez librement la face visible au moment de la pose.", "Each player has three copies of each reversible tile: red/blue, yellow/red and blue/yellow. You freely choose the visible side when placing it."],
    ["Tant qu’il reste plus de deux cases libres, poser une tuile est obligatoire. Dès qu’il ne reste que deux cases libres, vous pouvez à chaque tour poser, retourner ou déplacer une tuile d’une case horizontalement ou verticalement vers une case vide.", "While more than two squares are empty, placing a tile is mandatory. Once exactly two squares are empty, each turn may place, flip, or move a tile one square horizontally or vertically into an empty square."],
    ["La tuile utilisée au coup précédent ne peut être ni retournée ni déplacée par l’adversaire. Elle redevient disponible au tour suivant.", "The tile used on the previous move cannot be flipped or moved by the opponent. It becomes available again on the following turn."],
    ["Le CPU basique cherche les victoires immédiates, bloque en priorité les gains adverses au coup suivant et évalue ensuite les lignes prometteuses.", "The Basic CPU looks for immediate wins, prioritizes blocking an opponent win on the next move, then evaluates promising lines."],
    ["Le CPU probabiliste ne connaît que sa propre couleur. Il tente de déduire celle de son adversaire, puis utilise alpha-bêta et Monte-Carlo. Avant cette recherche, il applique obligatoirement le filtre défensif du CPU basique. Il analyse jusqu’à 56 secondes et joue au plus tard à 58 secondes.", "The Probabilistic CPU knows only its own color. It tries to infer its opponent's color, then uses alpha-beta and Monte Carlo. Before that search, it must apply the Basic CPU's defensive filter. It analyzes for up to 56 seconds and plays no later than 58 seconds."],
    ["Vous pouvez choisir séparément Basique ou Probabiliste pour chacun des deux CPU. Chaque CPU ne connaît que sa propre couleur.", "You can independently choose Basic or Probabilistic for each CPU. Each CPU knows only its own color."],
    ["Une manche est nulle après trois répétitions de la même position complète ou si personne ne gagne au 50e coup. Avec les chronomètres activés, dépasser une minute pour un coup ou épuiser ses trente minutes fait perdre la manche.", "A round is drawn after the same complete position occurs three times, or if nobody wins by move 50. With timers enabled, exceeding one minute for a move or using all thirty minutes loses the round."],
    ["Enchaîner automatiquement les manches", "Automatically continue rounds"],
    ["Après une fin de manche, lance la suivante au bout de 30 secondes. L'écran final du BO reste affiché.", "After a round ends, starts the next one after 30 seconds. The final match screen remains open."],
    ["Manche en cours", "Current round"],
    ["Journal des coups", "Move log"],
    ["Aucun coup joué.", "No moves played."],
    ["Choisissez une tuile, puis une case vide.", "Choose a tile, then an empty square."],
    ["Touchez une tuile non protégée pour la retourner.", "Tap an unprotected tile to flip it."],
    ["Choisissez une tuile non protégée à déplacer.", "Choose an unprotected tile to move."],
    ["Choisissez une case vide adjacente, ou retouchez la tuile pour annuler.", "Choose an adjacent empty square, or tap the tile again to cancel."],
    ["Le CPU choisit son coup…", "The CPU is choosing its move…"],
    ["Le CPU basique choisit son coup…", "The Basic CPU is choosing its move…"],
    ["Le CPU réfléchit…", "The CPU is thinking…"],
    ["Pose obligatoire", "Placement required"],
    ["Pose, retournement ou déplacement", "Place, flip or move"],
    ["CPU probabiliste · contrôle défensif…", "Probabilistic CPU · defensive check…"],
    ["Aucun coup légal n’est disponible.", "No legal move is available."],
    ["Enchaîner automatiquement les manches", "Automatically continue rounds"]
  ];

  const frToEn = new Map(exactPairs);
  const enToFr = new Map(exactPairs.map(([fr, en]) => [en, fr]));

  const colorLabels = {
    fr: { red: "Rouge", blue: "Bleu", yellow: "Jaune" },
    en: { red: "Red", blue: "Blue", yellow: "Yellow" }
  };

  const tileLabels = {
    fr: { rb: "Rouge / Bleu", yr: "Jaune / Rouge", by: "Bleu / Jaune" },
    en: { rb: "Red / Blue", yr: "Yellow / Red", by: "Blue / Yellow" }
  };

  function nameFrToEn(name) {
    return name
      .replace(/^Joueur ([12])$/, "Player $1")
      .replace(/^CPU basique ([12])$/, "Basic CPU $1")
      .replace(/^CPU probabiliste ([12])$/, "Probabilistic CPU $1")
      .replace(/^CPU probabiliste$/, "Probabilistic CPU");
  }

  function nameEnToFr(name) {
    return name
      .replace(/^Player ([12])$/, "Joueur $1")
      .replace(/^Basic CPU ([12])$/, "CPU basique $1")
      .replace(/^Probabilistic CPU ([12])$/, "CPU probabiliste $1")
      .replace(/^Probabilistic CPU$/, "CPU probabiliste");
  }

  function translateDynamicFrToEn(text) {
    let match;
    if ((match = text.match(/^Joueur ([12])$/))) return `Player ${match[1]}`;
    if ((match = text.match(/^CPU basique ([12])$/))) return `Basic CPU ${match[1]}`;
    if ((match = text.match(/^CPU probabiliste ([12])$/))) return `Probabilistic CPU ${match[1]}`;
    if ((match = text.match(/^Manche (\d+) · Couleur secrète$/))) return `Round ${match[1]} · Secret color`;
    if ((match = text.match(/^Manche (\d+)$/))) return `Round ${match[1]}`;
    if ((match = text.match(/^Coup (\d+) \/ 50$/))) return `Move ${match[1]} / 50`;
    if ((match = text.match(/^Tour du joueur ([12])$/))) return `Player ${match[1]}'s turn`;
    if ((match = text.match(/^Tour de (.+)$/))) return `${nameFrToEn(match[1])}'s turn`;
    if ((match = text.match(/^(\d+) cases? libres?$/))) return `${match[1]} empty square${match[1] === "1" ? "" : "s"}`;
    if ((match = text.match(/^(.+), regarde seul l’écran$/))) return `${nameFrToEn(match[1])}, look at the screen alone`;
    if ((match = text.match(/^Révèle ta couleur\. Celle du (.+) restera secrète jusqu’à la fin de la manche\.$/))) return `Reveal your color. ${nameFrToEn(match[1])}'s color will remain secret until the end of the round.`;
    if ((match = text.match(/^Révèle ta couleur\. Celle du (.+) reste secrète\.$/))) return `Reveal your color. ${nameFrToEn(match[1])}'s color remains secret.`;
    if ((match = text.match(/^(.+) remporte la manche !$/))) return `${nameFrToEn(match[1])} wins the round!`;
    if ((match = text.match(/^(.+) remporte la partie !$/))) return `${nameFrToEn(match[1])} wins the match!`;
    if ((match = text.match(/^Quatre centres (rouges|bleus|jaunes) sont alignés\.$/))) {
      const colors = { rouges: "red", bleus: "blue", jaunes: "yellow" };
      return `Four ${colors[match[1]]} centers are aligned.`;
    }
    if ((match = text.match(/^Manche suivante automatique dans (\d+) secondes?\.$/))) return `Next round starts automatically in ${match[1]} second${match[1] === "1" ? "" : "s"}.`;
    if ((match = text.match(/^CPU probabiliste · Monte-Carlo · (.+) simulations · (.+) s$/))) return `Probabilistic CPU · Monte Carlo · ${match[1]} simulations · ${match[2]} s`;
    if ((match = text.match(/^CPU probabiliste · alpha-bêta · profondeur (\d+) · (.+) s$/))) return `Probabilistic CPU · alpha-beta · depth ${match[1]} · ${match[2]} s`;
    if ((match = text.match(/^Analyse forte · profondeur (\d+) · (.+) s$/))) return `Deep analysis · depth ${match[1]} · ${match[2]} s`;
    if ((match = text.match(/^(Rouge|Bleu|Jaune) visible$/))) {
      const colors = { Rouge: "Red", Bleu: "Blue", Jaune: "Yellow" };
      return `${colors[match[1]]} visible`;
    }
    if ((match = text.match(/^(• Pose|↻ Retournement|[↑↓←→] Déplacement) · (Rouge|Bleu|Jaune), bord (rouge|bleu|jaune)$/))) {
      const actions = { "• Pose": "• Place", "↻ Retournement": "↻ Flip", "↑ Déplacement": "↑ Move", "↓ Déplacement": "↓ Move", "← Déplacement": "← Move", "→ Déplacement": "→ Move" };
      const colors = { Rouge: "Red", Bleu: "Blue", Jaune: "Yellow", rouge: "red", bleu: "blue", jaune: "yellow" };
      return `${actions[match[1]]} · ${colors[match[2]]}, ${colors[match[3]]} border`;
    }
    if ((match = text.match(/^(.+) a dépassé une minute pour son coup\.$/))) return `${nameFrToEn(match[1])} exceeded one minute for the move.`;
    if ((match = text.match(/^(.+) a épuisé ses trente minutes\.$/))) return `${nameFrToEn(match[1])} used all thirty minutes.`;
    return text;
  }

  function translateDynamicEnToFr(text) {
    let match;
    if ((match = text.match(/^Player ([12])$/))) return `Joueur ${match[1]}`;
    if ((match = text.match(/^Basic CPU ([12])$/))) return `CPU basique ${match[1]}`;
    if ((match = text.match(/^Probabilistic CPU ([12])$/))) return `CPU probabiliste ${match[1]}`;
    if ((match = text.match(/^Round (\d+) · Secret color$/))) return `Manche ${match[1]} · Couleur secrète`;
    if ((match = text.match(/^Round (\d+)$/))) return `Manche ${match[1]}`;
    if ((match = text.match(/^Move (\d+) \/ 50$/))) return `Coup ${match[1]} / 50`;
    if ((match = text.match(/^Player ([12])'s turn$/))) return `Tour du joueur ${match[1]}`;
    if ((match = text.match(/^(.+)'s turn$/))) return `Tour de ${nameEnToFr(match[1])}`;
    if ((match = text.match(/^(\d+) empty squares?$/))) return `${match[1]} case${match[1] === "1" ? "" : "s"} libre${match[1] === "1" ? "" : "s"}`;
    if ((match = text.match(/^(.+), look at the screen alone$/))) return `${nameEnToFr(match[1])}, regarde seul l’écran`;
    if ((match = text.match(/^Reveal your color\. (.+)'s color will remain secret until the end of the round\.$/))) return `Révèle ta couleur. Celle du ${nameEnToFr(match[1])} restera secrète jusqu’à la fin de la manche.`;
    if ((match = text.match(/^Reveal your color\. (.+)'s color remains secret\.$/))) return `Révèle ta couleur. Celle du ${nameEnToFr(match[1])} reste secrète.`;
    if ((match = text.match(/^(.+) wins the round!$/))) return `${nameEnToFr(match[1])} remporte la manche !`;
    if ((match = text.match(/^(.+) wins the match!$/))) return `${nameEnToFr(match[1])} remporte la partie !`;
    if ((match = text.match(/^Four (red|blue|yellow) centers are aligned\.$/))) {
      const colors = { red: "rouges", blue: "bleus", yellow: "jaunes" };
      return `Quatre centres ${colors[match[1]]} sont alignés.`;
    }
    if ((match = text.match(/^Next round starts automatically in (\d+) seconds?\.$/))) return `Manche suivante automatique dans ${match[1]} seconde${match[1] === "1" ? "" : "s"}.`;
    if ((match = text.match(/^Probabilistic CPU · Monte Carlo · (.+) simulations · (.+) s$/))) return `CPU probabiliste · Monte-Carlo · ${match[1]} simulations · ${match[2]} s`;
    if ((match = text.match(/^Probabilistic CPU · alpha-beta · depth (\d+) · (.+) s$/))) return `CPU probabiliste · alpha-bêta · profondeur ${match[1]} · ${match[2]} s`;
    if ((match = text.match(/^Deep analysis · depth (\d+) · (.+) s$/))) return `Analyse forte · profondeur ${match[1]} · ${match[2]} s`;
    if ((match = text.match(/^(Red|Blue|Yellow) visible$/))) {
      const colors = { Red: "Rouge", Blue: "Bleu", Yellow: "Jaune" };
      return `${colors[match[1]]} visible`;
    }
    if ((match = text.match(/^(• Place|↻ Flip|[↑↓←→] Move) · (Red|Blue|Yellow), (red|blue|yellow) border$/))) {
      const actions = { "• Place": "• Pose", "↻ Flip": "↻ Retournement", "↑ Move": "↑ Déplacement", "↓ Move": "↓ Déplacement", "← Move": "← Déplacement", "→ Move": "→ Déplacement" };
      const colors = { Red: "Rouge", Blue: "Bleu", Yellow: "Jaune", red: "rouge", blue: "bleu", yellow: "jaune" };
      return `${actions[match[1]]} · ${colors[match[2]]}, bord ${colors[match[3]]}`;
    }
    if ((match = text.match(/^(.+) exceeded one minute for the move\.$/))) return `${nameEnToFr(match[1])} a dépassé une minute pour son coup.`;
    if ((match = text.match(/^(.+) used all thirty minutes\.$/))) return `${nameEnToFr(match[1])} a épuisé ses trente minutes.`;
    return text;
  }

  function translateCore(text, targetLanguage) {
    const exact = targetLanguage === "en" ? frToEn.get(text) : enToFr.get(text);
    if (exact) return exact;
    return targetLanguage === "en" ? translateDynamicFrToEn(text) : translateDynamicEnToFr(text);
  }

  function translateText(text, targetLanguage) {
    if (!text || !text.trim()) return text;
    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    const core = text.slice(leading.length, text.length - trailing.length || undefined);
    return `${leading}${translateCore(core, targetLanguage)}${trailing}`;
  }

  function shouldSkip(element) {
    return !element || Boolean(element.closest("script, style, noscript, code, pre, [data-no-i18n]"));
  }

  function localizeTextNode(node) {
    if (!node || shouldSkip(node.parentElement)) return;
    const translated = translateText(node.nodeValue, currentLanguage);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }

  function localizeAttributes(element) {
    if (!element || shouldSkip(element)) return;
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const translated = translateCore(value, currentLanguage);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }

  function localizeTree(root = document.body) {
    if (!root) return;
    translating = true;
    try {
      if (root.nodeType === Node.TEXT_NODE) {
        localizeTextNode(root);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
      if (root.nodeType === Node.ELEMENT_NODE) localizeAttributes(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
        else localizeAttributes(node);
      }
    } finally {
      translating = false;
    }
  }

  function updateModelLabels() {
    for (const color of Object.keys(colorLabels[currentLanguage])) {
      COLORS[color].label = colorLabels[currentLanguage][color];
    }
    for (const type of Object.keys(tileLabels[currentLanguage])) {
      TILE_TYPES[type].label = tileLabels[currentLanguage][type];
    }
  }

  function installLanguageSwitch() {
    if (document.querySelector("#languageSwitch")) return;
    const topbar = document.querySelector(".topbar");
    const rulesButton = document.querySelector("#rulesBtn");
    if (!topbar || !rulesButton) return;

    const actions = document.createElement("div");
    actions.className = "topbar-actions";
    const languageSwitch = document.createElement("div");
    languageSwitch.id = "languageSwitch";
    languageSwitch.className = "language-switch";
    languageSwitch.setAttribute("role", "group");
    languageSwitch.setAttribute("aria-label", "Choisir la langue");
    languageSwitch.setAttribute("data-no-i18n", "true");
    languageSwitch.innerHTML = `
      <button type="button" data-language="fr" aria-label="Français">FR</button>
      <button type="button" data-language="en" aria-label="English">EN</button>
    `;

    topbar.appendChild(actions);
    actions.appendChild(languageSwitch);
    actions.appendChild(rulesButton);

    languageSwitch.addEventListener("click", event => {
      const button = event.target.closest("button[data-language]");
      if (button) setLanguage(button.dataset.language);
    });
  }

  function installQuickRulesOverlay() {
    if (document.querySelector("#quickRulesOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "quickRulesOverlay";
    overlay.className = "overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "quickRulesTitle");
    overlay.setAttribute("data-no-i18n", "true");
    overlay.innerHTML = `
      <div class="modal quick-rules-modal">
        <p id="quickRulesKicker" class="eyebrow"></p>
        <h2 id="quickRulesTitle"></h2>
        <div class="quick-rules-steps">
          <article>
            <span class="quick-step-number">1</span>
            <div><strong id="quickPlacementTitle"></strong><p id="quickPlacementText"></p></div>
          </article>
          <article class="special-step">
            <span class="quick-step-number">2</span>
            <div><strong id="quickSpecialTitle"></strong><p id="quickSpecialText"></p></div>
          </article>
        </div>
        <p id="quickRulesWarning" class="quick-rules-warning"></p>
        <p id="quickRulesNote" class="quick-rules-note"></p>
        <button id="quickRulesContinue" class="primary-button" type="button"></button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.querySelector("#quickRulesContinue")?.addEventListener("click", continueAfterQuickRules);
  }

  function renderQuickRules() {
    const english = currentLanguage === "en";
    const content = english ? {
      kicker: "Quick reminder",
      title: "When can tiles be flipped or moved?",
      placementTitle: "Placement phase",
      placementText: "While more than 2 squares are empty, every turn must place a tile.",
      specialTitle: "Flip and move phase",
      specialText: "Only when exactly 2 empty squares remain do the Flip and Move actions become available.",
      warning: "Until then, those two buttons are intentionally disabled.",
      note: "The tile used on the previous move is protected during the opponent's turn. Your goal is to align 4 centers of your secret color.",
      button: "Got it — continue"
    } : {
      kicker: "Rappel express",
      title: "Quand peut-on retourner ou déplacer ?",
      placementTitle: "Phase de pose",
      placementText: "Tant qu’il reste plus de 2 cases libres, chaque tour doit obligatoirement poser une tuile.",
      specialTitle: "Phase de retournement et déplacement",
      specialText: "Uniquement lorsqu’il reste exactement 2 cases libres, les actions Retourner et Déplacer deviennent disponibles.",
      warning: "Jusque-là, ces deux boutons restent volontairement désactivés.",
      note: "La tuile utilisée au coup précédent est protégée pendant le tour adverse. Le but est d’aligner 4 centres de votre couleur secrète.",
      button: "J’ai compris — continuer"
    };

    const assign = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    assign("#quickRulesKicker", content.kicker);
    assign("#quickRulesTitle", content.title);
    assign("#quickPlacementTitle", content.placementTitle);
    assign("#quickPlacementText", content.placementText);
    assign("#quickSpecialTitle", content.specialTitle);
    assign("#quickSpecialText", content.specialText);
    assign("#quickRulesWarning", content.warning);
    assign("#quickRulesNote", content.note);
    assign("#quickRulesContinue", content.button);
  }

  function showQuickRules() {
    renderQuickRules();
    document.querySelector("#quickRulesOverlay")?.classList.remove("hidden");
  }

  function hideQuickRules() {
    document.querySelector("#quickRulesOverlay")?.classList.add("hidden");
  }

  const baseBeginColorRevealV6 = beginColorReveal;
  beginColorReveal = function beginColorRevealV6() {
    if (introPending) {
      introPending = false;
      showQuickRules();
      return;
    }
    baseBeginColorRevealV6();
  };

  function continueAfterQuickRules() {
    hideQuickRules();
    baseBeginColorRevealV6();
  }

  function setLanguage(language) {
    if (!SUPPORTED_LANGUAGES.has(language)) return;
    currentLanguage = language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = language === "en" ? "Reversible Bingo" : "Bingo réversible";
    updateModelLabels();

    document.querySelectorAll("#languageSwitch button[data-language]").forEach(button => {
      const active = button.dataset.language === language;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (typeof renderAll === "function") renderAll();
    renderQuickRules();
    localizeTree(document.body);
  }

  installLanguageSwitch();
  installQuickRulesOverlay();

  els.setupForm.addEventListener("submit", () => {
    introPending = true;
    hideQuickRules();
  }, true);

  els.nextRoundBtn.addEventListener("click", () => {
    if (els.nextRoundBtn.dataset.matchOver === "true") introPending = true;
    hideQuickRules();
  }, true);

  els.backToMenuBtn.addEventListener("click", hideQuickRules, true);
  els.quitBtn.addEventListener("click", hideQuickRules, true);

  const observer = new MutationObserver(records => {
    if (translating) return;
    for (const record of records) {
      if (record.type === "characterData") localizeTextNode(record.target);
      if (record.type === "attributes") localizeAttributes(record.target);
      for (const node of record.addedNodes || []) localizeTree(node);
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder"]
  });

  setLanguage(currentLanguage);
})();