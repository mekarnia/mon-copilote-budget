# Mettre l'application en ligne

Pour un usage personnel : une adresse accessible depuis n'importe où, une icône
sur le téléphone, et vos données protégées par un mot de passe.

## Ce qui protège vos comptes

Le serveur refuse par défaut. Deux états possibles, et aucun autre :

| Situation | Comportement |
|---|---|
| Aucun mot de passe, appel venu du réseau de la maison | L'application s'ouvre directement |
| Aucun mot de passe, appel venu d'ailleurs | **Tout est refusé** (403) |
| Un mot de passe est configuré | Il est demandé, partout, y compris à la maison |

Mise en ligne par mégarde sans mot de passe, l'application **se tait** au lieu
d'ouvrir vos relevés. C'est l'inverse du réglage habituel, et c'est voulu : le
défaut doit être celui qui ne perd rien.

Une fois entré, la connexion dure **90 jours sur cet appareil**. Sur le
téléphone, le mot de passe n'est retapé que quatre fois par an.

Le mot de passe n'est jamais enregistré, seulement son empreinte (scrypt), dans
un fichier lisible par son seul propriétaire. Le changer déconnecte tous les
appareils — sinon le changer ne servirait à rien.

## Déployer sur Fly.io

Il faut un compte Fly.io et l'outil `flyctl` installé
(`iwr https://fly.io/install.ps1 -useb | iex` sur Windows).

```bash
fly auth login

# 1. Créer l'application sans la lancer. Choisissez votre propre nom :
#    c'est lui qui donne l'adresse https://<nom>.fly.dev
fly launch --no-deploy --name mon-copilote-budget --region cdg

# 2. Le disque qui survit aux déploiements : base, photos, clé, mot de passe.
fly volumes create donnees --region cdg --size 1

# 3. Les deux secrets. Le mot de passe est OBLIGATOIRE ici : en ligne, aucun
#    appel n'est « local », donc personne ne peut en choisir un depuis l'écran.
fly secrets set BUDGET_MOT_DE_PASSE="choisissez une phrase longue"
fly secrets set ANTHROPIC_API_KEY="sk-ant-..."

# 4. Envoyer
fly deploy
```

Pour les mises à jour suivantes, `fly deploy` suffit.

`fly secrets set` redémarre l'application : changer le mot de passe déconnecte
tous les appareils, comme prévu.

### Ce qui n'a pas pu être vérifié ici

Le `Dockerfile` et le `fly.toml` sont écrits mais **l'image n'a pas été
construite** : aucun moteur Docker n'était disponible dans l'environnement de
développement. Les étapes qu'elle exécute — `npm ci`, `npm run build`,
`npm start` avec `BUDGET_DATA_DIR` et `PORT` — sont, elles, vérifiées. Si le
premier `fly deploy` échoue, l'erreur viendra de là et se corrige en une fois.

### Coût

Une machine partagée 512 Mo qui s'arrête quand personne ne s'en sert, plus un
disque de 1 Go. Quelques dollars par mois, à vérifier sur la grille tarifaire de
Fly, qui change. La machine se rallume en deux ou trois secondes à la première
visite : c'est une application de budget familial, pas un site marchand.

## Installer sur le téléphone

Rien à publier sur un store : l'application est déjà une PWA.

- **Android (Chrome)** : ouvrir l'adresse, menu ⋮, « Installer l'application ».
- **iPhone (Safari)** : ouvrir l'adresse, bouton Partager, « Sur l'écran
  d'accueil ». Il faut Safari ; les autres navigateurs iOS ne le proposent pas.

L'icône se comporte comme une application : plein écran, sans barre d'adresse.
Les données restent sur le serveur, donc le téléphone et le PC voient la même
chose.

## Sauvegardes

Le disque Fly ne remplace pas une sauvegarde : c'est le même endroit que les
données. **Réglages → Sauvegarde → Sauvegarde complète (JSON)** produit un
fichier qui restaure tout, et qui ne contient ni votre clé IA ni votre mot de
passe. Une fois par mois suffit ; gardez-en deux.

## Rester chez soi

Si vous préférez que vos relevés ne quittent jamais la maison, l'alternative
tient en une commande : `cloudflared tunnel --url http://localhost:3001` publie
le serveur qui tourne déjà sur votre PC, derrière une adresse HTTPS. C'est
gratuit, `demarrer.bat` continue de fonctionner tel quel, et vos données restent
sur votre disque — mais l'application n'est joignable que quand le PC est
allumé.

Dans ce cas, **configurez tout de même un mot de passe** : le tunnel est une
adresse publique. Ouvrez l'application depuis le PC, choisissez-en un, et il
sera demandé à tout le monde, tunnel compris.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `BUDGET_DATA_DIR` | Dossier des données (base, photos, clé, mot de passe) |
| `PORT` | Port d'écoute (3001 par défaut) |
| `BUDGET_MOT_DE_PASSE` | Mot de passe fourni par l'hébergeur ; l'emporte sur le fichier |
| `ANTHROPIC_API_KEY` | Clé IA ; l'emporte sur celle saisie dans Réglages |
| `BUDGET_DERRIERE_RELAIS` | `1` quand un relais est devant (détecté seul sur Fly) |

`BUDGET_DERRIERE_RELAIS` n'est pas cosmétique : il décide si l'en-tête
`x-forwarded-for` est cru. Cet en-tête est écrit par le client lui-même. Le
croire sans relais devant soi laisserait n'importe qui se déclarer « à la
maison ». Derrière un relais, aucun appel n'est jamais considéré comme local, et
le mot de passe est donc toujours exigé.
