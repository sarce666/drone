# Drones

Application interne : une bibliothèque de drones pour la pratique musicale.
Pour chaque morceau, on allume les notes qui doivent sonner, et c'est enregistré automatiquement. Un clic sur un morceau dans la liste lance son drone.

Chaque morceau a deux pads qui jouent en même temps :

- **Pad 1 — Synthé** : moteur repris du [Chromatone Drone](https://github.com/chromatone/drone) (MIT).
  Pas de samples, le son est synthétisé en direct avec [Tone.js](https://tonejs.github.io/)
  (dent de scie, saturation légère, filtre passe-bas auto-modulé, chorus, LFO lents sur le volume et le panoramique).
- **Pad 2 — Harmonium** : vrai harmonium, 39 notes (Do2 à Ré5), du
  [pack Freesound 29512](https://freesound.org/people/cabled_mess/packs/29512/) de cabled_mess
  (enregistrement de donyaquick, Yale), licence CC0. Chaque note est bouclée sur sa partie tenue avec un fondu
  enchaîné, pour tenir indéfiniment sans clic. Les fichiers originaux (WAV 96 kHz, 68 Mo) sont dans
  `samples/harmonium/`.

## Lancer

C'est une application web installable (PWA). Publiée en ligne (GitHub Pages), on l'ouvre une fois dans Safari sur
l'iPad, puis « Partager » → « Sur l'écran d'accueil ». Elle fonctionne ensuite hors ligne : le bouton
« Garder les sons hors ligne » télécharge les 39 WAV dans le cache de l'appareil. Les morceaux sont enregistrés sur
l'appareil lui-même.

En local sur le Mac, servir le dossier :

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

puis ouvrir <http://127.0.0.1:8765/>. Le service worker n'est actif qu'en https ou sur localhost ; les samples ne
peuvent pas être lus si l'on ouvre `index.html` directement par double-clic.

Après une modification de l'app, changer `VERSION` dans `sw.js` pour que les appareils installés se mettent à jour
(un bandeau « Nouvelle version disponible » apparaît).

## Utilisation

- **Morceaux** (colonne de gauche) : « + Nouveau » crée un morceau. Cliquer sur un morceau le charge et lance son drone.
- **Synthé seul / Les deux / Harmonium seul** : choisit, par morceau, quel pad est affiché et joué. Le pad masqué
  est coupé mais garde ses notes et ses réglages.
- **Pad 1 — Synthé** : en haut, les 12 notes de base (Do à Si) ; en dessous, une ligne par octave (1 à 5) avec
  toutes les notes jouables. Toucher une note l'allume ou l'éteint ; glisser verticalement ou utiliser la molette
  règle son volume. Le curseur « Niveau » règle le volume global du pad.
- **Pad 2 — Harmonium** : même grille, mêmes gestes, même curseur « Niveau ». Les notes grisées n'existent pas dans
  la banque (Do2 à Ré5).
- **Son** (un panneau sous chaque pad) : brillance et résonance du filtre, mouvement du filtre, chorus, saturation.
  Le synthé a en plus « épaisseur » (2 oscillateurs désaccordés). Double-clic sur un curseur pour revenir à la
  valeur par défaut. Sur l'harmonium, la chaîne d'effets est partagée par toutes les notes du pad.
- **Barre du haut** : lancer / arrêter (ou barre d'espace), volume général, référence du La4.
- **Exporter / Importer** : sauvegarde et restauration de tous les morceaux en JSON.

Les données sont enregistrées dans le `localStorage` du navigateur.
