# Bingo réversible

Jeu de stratégie sur navigateur, jouable à deux en local ou contre un CPU basique, sur un plateau 4 × 4.

## Jouer

Le site est conçu pour GitHub Pages et fonctionne sur ordinateur comme sur smartphone.

Adresse : `https://seb16120.github.io/bingo-reversible/`

## Modes

- **2 joueurs** : les deux couleurs secrètes sont révélées séparément sur le même appareil.
- **Vs. CPU** : le joueur humain est le joueur 1. Le CPU garde sa couleur secrète et joue automatiquement.
- Le CPU actuel ne joue pas au hasard : il cherche les victoires immédiates, évite de donner un alignement, limite les menaces au coup suivant et favorise les lignes prometteuses.
- Il ne connaît pas la couleur secrète réelle du joueur humain ; il raisonne sur les deux couleurs encore possibles.

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

- `index.html` : structure, menu et écrans du jeu ;
- `styles.css`, `tile-fix.css` et `mode-cpu.css` : interface, tuiles et adaptation mobile ;
- `js/config.js` : couleurs, tuiles, éléments de page et état initial ;
- `js/match.js` : modes, séries, manches et couleurs secrètes ;
- `js/ui.js` : rendu du plateau et contrôles ;
- `js/rules.js` : poses, retournements, déplacements et victoires ;
- `js/cpu.js` : génération et évaluation heuristique des coups du CPU ;
- `js/timer-result.js` : chronomètres, scores et fins de partie.
