# VIRGULE

Un jeu d'arcade pour navigateur, pensé pour le tactile : un noyau au centre de
l'écran, des ennemis qui convergent de toutes parts, et un laser que tu diriges
au doigt pour les découper avant qu'ils n'arrivent.

Canvas 2D pur, aucune dépendance, aucune étape de build.

## Jouer

Ouvre `index.html` dans un navigateur. C'est tout.

Pour y jouer depuis un téléphone en local :

```sh
python3 -m http.server 8000
# puis http://<ip-de-ta-machine>:8000 sur le téléphone, même réseau Wi-Fi
```

Le jeu est entièrement statique : il peut être servi tel quel par n'importe
quel hébergeur de fichiers.

## Comment ça se joue

- **Garde le doigt posé** n'importe où sur l'écran : l'arme tire depuis le
  noyau dans la direction de ton doigt. Nul besoin de partir du centre.
- **Balaie** pour découper. Le rayon traverse tout ce qui est aligné : bien
  s'aligner sur plusieurs ennemis d'un coup, c'est là que les points se font.
- Les dégâts sont **par seconde** : il faut rester une fraction de seconde sur
  une cible. Les gros demandent plusieurs passages.
- Chaque ennemi qui atteint le noyau enlève des points de vie (l'anneau autour
  du noyau) et **remet le multiplicateur à zéro**.
- Le multiplicateur monte d'un cran tous les 8 kills consécutifs sans encaisser,
  jusqu'à ×10.

La souris fonctionne exactement comme le doigt sur ordinateur.

## Armes

Le score débloque de nouvelles armes **en cours de partie** ; chaque partie
repart du seul Rayon. La barre du bas montre les armes disponibles et, pour
les autres, le score qu'il reste à atteindre. On en change d'une tape.

| Arme | Palier | Ce qu'elle vaut |
| --- | --- | --- |
| Rayon | dès le départ | Polyvalent. Perce, porte jusqu'au bord de l'écran. |
| Éventail | 400 | Trois rayons courts. Nettoie les nuées, impuissant au loin. |
| Lance | 1 200 | Une seule cible à la fois, dégâts énormes. Visée exigeante. |
| Onde | 2 800 | Impulsions circulaires autour du noyau. Ignore la visée, portée courte. |

Aucune n'est strictement meilleure qu'une autre : la Lance démonte un tank que
l'Éventail ne griffe pas, l'Onde sauve quand trois ennemis arrivent en même
temps par trois côtés.

## Ennemis

| Ennemi | Forme | Comportement |
| --- | --- | --- |
| Grunt | Triangle orange | Le tout-venant. Meurt en ~0,3 s de rayon. |
| Darter | Losange jaune | Rapide et fragile, apparaît après 16 s. Punit les balayages lents. |
| Tank | Hexagone violet | Lent mais très résistant, apparaît après 34 s. Frappe fort. |

La cadence d'apparition et la vitesse des ennemis montent en continu : pas de
vagues ni de temps mort.

## Structure

```
index.html   page, styles, écrans de menu / pause / fin
game.js      tout le jeu : boucle, entrées, ennemis, laser, rendu
```

Les réglages d'équilibrage sont regroupés en haut de `game.js` dans trois
objets : `CFG` (noyau, combo, cadence d'apparition), `WEAPONS` (un bloc par
arme, avec son palier de déblocage) et `ENEMY_TYPES` (un bloc par type
d'ennemi). Tout se règle là, sans toucher au reste.

Ajouter une arme se limite à une entrée dans `WEAPONS` et un pictogramme dans
`WEAPON_GLYPHS` : la barre du bas et les paliers se mettent à jour seuls.

L'objet `window.VIRGULE` expose l'état du jeu pour inspection depuis la console
du navigateur.

## Détails techniques

- Coordonnées en pixels CSS, `devicePixelRatio` absorbé par une transformation
  du contexte (plafonné à 2 pour ne pas écrouler les écrans très denses).
- Les effets lumineux utilisent trois passes additives plutôt que `shadowBlur`,
  nettement moins coûteux sur mobile.
- Gestes natifs neutralisés : zoom au double-tap, scroll élastique, sélection,
  surbrillance au tap. Encoches gérées via `env(safe-area-inset-*)`.
- Pas de temps borné à 50 ms : un retour d'arrière-plan ne téléporte pas les
  ennemis sur le noyau. Le jeu se met en pause tout seul quand l'onglet passe
  en arrière-plan.
- Portrait et paysage supportés, l'aire de jeu s'adapte à la diagonale.
- Meilleur score en `localStorage`, avec repli silencieux si le stockage est
  bloqué (navigation privée, iframe sandboxée).
- Vibration courte quand le noyau encaisse, sur les appareils qui la supportent.

Mesuré à 60 fps en émulation iPhone 13 avec 120 ennemis à l'écran et le rayon
actif.

## Pas encore fait

Volontairement laissé de côté : le son, les bonus à ramasser, les ennemis qui
tirent à distance, les boss, l'installation en PWA hors-ligne, et toute
progression conservée d'une partie à l'autre (seul le record l'est).
