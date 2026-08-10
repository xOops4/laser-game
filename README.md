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

- **Garde le doigt posé** n'importe où sur l'écran : les armes tirent depuis le
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

Le score débloque de nouvelles armes **en cours de partie**, et elles **se
cumulent** : une fois acquise, chacune tire en même temps que les précédentes.
Chaque partie repart du seul Rayon. La barre du bas affiche l'arsenal — ce qui
tire s'allume, le reste indique le score à atteindre.

| Arme | Palier | Ce qu'elle apporte |
| --- | --- | --- |
| Rayon | dès le départ | Polyvalent. Perce, porte jusqu'au bord de l'écran. |
| Éventail | 350 | Deux rayons de flanc. Élargit la coupe, ne porte pas loin. |
| Lance | 950 | Concentre le tir sur la cible la plus proche. Perce les blindés. |
| Orbiteurs | 2 100 | Trois satellites qui visent et tirent seuls, même doigt levé. |

Les paliers sont réglés pour qu'un joueur correct les franchisse vers 25 s,
40 s et 60 s. Cumulées, les quatre armes quadruplent environ les dégâts du
Rayon seul — c'est pourquoi les ennemis gagnent des points de vie avec le
temps (+100 % en 260 s), pour que la fin de partie garde du mordant.

## Bonus

Les ennemis lâchent parfois un bonus (5 % du temps, 16 % pour les tanks). On le
ramasse **en passant un rayon dessus** ; il disparaît au bout de 9 secondes et
clignote sur la fin.

| Bonus | Durée | Effet |
| --- | --- | --- |
| Faisceaux | 12 s | Deux rayons de plus sur chaque arme |
| Surcharge | 10 s | Dégâts doublés |
| Ralenti | 8 s | Ennemis à 42 % de leur vitesse |
| Arsenal | 10 s | Toutes les armes tirent, même celles encore verrouillées |
| Réparation | — | +35 PV au noyau, immédiat |

Les effets en cours s'affichent en haut à gauche avec une barre qui se vide.
Reprendre un bonus déjà actif prolonge sa durée au lieu d'empiler l'effet, et
la Réparation ne tombe jamais quand le noyau est déjà presque intact.

## Ennemis

| Ennemi | Forme | Comportement |
| --- | --- | --- |
| Grunt | Triangle orange | Le tout-venant. Meurt en ~0,3 s de rayon. |
| Darter | Losange jaune | Rapide et fragile, apparaît après 20 s. Punit les balayages lents. |
| Tank | Hexagone violet | Lent mais très résistant, apparaît après 42 s. Frappe fort. |

La cadence d'apparition et la vitesse des ennemis montent en continu : pas de
vagues ni de temps mort.

## Structure

```
index.html   page, styles, écrans de menu / pause / fin
game.js      tout le jeu : boucle, entrées, ennemis, laser, rendu
```

Les réglages d'équilibrage sont regroupés en haut de `game.js` dans quatre
objets : `CFG` (noyau, combo, cadence d'apparition, rampes), `WEAPONS` (un bloc
par arme, avec son palier de déblocage), `BONUSES` + `DROP` (effets et taux de
chute) et `ENEMY_TYPES` (un bloc par type d'ennemi). Tout se règle là, sans
toucher au reste.

Ajouter une arme se limite à une entrée dans `WEAPONS` et un pictogramme dans
`WEAPON_GLYPHS` : la barre du bas et les paliers se mettent à jour seuls. Un
bonus se résume à une entrée dans `BONUSES` plus son effet là où il s'applique
(`beamOffsets`, `damageMultiplier`, `updateEnemies`, `isArmed`).

L'objet `window.VIRGULE` expose l'état du jeu pour inspection depuis la console
du navigateur.

## Son

Tout est synthétisé à la volée en WebAudio — oscillateurs et bruit blanc
filtré — donc aucun fichier à télécharger. Chaque arme a son bourdonnement de
tir ; les impacts, les explosions, les paliers de combo et les déblocages ont
leur signature. Les rafales sont bridées pour ne pas saturer la sortie.

Le contexte audio ne peut naître que dans un geste utilisateur (iOS l'exige),
il s'ouvre donc au premier appui. Le bouton en haut à droite coupe le son ;
le choix est retenu en `localStorage`.

## Détails techniques

- Coordonnées en pixels CSS, `devicePixelRatio` absorbé par une transformation
  du contexte (plafonné à 2 pour ne pas écrouler les écrans très denses).
- Les effets lumineux utilisent trois passes additives plutôt que `shadowBlur`,
  nettement moins coûteux sur mobile.
- Les particules ont deux formes : `dot` (carré, bon marché) et `streak`
  (segment étiré par la vitesse, réservé aux explosions). Plafond à 900. Les
  traînées de réacteur se coupent au-delà de 45 ennemis pour tenir le budget.
- Le fond n'est pas fixe : la poussière dérive vers le noyau avec un effet de
  parallaxe, et se régénère au bord une fois absorbée.
- Gestes natifs neutralisés : zoom au double-tap, scroll élastique, sélection,
  surbrillance au tap. Encoches gérées via `env(safe-area-inset-*)`.
- Pas de temps borné à 50 ms : un retour d'arrière-plan ne téléporte pas les
  ennemis sur le noyau. Le jeu se met en pause tout seul quand l'onglet passe
  en arrière-plan.
- Portrait et paysage supportés, l'aire de jeu s'adapte à la diagonale.
- Meilleur score en `localStorage`, avec repli silencieux si le stockage est
  bloqué (navigation privée, iframe sandboxée).
- Vibration courte quand le noyau encaisse, sur les appareils qui la supportent.

Mesuré à 60 fps en émulation iPhone 13 avec 100 ennemis à l'écran, le rayon
actif et les explosions en chaîne.

## Pas encore fait

Volontairement laissé de côté : les bonus à ramasser, les ennemis qui tirent à
distance, les boss, l'installation en PWA hors-ligne, et toute progression
conservée d'une partie à l'autre (seul le record l'est).
