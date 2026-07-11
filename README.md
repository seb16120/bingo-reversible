# Bingo réversible

Jeu de stratégie sur navigateur, jouable à deux en local, contre un CPU ou en CPU contre CPU, sur un plateau 4 × 4.

## Jouer

Le site est conçu pour GitHub Pages et fonctionne sur ordinateur comme sur smartphone.

Adresse : `https://seb16120.github.io/bingo-reversible/`

## Modes

- **2 joueurs** : les deux couleurs secrètes sont révélées séparément sur le même appareil.
- **Vs. CPU** : le joueur humain affronte le CPU basique.
- **Vs. CPU probabiliste** : le CPU tente de déduire la couleur adverse avant d’utiliser alpha-bêta et Monte-Carlo.
- **CPU vs CPU** : chaque place peut être réglée indépendamment sur Basique ou Probabiliste.
- Chaque CPU connaît uniquement sa propre couleur.
- Le CPU basique cherche les victoires immédiates et bloque en priorité les gains adverses au coup suivant.
- Le CPU probabiliste applique d’abord le même filtre défensif que le CPU basique, puis départage les coups sûrs avec sa recherche avancée.
- Le CPU probabiliste analyse jusqu’à 56 secondes et force son meilleur coup trouvé au plus tard à 58 secondes.

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

Aucune installation n’est nécessaire. Ouvrir simplement `index.html` dans un navigateur moderne. Le CPU probabiliste nécessite un navigateur autorisant les Web Workers ; en cas d’échec, le jeu utilise son meilleur choix basique disponible.

## Fichiers

- `index.html` : structure, menu et écrans du jeu ;
- `styles.css`, `tile-fix.css`, `mode-cpu.css`, `result-score.css` et les fichiers `game-upgrade-*.css` : interface, tuiles et adaptation mobile ;
- `js/config.js` : couleurs, tuiles, éléments de page et état initial ;
- `js/match.js` : séries, manches et couleurs secrètes ;
- `js/ui.js` : rendu du plateau et contrôles ;
- `js/rules.js` : poses, retournements, déplacements et victoires ;
- `js/cpu.js` : moteur heuristique historique ;
- `js/game-upgrade-v4.js` : contrôleurs humains/CPU, duel de CPU, inférence et défense prioritaire ;
- `js/probabilistic-cpu-worker-v4.js` : recherche du CPU probabiliste avec filtrage défensif racine ;
- `js/timer-result.js` : chronomètres, scores et fins de partie.
