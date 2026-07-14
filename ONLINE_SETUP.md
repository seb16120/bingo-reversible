# Bingo réversible : Online — installation

Cette branche contient la première fondation du mode en ligne :

- favicon Online avec un `O` ;
- page `online.html` pour créer ou rejoindre un salon privé ;
- authentification anonyme Supabase ;
- code d'invitation de 6 caractères et lien partageable ;
- places fixes : créateur = joueur 1 blanc, invité = joueur 2 noir ;
- état prêt des deux joueurs ;
- heartbeat de reconnexion fondé sur une fenêtre de 45 secondes ;
- écoute Realtime du salon et de ses deux joueurs ;
- schéma SQL avec Row Level Security.

Le plateau synchronisé et la validation serveur des coups constituent l'étape suivante.

## 1. Créer le projet Supabase

Créez un projet gratuit depuis le tableau de bord Supabase.

Dans **Authentication > Providers > Anonymous**, activez les connexions anonymes.

## 2. Installer le schéma

Dans **SQL Editor**, exécutez entièrement :

```text
supabase/online-lobby.sql
```

La migration est conçue pour pouvoir être rejouée.

## 3. Relier le site

Dans **Project Settings > API**, copiez :

- la Project URL ;
- la clé publique `publishable` ou `anon`.

Complétez ensuite `js/online-config.js` :

```js
window.BINGO_ONLINE_CONFIG = Object.freeze({
  supabaseUrl: "https://VOTRE-PROJET.supabase.co",
  supabasePublishableKey: "sb_publishable_..."
});
```

La clé publishable/anon est prévue pour être présente dans un site public. La protection des données repose sur les politiques RLS installées par la migration.

**Ne placez jamais la clé `service_role` dans GitHub ou dans le navigateur.**

## 4. Tester le lobby

Servez le dépôt par HTTP, puis ouvrez `online.html` dans deux navigateurs ou deux profils distincts :

1. le premier crée un salon ;
2. il copie le lien d'invitation ;
3. le second rejoint le salon ;
4. les deux activent « Je suis prêt ».

Une session anonyme Supabase est persistée localement, ce qui permet à une actualisation de reprendre la même place.

## Prochaine étape technique

La partie elle-même devra être autoritaire côté serveur :

- état public du plateau séparé des couleurs secrètes ;
- une couleur secrète lisible uniquement par son joueur ;
- attribution des couleurs et tirage du premier joueur côté serveur ;
- validation de chaque pose, retournement et déplacement avant diffusion ;
- contrôle des victoires, répétitions, 50 coups et chronomètres ;
- délai de reconnexion de 45 secondes avant défaite de la manche.

Le moteur local sera d'abord extrait en fonctions déterministes, puis réutilisé par la couche serveur afin que les règles locale et online restent identiques.
