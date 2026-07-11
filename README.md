# Bingo réversible

Jeu de stratégie sur navigateur, jouable à deux en local, contre un CPU basique ou contre un Strong CPU, sur un plateau 4 × 4.

## Jouer

Le site est conçu pour GitHub Pages et fonctionne sur ordinateur comme sur smartphone.

Adresse : `https://seb16120.github.io/bingo-reversible/`

## Modes

- **2 joueurs** : les deux couleurs secrètes sont révélées séparément sur le même appareil.
- **Vs. CPU** : le joueur humain est le joueur 1. Le CPU garde sa couleur secrète et joue automatiquement.
- **Vs. Strong CPU** : le CPU estime progressivement la couleur du joueur humain à partir de ses coups, puis lance une recherche approfondie dans un Web Worker.
- Le CPU basique ne joue pas au hasard : il cherche les victoires immédiates, évite de donner un alignement, limite les menaces au coup suivant et favorise les lignes prometteuses.
- Le Strong CPU combine recherche itérative, minimax, élagage alpha-bêta, table de transposition, symétries du plateau et prudence variable selon sa confiance sur la couleur adverse.
- Aucun CPU ne lit la couleur secrète réelle du joueur humain.
- Le Strong CPU dispose d’un budget interne de 48 secondes et d’un arrêt forcé à 50 secondes, mais joue immédiatement s’il démontre une victoire forcée plus tôt.

## Règles principales

- Chaque joueur reçoit une couleur secrète différente à chaque manche.
- Le but est d’aligner quatre centres de sa couleur horizontalement, verticalement ou en diagonale.
- Chaque joueur possède 3 exemplaires de chaque tuile réversible :
  - rouge encadré de bleu ↔ bleu encadré de rouge ;
  - jaune encadré de rouge ↔ rouge encadré de jaune ;
  - bleu encadré de jaune ↔ jaune encadré de bleu.
- Tant qu’il reste plus de deux cases libres, la pose est obligatoire.
- À partir de deux cases libres, le joueur peut poser, retourner ou déplacer orthogonalement une tuile vers une case vide.
- La tuile utilisée au coup précédent est protégée pendant le tour adverse.
- Une manche est nulle après trois répétitions de la même position complète ou après 50 coups sans gagnant.
- Chronomètres facultatifs : 1 minute par coup et 30 minutes par joueur, réinitialisées à chaque manche. Une pendule épuisée fait perdre la manche.

## Développement local

Aucune installation n’est nécessaire. Ouvrir simplement `index.html` dans un navigateur moderne. Le mode Strong CPU nécessite un navigateur autorisant les Web Workers ; en cas d’échec, le jeu revient automatiquement au CPU basique.

## Fichiers

- `index.html` : structure, menu et écrans du jeu ;
- `styles.css`, `tile-fix.css`, `mode-cpu.css` et `result-score.css` : interface, tuiles et adaptation mobile ;
- `js/config.js` : couleurs, tuiles, éléments de page et état initial ;
- `js/match.js` : modes, séries, manches et couleurs secrètes ;
- `js/ui.js` : rendu du plateau et contrôles ;
- `js/rules.js` : poses, retournements, déplacements, observations et victoires ;
- `js/cpu.js` : génération des coups et CPU heuristique ;
- `js/strong-cpu.js` : estimation probabiliste de la couleur humaine et gestion du moteur fort ;
- `js/strong-cpu-worker.js` : recherche approfondie du Strong CPU ;
- `js/timer-result.js` : chronomètres, scores et fins de partie.
