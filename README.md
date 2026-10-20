# Wishlist gaming

Site multi-utilisateur à héberger chez soi. Chacun a son compte (email ou Discord) et sa wishlist de jeux. Chaque matin, le site relève le prix le plus bas de chaque jeu sur PC (boutiques officielles et revendeurs de clés : G2A, Eneba, Kinguin…) et sur PS5. Quand un jeu passe sous le prix cible de quelqu'un, il reçoit une notification sur le site, et un message privé Discord s'il a relié son compte.

- **Next.js 16 + PostgreSQL**, livrés en Docker Compose. Ça tourne sur un PC ou sur un Raspberry Pi 4/5.
- **Les prix viennent d'AllKeyShop** (GoClecD en France), lus par un client écrit dans ce projet (`src/lib/prices/allkeyshop.ts`).
- **Un jeu suivi par plusieurs personnes n'est relevé qu'une fois.** Les règles de chacun (pays, régions exclues, revendeurs ou non) s'appliquent ensuite à l'affichage et aux alertes.

## Ce qu'il te faut

- Une machine allumée en permanence : un PC sous Linux ou Windows (avec Docker Desktop), ou un Raspberry Pi 4/5 avec 4 Go de RAM et un système 64 bits.
- Docker et Docker Compose. Sur Linux ou Raspberry Pi : `curl -fsSL https://get.docker.com | sh`.
- Pour l'ouvrir sur Internet : un nom de domaine (voir « Rendre le site accessible depuis Internet »).

## Installation

```bash
git clone https://github.com/DavalEnzo/wishlist-prix.git
cd wishlist-prix
cp .env.example .env
nano .env            # au minimum POSTGRES_PASSWORD et APP_URL
docker compose up -d --build
```

Le premier lancement construit l'image : quelques minutes sur un PC, 10 à 15 minutes sur un Raspberry Pi. Le site est ensuite sur `http://<adresse-de-la-machine>:3000`.

### Raspberry Pi : image construite par GitHub

Construire l'image sur un Pi peu équipé est long et peut manquer de mémoire. À chaque push sur `main`, GitHub Actions construit l'image arm64 et la publie sur `ghcr.io/davalenzo/wishlist-prix`. Sur le Pi, pas de `--build` :

```bash
git pull && docker compose pull && docker compose up -d
```

Au premier démarrage, le service de relevé télécharge le catalogue AllKeyShop (environ 200 000 jeux, une minute). La recherche de jeux marche dès qu'il a fini.

Pour suivre ce qui se passe : `docker compose logs -f worker`.

## Réglages (`.env`)

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe interne de la base. Obligatoire. |
| `APP_URL` | Adresse publique du site, sans `/` final. Sert aux liens, aux cookies et à Discord. |
| `SIGNUP_CODE` | Si rempli, il faut ce code pour créer un compte. Conseillé dès que le site est sur Internet. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Connexion avec Discord (voir plus bas). |
| `DISCORD_BOT_TOKEN`, `DISCORD_INVITE_URL` | Alertes en message privé Discord (voir plus bas). |
| `SMTP_URL`, `MAIL_FROM` | Emails de « mot de passe oublié ». Sans eux, utilise la commande de réinitialisation. |
| `DAILY_AT`, `TIMEZONE` | Heure du relevé quotidien (défaut 08:41, Europe/Paris). |
| `TRUST_PROXY` | `true` derrière un tunnel Cloudflare ou un reverse proxy. |
| `WEB_PORT` | Port du site sur la machine (défaut 3000). |

Après une modification : `docker compose up -d`.

## Discord : connexion et messages privés

