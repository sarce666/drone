# VETERAN (Drones)

Application interne : une bibliothèque de drones pour la pratique musicale.
Pour chaque morceau, on allume les notes qui doivent sonner, et c'est enregistré automatiquement. Un clic sur un morceau dans la liste lance son drone.

Chaque morceau a trois pads qui jouent en même temps :

- **Pad 1 — Synthé** : moteur repris du [Chromatone Drone](https://github.com/chromatone/drone) (MIT).
  Pas de samples, le son est synthétisé en direct avec [Tone.js](https://tonejs.github.io/)
  (dent de scie, saturation légère, filtre passe-bas auto-modulé, chorus, LFO lents sur le volume et le panoramique).
- **Pad 2 — Harmonium** : vrai harmonium, 39 notes (Do2 à Ré5), du
  [pack Freesound 29512](https://freesound.org/people/cabled_mess/packs/29512/) de cabled_mess
  (enregistrement de donyaquick, Yale), licence CC0. Chaque note est bouclée sur sa partie tenue avec un fondu
  enchaîné, pour tenir indéfiniment sans clic. Les fichiers originaux (WAV 96 kHz, 68 Mo) sont dans
  `samples/harmonium/`.
- **Pad 3 — Basse** : un seul enregistrement, « Travis Scott Type — Moog Long Bass » d'Albert Mathiesen
  ([Sample Focus](https://samplefocus.com/samples/travis-scott-type-moog-long-bass), licence standard, libre de
  droits), dans `samples/bass/bass.wav`. Sa note de base est détectée au chargement (autocorrélation), puis le
  son est transposé sur toutes les notes du pad (Do1 à Si5) et bouclé comme l'harmonium. Loin de la note de base,
  le timbre change, c'est voulu. Pour changer de basse : nouveau fichier WAV (note tenue, 5 s ou plus) sous un
  **nouveau nom** dans `samples/bass/`, et `BASS_URL` dans `app.js` pointé dessus ; les appareils gardent les sons
  en cache par nom de fichier, un fichier remplacé sous le même nom ne serait pas rechargé.

## Lancer

C'est une application web installable (PWA), publiée sur GitHub Pages :

**<https://sarce666.github.io/drone/>**

Sur l'iPad ou l'iPhone, l'ouvrir une fois dans Safari, puis « Partager » → « Sur l'écran d'accueil ». Sur téléphone, les grilles de notes défilent horizontalement. Elle fonctionne ensuite hors ligne : le bouton
« Garder les sons hors ligne » télécharge les 39 WAV dans le cache de l'appareil. Les morceaux sont enregistrés sur
l'appareil lui-même.

En local sur le Mac, servir le dossier :

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

puis ouvrir <http://127.0.0.1:8765/>. Le service worker n'est actif qu'en https ou sur localhost ; les samples ne
peuvent pas être lus si l'on ouvre `index.html` directement par double-clic.

Après une modification de l'app, double-cliquer `publier.command` (ou `./publier.command "message"`) : il met à jour
`VERSION` dans `sw.js`, commit et pousse ; GitHub Pages redéploie en une à deux minutes et les appareils installés
affichent « Nouvelle version disponible » à leur prochaine ouverture. Dépôt : <https://github.com/sarce666/drone>.

## Utilisation

- **Morceaux** (colonne de gauche) : « + Nouveau » crée un morceau. Cliquer sur un morceau le charge et lance son drone.
- **Drone / Synthé / Harmonium / Basse / Batterie** : cinq gros boutons en haut du morceau, verts quand la partie
  est active ; un toucher l'éteint, un autre la rallume. « Drone » couvre le synthé et l'harmonium : éteint, les
  deux se taisent même si leurs boutons restent verts. La basse et la batterie sont indépendantes. Une partie éteinte disparaît de l'écran mais garde ses notes et ses
  réglages.
- **Annuler / Rétablir et Versions** : chaque modification du morceau crée une version (les modifications à moins de
  4 secondes d'intervalle sont regroupées) ; 40 versions sont gardées par morceau. « ↶ Annuler » revient à la
  précédente, « ↷ Rétablir » avance, et le panneau « Versions » liste toutes les versions avec l'heure et un résumé,
  chacune avec un bouton « Restaurer ». Cet historique reste sur l'appareil, il n'est pas synchronisé.
- **Pad 1 — Synthé** : en haut, les 12 notes de base (Do à Si) ; en dessous, une ligne par octave (1 à 5) avec
  toutes les notes jouables. Toucher une note l'allume ou l'éteint ; glisser verticalement ou utiliser la molette
  règle son volume. Le curseur « Niveau » règle le volume global du pad.
- **Pad 2 — Harmonium** : même grille, mêmes gestes, même curseur « Niveau ». Les notes grisées n'existent pas dans
  la banque (Do2 à Ré5).
- **Pad 3 — Basse** : même grille, toutes les notes jouables, même curseur « Niveau » et même panneau « Son ».
- **Rythme** : un séquenceur à cases. Tempo en BPM (champ, boutons − / +, curseur) commun aux trois pistes, compteur
  de temps (1 à 4) qui bat la mesure. Une ligne par instrument (grosse caisse, caisse claire, cymbale) : bouton
  ON/OFF (sur OFF, seule la ligne de titre reste visible), choix du son (plusieurs cymbales), niveau, puis les cases
  de la boucle (les temps sont numérotés au-dessus, « · » marque les subdivisions). Toucher une case y met ou enlève
  une frappe ; la case en cours est surlignée pendant la lecture. « Boucles » : combien de fois la boucle est jouée
  (− / +, ou ∞ pour sans fin) ; une fois les boucles jouées, le rythme s'arrête de lui-même (« fin ») et le drone
  continue ; « ↻ Relancer » repart de la première boucle. « Temps » : longueur de la boucle, de 1 à 16 temps ;
  « Cases par temps » : 1, 2 (croches), 3 (triolets) ou 4 (doubles-croches). Quand on change l'un ou l'autre, les
  frappes existantes gardent leur place dans le temps. Au-delà de 16 cases, la grille passe à la ligne par temps entiers.
  Sons dans `samples/kick`, `samples/snare`, `samples/cymbal` (originaux de `Documents/Binaire/composition/4/Audio`).
- **Son** (un panneau sous chaque pad) : brillance et résonance du filtre, mouvement du filtre, chorus, saturation.
  Le synthé a en plus « épaisseur » (2 oscillateurs désaccordés). Double-clic sur un curseur pour revenir à la
  valeur par défaut. Sur l'harmonium, la chaîne d'effets est partagée par toutes les notes du pad.
- **Barre du haut** : lancer / arrêter (ou barre d'espace), volume général, référence du La4.
- **Exporter / Importer** : sauvegarde et restauration de tous les morceaux en JSON.

Les morceaux sont enregistrés sur l'appareil (`localStorage`).

## Synchronisation entre appareils

Optionnelle. L'app peut enregistrer les morceaux dans un fichier `morceaux.json` d'un dépôt GitHub à vous
(privé de préférence) et les récupérer sur chaque appareil dès qu'il y a du réseau. Hors ligne, tout continue de
fonctionner ; la synchronisation repart au retour du réseau, à l'ouverture de l'app, ou avec « Synchroniser
maintenant ». Fusion par morceau : la version modifiée en dernier gagne.

Mise en place, une fois :

1. Sur GitHub, créer un dépôt **privé**, par exemple `drone-data` (vide, sans README).
2. Créer un jeton d'accès : GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token. Nom libre, expiration au choix, « Only select repositories » → `drone-data`,
   Permissions → Repository permissions → **Contents : Read and write**. Copier le jeton.
3. Dans l'app, colonne de gauche, ouvrir « Synchronisation non configurée », saisir le dépôt (`sarce666/drone-data`)
   et le jeton, puis « Enregistrer ».

Le jeton reste dans l'app, sur l'appareil ; il ne donne accès qu'à ce dépôt.

**Ajouter un appareil** (téléphone, autre tablette) sans retaper le jeton : sur l'appareil déjà configuré, ouvrir la
synchronisation et « Copier le code » (le code contient le dépôt et le jeton ; entre un iPad et un iPhone du même
compte iCloud, le presse-papiers universel suffit, sinon l'envoyer par AirDrop ou Notes). Sur le nouvel appareil,
installer l'app, puis « Récupérer mes morceaux » sur l'écran d'accueil et « Coller le code » : la configuration est
reprise et les morceaux arrivent aussitôt (« 3 morceaux récupérés »). Le même champ accepte aussi un code collé
directement. Sur l'iPhone, installer l'app sur l'écran d'accueil **avant** de coller le code : l'app installée a sa
propre mémoire, séparée de Safari.

## Habillage

Style repris d'un flyer de concert : fond noir tramé, titres vert pomme au pinceau, bandeaux violets en machine à
écrire, capitales condensées. Polices embarquées dans `fonts/` (Permanent Marker, Special Elite, Anton, licence OFL,
voir `fonts/LICENSE.txt`).
