# 📶 Machine à tickets WiFi (FlexPaie)

Mini application Node.js : le client paie **1000 FC** (Mobile Money ou carte) et reçoit automatiquement un **code WiFi non utilisé** (valable 1 jour, connexion illimitée). Aucun compte client.

## Fonctionnement
1. Vous générez les codes manuellement dans votre portail captif.
2. Vous les collez dans **/admin** (base de codes / stock).
3. Le client ouvre le site, saisit son numéro, valide le paiement sur son téléphone.
4. Le serveur vérifie le paiement auprès de FlexPaie (API de vérification), attribue **un seul code** à la commande et l'affiche. Aucun code n'est jamais donné deux fois.
5. Si le stock est vide après un paiement, le client attend sur sa page et reçoit son code dès que vous ajoutez des codes.

## Installation locale
```bash
npm install
cp .env.example .env   # puis remplir (token FlexPaie, mot de passe admin)
export $(grep -v '^#' .env | xargs) && npm start
```
- Page client : `http://localhost:3000`
- Admin : `http://localhost:3000/admin`

## Déploiement : GitHub → Hostinger
1. `git init && git add . && git commit -m "init" && git push` (le `.gitignore` exclut `.env` et `data/`).
2. Hostinger → **Node.js Web App** → importer le dépôt GitHub (commande de démarrage : `npm start`, Node 18+).
3. Dans les **variables d'environnement** Hostinger, saisir celles de `.env.example` (surtout `FLEXPAY_TOKEN`, `ADMIN_PASSWORD`, `BASE_URL`).
4. Les codes sont stockés dans `DATA_DIR`. Choisissez un dossier **hors du dossier déployé** (ex : `/home/utilisateur/wifi-data`) afin qu'un nouveau déploiement n'efface pas votre stock, et sauvegardez-le (bouton *Exporter CSV* dans l'admin).

## Endpoints FlexPaie utilisés
| Usage | URL |
|---|---|
| Mobile Money | `https://backend.flexpay.cd/api/rest/v1/paymentService` |
| Carte bancaire | `https://cardpayment.flexpay.cd/v1.1/pay` |
| Vérification | `https://apicheck.flexpaie.com/api/rest/v1/check/{orderNumber}` |

Les champs envoyés sont dans `lib/flexpay.js` : comparez-les aux fichiers d'API reçus de FlexPaie et ajustez si besoin (nom des champs, valeur du statut « succès »).

## Sécurité
- Le token n'est **jamais** dans le code : uniquement en variable d'environnement.
- Le code n'est délivré qu'après vérification serveur auprès de FlexPaie (le callback sert seulement de déclencheur).
- Admin protégé par mot de passe + cookie signé ; limitation de débit sur le paiement.
- Le token a été partagé en clair dans un message : par prudence, demandez à FlexPaie de le régénérer.
