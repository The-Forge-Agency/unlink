# Fiche Chrome Web Store — UnLink

## Informations

- **Nom** : UnLink — nettoyage LinkedIn en 1 clic
- **Catégorie** : Productivité
- **Langue** : Français
- **Site / code source** : dépôt GitHub du projet (voir `homepage_url` dans `manifest.json`)
- **Politique de confidentialité** : `PRIVACY.md` (publiée sur le dépôt)

## Description courte (≤ 132 caractères)

Repère les relances LinkedIn sans réponse, retire la relation et supprime la conversation en un geste. Tout reste dans ton navigateur.

## Description longue

Ta messagerie LinkedIn déborde de messages de prospection qui insistent sans que tu aies jamais répondu ? UnLink les repère et te permet de t’en débarrasser en un geste.

- Filtre « ⚡ Relances » : n’affiche que les conversations où la personne insiste alors que tu n’as jamais écrit.
- Un clic ou un raccourci (⌥⇧U / Alt+Shift+U) : retrait de la relation, puis suppression de la conversation.
- Nettoyage en masse, par petits lots espacés, en tâche de fond.
- Sûr : une conversation où tu as écrit n’est jamais proposée ; chaque action est vérifiée auprès de LinkedIn.
- Privé : aucun serveur, rien ne quitte ton navigateur. Code source ouvert.

## Justification de l’objectif unique

UnLink a un seul objectif : aider l’utilisateur à nettoyer sa messagerie LinkedIn des relances non sollicitées (repérage, retrait de la relation, suppression de la conversation).

## Justification des permissions

| Permission | Justification |
|---|---|
| `storage` | Enregistrer les réglages, la liste d’exclusion et le cache local des conversations analysées (sur l’appareil uniquement). |
| `scripting` | Secours : exécuter l’action « Retirer la relation » dans un onglet profil LinkedIn si la requête directe échoue. |
| `alarms` | Reprendre un lot de nettoyage en tâche de fond si Chrome met le service worker en veille entre deux personnes. |
| Hôte `https://www.linkedin.com/*` | Lire la messagerie, afficher les repères et boutons, et exécuter sur linkedin.com les actions déclenchées par l’utilisateur. |

## Utilisation des données (formulaire « Confidentialité »)

- Données collectées : « Contenu du site web » (métadonnées de conversations LinkedIn), traité localement uniquement.
- Aucune donnée vendue, transférée à des tiers ou utilisée à d’autres fins que la fonction unique.
- Aucun code distant exécuté.

## Visuels

- Icône : `icons/icon128.png`
- Captures d’écran (1280 × 800) et tuile promotionnelle (440 × 280) : `store/` (générées par `node tools/store-assets.js`)
