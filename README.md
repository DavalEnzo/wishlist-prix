# Wishlist prix

Chaque matin, GitHub relève le prix le plus bas de chaque jeu de ta wishlist. Le relevé couvre le PC (boutiques officielles et revendeurs de clés comme G2A, Eneba ou Kinguin) et la PS5. Une page web affiche les prix, et Discord t'alerte quand un jeu passe sous ton prix cible.

- `wishlist.json` : tes jeux et tes réglages, le seul fichier à modifier.
- `docs/` : la page publiée sur GitHub Pages et les prix relevés (`docs/data/prices.json`).
- `src/` : le script de relevé (TypeScript, exécuté directement par Node).
- `.github/workflows/prices.yml` : le relevé quotidien, la sauvegarde des prix et la publication de la page.

Les prix viennent d'AllKeyShop (GoClecD en France). Le client qui les lit est écrit dans ce projet (`src/allkeyshop.ts`) : le relevé n'utilise aucune librairie, seulement Node.js.

## Mise en place

1. **Crée un dépôt GitHub**, par exemple `wishlist-prix`. GitHub Pages est gratuit pour un dépôt public. Pour un dépôt privé, il faut un compte payant.
2. **Envoie les fichiers** depuis ce dossier :
   ```bash
   git init -b main
   git add .
   git commit -m "Wishlist prix"
   git remote add origin https://github.com/<ton-pseudo>/wishlist-prix.git
   git push -u origin main
   ```
3. **Active la page** : *Settings → Pages → Build and deployment → Source : GitHub Actions*.
4. **Branche Discord** :
   - Dans Discord, ouvre *Modifier le salon → Intégrations → Webhooks → Nouveau webhook*, puis *Copier l'URL du webhook*.
   - Sur GitHub, ouvre *Settings → Secrets and variables → Actions → New repository secret*. Nom : `DISCORD_WEBHOOK_URL`, valeur : l'URL copiée.
5. **Lance un premier relevé** : *Actions → Prix wishlist → Run workflow*. Une minute plus tard, la page est en ligne sur `https://<ton-pseudo>.github.io/wishlist-prix/`.

Ensuite, le relevé tourne tout seul tous les jours à 8h41 (7h41 en hiver). Il se relance aussi dès que tu modifies `wishlist.json`.

## Ajouter un jeu

Modifie `wishlist.json` directement sur GitHub (le lien « Modifier la wishlist » de la page y mène) :

```json
{ "title": "Hades II", "platforms": ["pc"], "targetPrice": 20, "priority": 3 }
```

| Champ | Rôle |
|---|---|
| `title` | Nom affiché (obligatoire). |
| `platforms` | `["pc"]`, `["ps5"]` ou les deux (défaut). Le ROG Ally utilise les offres PC. |
| `targetPrice` | Prix cible en euros. Une alerte part quand un prix passe dessous. |
| `priority` | Niveau d'envie : 1, 2 ou 3. |
| `search` | Nom à chercher dans le catalogue, si le titre ne suffit pas (voir plus bas). |
| `edition` | Édition voulue (ex. `"deluxe"`). Par défaut, l'édition standard. |
| `notes` | Remarque affichée dans le détail du jeu. |

### Si un jeu est mal reconnu

Le script cherche le jeu dans le catalogue AllKeyShop (environ 200 000 noms) mot par mot. Il ignore la ponctuation et les accents, et traite les chiffres romains comme des chiffres : « Hades II » trouve « Hades 2 », « GTA VI » trouve « GTA 6 ». Il n'accepte jamais un compte, un DLC ou une autre plateforme. Si plusieurs jeux différents correspondent, il refuse de choisir. Par exemple, « The Witcher 3 » trouve à la fois *Wild Hunt*, *REDkit* et *Hearts of Stone*.

Le jeu est alors marqué **« Nom à vérifier »** et n'est jamais utilisé pour un prix ou une alerte. La page liste les noms trouvés : copie le bon dans `search`.

```json
{ "title": "The Witcher 3", "search": "The Witcher 3 Wild Hunt", "platforms": ["pc"], "targetPrice": 8 }
```

Si le nom diffère selon la plateforme : `"search": { "pc": "…", "ps5": "…" }`.

## Réglages (`settings`)

- `excludeRegions` : mots qui écartent une offre quand ils apparaissent dans sa région ou dans le nom de la boutique. Par exemple, `"US"` écarte « PS Store US » et les clés « US Steam ». Les régions incompatibles avec un compte français sont exclues par défaut.
- `edition` : `"standard"` (défaut), `"all"`, ou un mot de l'édition.
- `keyshopAlerts` : `false` pour ne recevoir des alertes que sur les boutiques officielles.

Une alerte part la première fois qu'un jeu passe sous son prix cible. Elle repart seulement si le prix baisse encore d'au moins 0,50 €, ou après une remontée au-dessus de la cible.

## Lancer en local

Il faut Node.js 22.18 ou plus récent. Le relevé ne demande aucune installation.

```bash
npm run dry-run           # relève les prix sans envoyer d'alerte
npm start                 # relève et envoie les alertes (DISCORD_WEBHOOK_URL dans un fichier .env)
npm run preview           # affiche la page sur http://localhost:4173
npm ci --ignore-scripts   # seulement pour développer : installe TypeScript
npm run check             # vérification des types + tests (hors réseau)
```

Si AllKeyShop bloque un jour les serveurs de GitHub (relevé en échec dans l'onglet Actions), lance `npm start` depuis ton PC avec le Planificateur de tâches Windows. Le script est le même.

## Sécurité

- **Aucune dépendance à l'exécution.** Le relevé n'utilise que Node.js et le code de ce dépôt. GitHub Actions n'installe aucun paquet npm.
- Les seuls paquets du projet sont TypeScript et `@types/node`, qui servent uniquement à vérifier le code sur ton PC. Leurs versions sont figées, et `.npmrc` interdit les scripts d'installation.
- Le client AllKeyShop ne contacte que `www.allkeyshop.com`. Il refuse les réponses trop volumineuses et abandonne une requête après 30 secondes. Il valide chaque champ reçu et écarte ce qui est inattendu au lieu de le deviner.
- Les Actions GitHub sont épinglées par empreinte de commit, avec des permissions limitées au strict nécessaire.
- Le webhook Discord est un secret GitHub. Le script refuse toute URL qui n'est pas un webhook Discord, et les messages ne peuvent mentionner personne (`allowed_mentions`).
- La page n'insère jamais de HTML venant des données et n'ouvre que des liens `https://`.

## Limites

- L'API d'AllKeyShop n'est pas publique : elle peut changer ou bloquer l'accès sans prévenir. Si son format change, le relevé échoue avec un message clair plutôt que d'afficher de faux prix. Il faudra alors adapter `src/allkeyshop.ts`.
- Les prix sont ceux vus par AllKeyShop dans les 7 derniers jours, code promo compris. Vérifie toujours l'offre avant d'acheter.
- Pour la PS5, tout dépend des boutiques qu'AllKeyShop suit. Le PS Store France n'y figure pas toujours.
- Les liens « Voir sur GoClecD » sont construits à partir du nom du jeu et peuvent parfois mener à une page introuvable.
- GitHub peut suspendre les tâches planifiées d'un dépôt resté 60 jours sans activité. Si ça arrive, réactive-la depuis l'onglet Actions.
