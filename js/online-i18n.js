"use strict";

(() => {
  const STORAGE_KEY = "bingo-reversible-language";
  const SUPPORTED = new Set(["fr", "en"]);
  let language = SUPPORTED.has(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : "fr";
  let translating = false;

  const pairs = [
    ["Salon privé à deux joueurs", "Private two-player room"],
    ["Bingo réversible : Online", "Reversible Bingo: Online"],
    ["Choisir la langue", "Choose language"],
    ["Afficher les règles", "Show rules"],
    ["Règles", "Rules"],
    ["Première fondation", "First setup"],
    ["Créer ou rejoindre une partie", "Create or join a game"],
    ["Le créateur devient toujours le joueur 1 avec la pastille blanche. La personne invitée devient le joueur 2 avec la pastille noire.", "The host is always player 1 with the white marker. The guest is player 2 with the black marker."],
    ["Créer un salon", "Create a room"],
    ["Format", "Format"],
    ["1 manche", "1 round"],
    ["Délai de reconnexion", "Reconnection window"],
    ["45 secondes", "45 seconds"],
    ["Partie chronométrée", "Timed match"],
    ["Mode débogage", "Debug mode"],
    ["Créer le salon", "Create room"],
    ["ou", "or"],
    ["Rejoindre un salon", "Join a room"],
    ["Code d’invitation", "Invitation code"],
    ["Rejoindre", "Join"],
    ["Configuration requise", "Configuration required"],
    ["État du service", "Service status"],
    ["La structure est prête. Ajoutez la Project URL et la clé publishable de Supabase dans js/online-config.js.", "The structure is ready. Add the Supabase Project URL and publishable key in js/online-config.js."],
    ["Salon actif", "Active room"],
    ["Code à partager", "Code to share"],
    ["Copier le lien d’invitation", "Copy invitation link"],
    ["La partie commence dans", "The game starts in"],
    ["secondes", "seconds"],
    ["Je suis prêt", "I’m ready"],
    ["Je ne suis plus prêt", "I’m no longer ready"],
    ["Le décompte démarre lorsque les deux joueurs sont prêts. Il s’annule si l’un d’eux change d’avis ou se déconnecte.", "The countdown starts when both players are ready. It is cancelled if either player changes their mind or disconnects."],
    ["Partie Online", "Online game"],
    ["Connexion au plateau en tant que joueur…", "Connecting to the board as a player…"],
    ["Synchronisé", "Synchronized"],
    ["Adversaire connecté", "Opponent connected"],
    ["Joueur 1 · Créateur", "Player 1 · Host"],
    ["Joueur 2 · Invité", "Player 2 · Guest"],
    ["Manches", "Rounds"],
    ["Chargement du tour…", "Loading turn…"],
    ["Synchronisation du plateau", "Synchronizing board"],
    ["Ce coup", "This move"],
    ["Votre couleur secrète", "Your secret color"],
    ["Elle n’est jamais transmise à votre adversaire pendant la manche.", "It is never sent to your opponent during the round."],
    ["Chargement du plateau…", "Loading board…"],
    ["Action", "Action"],
    ["Poser", "Place"],
    ["Retourner", "Flip"],
    ["Déplacer", "Move"],
    ["Votre réserve", "Your reserve"],
    ["Touchez une tuile pour la choisir. Touchez-la à nouveau pour changer de face.", "Tap a tile to select it. Tap it again to change its visible side."],
    ["Protégée pendant ce tour", "Protected this turn"],
    ["Seule la couleur centrale compte", "Only the center color counts"],
    ["Chronomètres", "Timers"],
    ["Activés", "Enabled"],
    ["Désactivés", "Disabled"],
    ["Abandonner la partie", "Forfeit round"],
    ["Abandonner le BO", "Forfeit series"],
    ["Fin de la manche", "End of round"],
    ["Fin du BO", "End of series"],
    ["Résultat", "Result"],
    ["Manche suivante dans", "Next round starts in"],
    ["Prêt pour la manche suivante", "Ready for the next round"],
    ["Retour à l’accueil Online", "Back to Online home"],
    ["Comment jouer", "How to play"],
    ["Règles de Bingo réversible", "Reversible Bingo rules"],
    ["Fermer", "Close"],
    ["But", "Goal"],
    ["Les tuiles", "Tiles"],
    ["Déroulement", "How a round works"],
    ["Protection", "Protection"],
    ["Mode Online", "Online mode"],
    ["Déconnexion et abandon", "Disconnection and forfeiting"],
    ["Fin de manche", "End of round"],
    ["Chaque joueur reçoit secrètement une couleur parmi rouge, jaune et bleu. Alignez quatre centres de votre couleur horizontalement, verticalement ou sur une grande diagonale.", "Each player secretly receives red, yellow or blue. Align four centers of your color horizontally, vertically or along a long diagonal."],
    ["Chaque joueur possède trois exemplaires de chacune des trois tuiles réversibles : rouge/bleu, jaune/rouge et bleu/jaune. Vous choisissez librement la face visible au moment de la pose.", "Each player has three copies of each reversible tile: red/blue, yellow/red and blue/yellow. You freely choose the visible side when placing it."],
    ["Tant qu’il reste plus de deux cases libres, poser une tuile est obligatoire. Dès qu’il ne reste que deux cases libres, vous pouvez à chaque tour poser, retourner ou déplacer une tuile d’une case horizontalement ou verticalement vers une case vide.", "While more than two squares are empty, placing a tile is mandatory. Once exactly two squares are empty, each turn may place, flip, or move a tile one square horizontally or vertically into an empty square."],
    ["La tuile utilisée au coup précédent ne peut être ni retournée ni déplacée par l’adversaire. Elle redevient disponible au tour suivant.", "The tile used on the previous move cannot be flipped or moved by the opponent. It becomes available again on the following turn."],
    ["Le serveur valide chaque coup et ne transmet à chaque joueur que sa propre couleur secrète. Après une manche, les deux joueurs doivent être prêts avant le décompte synchronisé de cinq secondes.", "The server validates every move and sends each player only their own secret color. After a round, both players must be ready before the synchronized five-second countdown."],
    ["Une déconnexion laisse 45 secondes pour revenir avant de perdre la manche. « Abandonner la partie » concède la manche en cours ; « Abandonner le BO » concède toute la série.", "After disconnecting, a player has 45 seconds to return before losing the round. “Forfeit round” concedes the current round; “Forfeit series” concedes the entire series."],
    ["Une manche est nulle après trois répétitions de la même position complète ou si personne ne gagne au 50e coup. Avec les chronomètres activés, dépasser une minute pour un coup ou épuiser ses trente minutes fait perdre la manche.", "A round is drawn after the same complete position occurs three times, or if nobody wins by move 50. With timers enabled, exceeding one minute for a move or using all thirty minutes loses the round."],
    ["Rouge", "Red"],
    ["Bleu", "Blue"],
    ["Jaune", "Yellow"],
    ["Rouge / Bleu", "Red / Blue"],
    ["Jaune / Rouge", "Yellow / Red"],
    ["Bleu / Jaune", "Blue / Yellow"],
    ["Pose obligatoire", "Placement required"],
    ["Poser, retourner ou déplacer", "Place, flip or move"],
    ["À vous de jouer", "Your turn"],
    ["En attente du coup adverse…", "Waiting for the opponent’s move…"],
    ["Choisissez une tuile, puis une case vide.", "Choose a tile, then an empty square."],
    ["Touchez une tuile non protégée pour la retourner.", "Tap an unprotected tile to flip it."],
    ["Choisissez une tuile non protégée à déplacer.", "Choose an unprotected tile to move."],
    ["Choisissez une case vide adjacente, ou retouchez la tuile pour annuler.", "Choose an adjacent empty square, or tap the tile again to cancel."],
    ["La manche est terminée.", "The round is over."],
    ["Manche terminée", "Round over"],
    ["BO terminé", "Series over"],
    ["Résultat synchronisé", "Synchronized result"],
    ["Manche nulle", "Drawn round"],
    ["Score final", "Final score"],
    ["Score du BO", "Series score"],
    ["Les deux joueurs doivent confirmer.", "Both players must confirm."],
    ["Les deux joueurs sont prêts.", "Both players are ready."],
    ["La série est terminée.", "The series is over."],
    ["Résultat enregistré par le serveur.", "Result recorded by the server."],
    ["Salon créé. Partagez le code ou le lien.", "Room created. Share the code or link."],
    ["Salon rejoint.", "Room joined."],
    ["Lien d’invitation copié.", "Invitation link copied."],
    ["Les deux joueurs sont prêts. La partie va commencer.", "Both players are ready. The game is about to start."],
    ["Le décompte est annulé. Les deux joueurs doivent être prêts.", "The countdown is cancelled. Both players must be ready."],
    ["Identité anonyme créée. Vous pouvez créer ou rejoindre un salon privé.", "Anonymous identity created. You can create or join a private room."],
    ["Authentification anonyme en cours. Aucun compte ni e-mail n’est demandé aux joueurs.", "Anonymous authentication in progress. Players do not need an account or email."],
    ["Service en ligne", "Service online"],
    ["Connecté au salon", "Connected to room"],
    ["Connexion instable", "Unstable connection"],
    ["Synchronisation instable", "Unstable synchronization"]
  ];

  const frToEn = new Map(pairs);
  const enToFr = new Map(pairs.map(([fr, en]) => [en, fr]));

  function translateDynamic(text, target) {
    let match;
    if (target === "en") {
      if ((match = text.match(/^Manche (\d+)$/))) return `Round ${match[1]}`;
      if ((match = text.match(/^Coup (\d+) \/ 50$/))) return `Move ${match[1]} / 50`;
      if ((match = text.match(/^Tour du joueur (\d+)$/))) return `Player ${match[1]}’s turn`;
      if ((match = text.match(/^(\d+) cases? libres?$/))) return `${match[1]} empty square${match[1] === "1" ? "" : "s"}`;
      if ((match = text.match(/^Joueur (\d+)$/))) return `Player ${match[1]}`;
      if ((match = text.match(/^Joueur (\d+) prêt · en attente de l’autre joueur\.$/))) return `Player ${match[1]} ready · waiting for the other player.`;
      if ((match = text.match(/^Le joueur (\d+) gagne la manche !$/))) return `Player ${match[1]} wins the round!`;
      if ((match = text.match(/^Le joueur (\d+) gagne le BO !$/))) return `Player ${match[1]} wins the series!`;
      if ((match = text.match(/^Vous êtes le joueur (\d+) \(pastille (blanche|noire)\)\.$/))) return `You are player ${match[1]} (${match[2] === "blanche" ? "white" : "black"} marker).`;
      if ((match = text.match(/^Reconnexion adverse · (\d+)s$/))) return `Opponent reconnecting · ${match[1]}s`;
      if ((match = text.match(/^(.+) visible$/)) && frToEn.has(match[1])) return `${frToEn.get(match[1])} visible`;
      if (text.includes(" · ")) return text.split(" · ").map(part => ({
        "Vous": "You", "Prêt": "Ready", "Pas encore prêt": "Not ready yet", "connecté": "connected", "reconnexion": "reconnecting"
      })[part] || frToEn.get(part) || part).join(" · ");
    } else {
      if ((match = text.match(/^Round (\d+)$/))) return `Manche ${match[1]}`;
      if ((match = text.match(/^Move (\d+) \/ 50$/))) return `Coup ${match[1]} / 50`;
      if ((match = text.match(/^Player (\d+)’s turn$/))) return `Tour du joueur ${match[1]}`;
      if ((match = text.match(/^(\d+) empty squares?$/))) return `${match[1]} case${match[1] === "1" ? "" : "s"} libre${match[1] === "1" ? "" : "s"}`;
      if ((match = text.match(/^Player (\d+)$/))) return `Joueur ${match[1]}`;
      if ((match = text.match(/^Player (\d+) ready · waiting for the other player\.$/))) return `Joueur ${match[1]} prêt · en attente de l’autre joueur.`;
      if ((match = text.match(/^Player (\d+) wins the round!$/))) return `Le joueur ${match[1]} gagne la manche !`;
      if ((match = text.match(/^Player (\d+) wins the series!$/))) return `Le joueur ${match[1]} gagne le BO !`;
      if ((match = text.match(/^You are player (\d+) \((white|black) marker\)\.$/))) return `Vous êtes le joueur ${match[1]} (pastille ${match[2] === "white" ? "blanche" : "noire"}).`;
      if ((match = text.match(/^Opponent reconnecting · (\d+)s$/))) return `Reconnexion adverse · ${match[1]}s`;
      if ((match = text.match(/^(.+) visible$/)) && enToFr.has(match[1])) return `${enToFr.get(match[1])} visible`;
      if (text.includes(" · ")) return text.split(" · ").map(part => ({
        "You": "Vous", "Ready": "Prêt", "Not ready yet": "Pas encore prêt", "connected": "connecté", "reconnecting": "reconnexion"
      })[part] || enToFr.get(part) || part).join(" · ");
    }
    return text;
  }

  function translate(text, target = language) {
    const exact = target === "en" ? frToEn.get(text) : enToFr.get(text);
    return exact || translateDynamic(text, target);
  }

  function skip(element) {
    return !element || Boolean(element.closest("script, style, noscript, code, pre, [data-no-i18n]"));
  }

  function localizeTextNode(node) {
    if (!node?.nodeValue || skip(node.parentElement)) return;
    const leading = node.nodeValue.match(/^\s*/)?.[0] || "";
    const trailing = node.nodeValue.match(/\s*$/)?.[0] || "";
    const core = node.nodeValue.slice(leading.length, node.nodeValue.length - trailing.length || undefined);
    const localized = translate(core);
    if (localized !== core) node.nodeValue = `${leading}${localized}${trailing}`;
  }

  function localizeElement(element) {
    if (!element || skip(element)) return;
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const localized = translate(value);
      if (localized !== value) element.setAttribute(attribute, localized);
    }
  }

  function localizeTree(root = document.body) {
    if (!root || translating) return;
    translating = true;
    try {
      if (root.nodeType === Node.TEXT_NODE) return localizeTextNode(root);
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
      if (root.nodeType === Node.ELEMENT_NODE) localizeElement(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
        else localizeElement(node);
      }
    } finally {
      translating = false;
    }
  }

  function setLanguage(nextLanguage) {
    if (!SUPPORTED.has(nextLanguage)) return;
    language = nextLanguage;
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = language === "en" ? "Reversible Bingo: Online" : "Bingo réversible : Online";
    document.querySelectorAll("#onlineLanguageSwitch button[data-language]").forEach(button => {
      const active = button.dataset.language === language;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    localizeTree(document.body);
  }

  const rulesOverlay = document.querySelector("#onlineRulesOverlay");
  const openRules = () => rulesOverlay?.classList.remove("online-hidden");
  const closeRules = () => rulesOverlay?.classList.add("online-hidden");

  document.querySelector("#onlineLanguageSwitch")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-language]");
    if (button) setLanguage(button.dataset.language);
  });
  document.querySelector("#onlineRulesButton")?.addEventListener("click", openRules);
  document.querySelector("#onlineRulesCloseButton")?.addEventListener("click", closeRules);
  rulesOverlay?.addEventListener("click", event => { if (event.target === rulesOverlay) closeRules(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeRules(); });

  const observer = new MutationObserver(mutations => {
    if (translating) return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") localizeTextNode(mutation.target);
      mutation.addedNodes.forEach(localizeTree);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.BINGO_ONLINE_I18N = { setLanguage, getLanguage: () => language, translate };
  setLanguage(language);
})();
