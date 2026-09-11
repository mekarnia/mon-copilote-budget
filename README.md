# Mon copilote budget

Application personnelle de suivi du quotidien : dépenses, revenus, budgets mensuels et projets d'épargne.
Un seul utilisateur, hébergée en local, utilisable sur Android (PWA installable depuis Chrome) et sur navigateur de bureau.

## Démarrer

Prérequis : Node.js 22.13 ou plus récent (utilise le module SQLite intégré à Node, aucune dépendance native).

```bash
npm install
npm run dev
```

- API : http://localhost:3001
- Interface : http://localhost:5180 (accessible depuis le téléphone sur le même Wi‑Fi via l'adresse IP du PC, par exemple http://192.168.1.20:5180)

Sur Android, ouvrez l'adresse dans Chrome puis « Ajouter à l'écran d'accueil » pour installer l'application.

Les données sont stockées dans `data/budget.sqlite` (ignoré par git). Les photos de tickets vont dans `data/uploads/`.

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

À venir : MVC 2 (photo avec extraction, saisie vocale, import CSV bancaire, règles de catégorisation) puis MVC 3 (coach).
