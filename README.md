# Mon copilote budget

Application personnelle de suivi du quotidien : dépenses, revenus, budgets mensuels et projets d'épargne.
Un seul utilisateur, hébergée en local, utilisable sur Android (PWA installable depuis Chrome) et sur navigateur de bureau.

## Démarrer

Prérequis : Node.js 22.13 ou plus récent (utilise le module SQLite intégré à Node, aucune dépendance native).

```bash
npm install
npm run dev
```

Sous Windows, si PowerShell refuse d'exécuter `npm` (« l'exécution de scripts est désactivée »), utilisez `npm.cmd install` et `npm.cmd run dev`, ou autorisez une fois les scripts avec `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Le premier démarrage de l'API peut prendre 10 à 30 secondes sous Windows. Attendez la ligne « Mon copilote budget : API sur http://localhost:3001 » avant d'ouvrir le navigateur. En cas de doute, lancez les deux parties dans deux fenêtres : `npm run dev:api` puis `npm run dev:web`. Pour développer sur le serveur avec rechargement automatique : `npm run dev:api:watch`.

- API : http://localhost:3001
- Interface : http://localhost:5180 (accessible depuis le téléphone sur le même Wi‑Fi via l'adresse IP du PC, par exemple http://192.168.1.20:5180)

Sur Android, ouvrez l'adresse dans Chrome puis « Ajouter à l'écran d'accueil » pour installer l'application.

Les données sont stockées dans `data/budget.sqlite` (ignoré par git). Les photos de tickets vont dans `data/uploads/`.

## Sur le téléphone

1. PC allumé avec l'application lancée, téléphone sur le même Wi‑Fi.
2. Dans Chrome sur Android, ouvrez l'adresse « Network » affichée au démarrage, par exemple `http://192.168.1.20:5180` (ou `:3001` avec `demarrer.bat`).
3. Menu ⋮ de Chrome → « Ajouter à l'écran d'accueil » ou « Installer l'application ».

Si la page ne s'ouvre pas depuis le téléphone, autorisez Node.js dans le pare‑feu Windows pour les réseaux privés.

## Lancement en un double‑clic (Windows)

`demarrer.bat`, à la racine du projet, installe ce qui manque la première fois, prépare l'interface, puis lance l'application complète sur http://localhost:3001 et affiche l'adresse à utiliser depuis le téléphone. Pour qu'elle démarre avec Windows : touche Windows + R, tapez `shell:startup`, Entrée, puis placez un raccourci vers `demarrer.bat` dans le dossier qui s'ouvre.

## Version compilée (un seul processus)

```bash
npm run build
npm start
```

Le serveur sert alors l'interface et l'API sur http://localhost:3001.

Variables d'environnement optionnelles : `PORT` (défaut 3001), `BUDGET_DATA_DIR` (défaut `data`).

## Vérifier

```bash
npm run typecheck   # client + serveur
npm test            # règles métier : soldes, reste à dépenser, récurrences, budgets, projets
```

## Organisation (MVC)

| Couche | Emplacement | Rôle |
|---|---|---|
| Modèle | `server/db.ts`, `server/services/*` | Schéma SQLite, règles métier, calculs |
| Contrôleur | `server/app.ts` | Routes HTTP, validation des entrées (zod) |
| Vue | `src/pages/*`, `src/components/*` | Écrans React, quatre onglets et bouton « + » |
| Partagé | `shared/*` | Types, schémas de validation, montants et dates |

Les montants sont stockés en centimes (entiers). Les catégories techniques « Virement interne » et « Ajustement de solde » sont exclues des statistiques.

## Périmètre livré (MVC 1)

- Portefeuilles avec solde de départ, « Corriger le solde », archivage automatique si utilisé.
- Opérations : dépense, revenu, virement ; photo de ticket ; auto-complétion des libellés ; recherche ; export CSV.
- Récurrences mensuelles ou hebdomadaires, création automatique à l'échéance, annonce 7 jours avant.
- Budgets mensuels par catégorie avec barres vert / orange / rouge et bannière d'alerte.
- Projets d'épargne alimentés par virement interne, montant mensuel nécessaire pour tenir la date.
- Accueil : reste à dépenser, répartition, prochaines factures, projets, total des portefeuilles.
- Sauvegarde JSON complète avec restauration, clé IA stockée côté serveur pour le MVC 2.

## Périmètre livré (MVC 2, saisie sans effort)

- Photo de ticket : extraction du montant, de la date, du commerçant et d'une catégorie proposée, puis confirmation en un tap. La photo reste jointe à l'opération.
- Dictée depuis le bouton « + » : reconnaissance vocale de Chrome, puis extraction des champs par l'IA (« 45 euros de courses chez Carrefour hier »).
- Import du relevé bancaire CSV : détection des colonnes, format mémorisé par banque, doublons repérés, opérations créées « à vérifier », import annulable d'un coup.
- Catégorisation : chaque catégorie choisie pour un libellé devient une règle ; l'IA n'intervient que si aucune règle ne correspond. Règles consultables dans Réglages.

La photo, la dictée et la catégorisation par IA demandent une clé d'API Anthropic, à coller dans Réglages → Sauvegarde et clé IA. Elle est stockée dans la base locale, jamais dans le code ni dans le navigateur. Sans clé, tout le reste fonctionne, y compris l'import et les règles.

## Périmètre livré (MVC 3, coach)

- Carte « Conseil de la semaine » sur l'Accueil, calculée une fois par semaine à partir de constats déterministes : dérive de budget au rythme actuel, dépense inhabituelle, abonnement qui revient chaque mois sans récurrence déclarée, solde juste, projet alimenté, budgets tenus, marge du mois dernier. Le texte est rédigé par l'IA si une clé est présente, sinon par un gabarit.
- Chat « Mon coach » : questions sur ses propres chiffres, réponse en deux phrases avec un montant, uniquement à partir des données de l'application. Nécessite la clé IA.
- Ton bienveillant, sans jugement, aucun conseil financier réglementé.