1. Sur [discord.com/developers/applications](https://discord.com/developers/applications), crée une application (par exemple « Wishlist gaming »).
2. **Connexion** : dans *OAuth2*, copie le *Client ID* et le *Client Secret* dans `.env`. Dans *Redirects*, ajoute `APP_URL/api/auth/discord/callback`, par exemple `https://wishlist.mondomaine.fr/api/auth/discord/callback`.
3. **Messages privés** : dans *Bot*, clique sur *Reset Token* et copie le jeton dans `DISCORD_BOT_TOKEN`. Aucun « privileged intent » n'est nécessaire.
4. **Invite le bot sur ton serveur** : dans *OAuth2 → URL Generator*, coche le scope `bot` sans aucune permission, ouvre l'URL générée et choisis ton serveur.
5. Mets une invitation permanente vers ce serveur dans `DISCORD_INVITE_URL`.

Discord n'autorise un bot à écrire en privé qu'aux membres d'un serveur où il se trouve, et seulement s'ils acceptent les messages privés des membres de ce serveur (c'est le réglage par défaut). Si un message ne passe pas, la personne voit la raison dans ses réglages, et l'alerte reste dans ses notifications sur le site.

## Rendre le site accessible depuis Internet

Le plus simple, sans ouvrir de port sur ta box, est un **tunnel Cloudflare** (gratuit, il faut un nom de domaine géré par Cloudflare) :

1. Dans le tableau de bord Cloudflare, ouvre *Zero Trust → Networks → Tunnels* et crée un tunnel.
2. Installe le connecteur sur la machine du site, avec la commande donnée par Cloudflare.
3. Ajoute un *Public hostname* (par exemple `wishlist.mondomaine.fr`) qui pointe vers `http://localhost:3000`.
4. Dans `.env`, mets `APP_URL=https://wishlist.mondomaine.fr`, `TRUST_PROXY=true` et un `SIGNUP_CODE`. Si le connecteur tourne sur la même machine, mets `127.0.0.1:3000:3000` dans `ports` du service `web` de `docker-compose.yml`.
5. Relance avec `docker compose up -d`.

## Administration

```bash
# Lien de réinitialisation de mot de passe (valable une heure), sans email
docker compose exec web npm run reset-password -- ami@exemple.fr

# Sauvegarde et restauration de la base
docker compose exec db pg_dump -U wishlist wishlist > sauvegarde.sql
docker compose exec -T db psql -U wishlist wishlist < sauvegarde.sql

# Mise à jour
git pull && docker compose up -d --build
```

## Sécurité

- **Mots de passe** : hachés avec scrypt (intégré à Node.js). La base ne stocke qu'une empreinte des jetons de session et des liens de réinitialisation.
- **Cookies** : `HttpOnly`, `SameSite=Lax`, et `Secure` dès que `APP_URL` est en HTTPS. Changer de mot de passe déconnecte les autres appareils.
- **Abus** : limitation des tentatives de connexion, d'inscription et de réinitialisation. Les messages ne révèlent pas si un email a un compte.
- **Connexion Discord** : protégée par un paramètre `state` aléatoire. Un compte Discord n'est jamais relié automatiquement à un compte email : c'est fait depuis les réglages, une fois connecté.
- **En-têtes** : en production, Content-Security-Policy, X-Frame-Options et Referrer-Policy. Les polices sont hébergées par le site lui-même, sans appel à Google.
- **Dépendances** : peu nombreuses et figées (Next.js, React, Drizzle ORM, postgres.js, nodemailer), installées sans scripts (`ignore-scripts`). Discord et AllKeyShop sont appelés directement avec `fetch`, sans librairie.

## Développement

```bash
npm ci --ignore-scripts
npm run check        # types + tests (PostgreSQL en mémoire via PGlite, aucun réseau)
DATABASE_URL=postgres://… npm run migrate
DATABASE_URL=postgres://… npm run dev
DATABASE_URL=postgres://… npm run worker
```

Le service de relevé et les scripts tournent directement en TypeScript avec Node 24, sans compilation. Une modification du schéma (`src/lib/db/schema.ts`) se traduit en migration SQL avec `npm run db:generate`.

## Limites

- L'API d'AllKeyShop n'est pas publique : elle peut changer ou bloquer l'accès sans prévenir. Si son format change, le relevé affiche une erreur au lieu de faux prix, et il faudra adapter `src/lib/prices/allkeyshop.ts`.
- Les prix sont ceux vus par AllKeyShop dans les 7 derniers jours, code promo compris. Les clés de revendeurs peuvent être limitées à une région ou à une plateforme d'activation (« Xbox/PC », « Steam ») : vérifie toujours l'offre avant d'acheter.
- Pour la PS5, tout dépend des boutiques suivies par AllKeyShop.
