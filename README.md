# Bingo réversible

Jeu de stratégie local à deux joueurs, entièrement côté navigateur, sur un plateau 4 × 4.

## Jouer

Le site est conçu pour GitHub Pages et fonctionne sur ordinateur comme sur smartphone.

Adresse prévue : `https://seb16120.github.io/bingo-reversible/`

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

Aucune installation n’est nécessaire. Ouvrir simplement `index.html` dans un navigateur moderne.

## Fichiers

- `index.html` : structure et écrans du jeu ;
- `styles.css` : interface et adaptation mobile ;
- `js/config.js` : couleurs, tuiles et état initial ;
- `js/match.js` : séries, manches et couleurs secrètes ;
- `js/ui.js` : rendu du plateau et contrôles ;
- `js/rules.js` : poses, retournements, déplacements et victoires ;
- `js/timer-result.js` : chronomètres, scores et fins de partie.
