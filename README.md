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

## Visée

Deux modes, choisis depuis le menu ou l'écran de pause, retenus en
`localStorage`.

**Pouce** (par défaut). Le doigt pose un manche virtuel là où il touche, et
l'angle de tir va de cet ancrage au doigt : on pousse dans la direction où l'on
veut tirer. On peut donc jouer pouce calé en bas de l'écran et tirer vers le
haut — la main ne masque plus jamais l'action. Le manche se réancre à chaque
nouvel appui, donc aucune position n'est imposée.

**Directe**. L'angle va du noyau au doigt : on vise l'endroit qu'on touche.
Plus immédiat à comprendre, mais le doigt se place forcément dans la direction
visée, c'est-à-dire pile devant ce qu'on essaie de regarder.

Un **anneau de menaces** entoure le noyau : un cran par ennemi proche, planté à
l'angle d'où il vient, d'autant plus long et vif qu'il approche. Il tient dans
le disque central — la seule zone qu'une main ne masque jamais — et permet donc
de lire ce qui arrive même écran partiellement caché.

## Comment ça se joue

- **Garde le doigt posé** sur l'écran : les armes tirent depuis le noyau dans
  la direction que tu donnes.
- **Balaie** pour découper. Le rayon traverse tout ce qui est aligné : bien
  s'aligner sur plusieurs ennemis d'un coup, c'est là que les points se font.
- Les dégâts sont **par seconde** : il faut rester une fraction de seconde sur
  une cible. Les gros demandent plusieurs passages.
- Chaque ennemi qui atteint le noyau enlève des points de vie (l'anneau autour
  du noyau) et **casse la série**.

La souris fonctionne exactement comme le doigt sur ordinateur.

## Séries

Enchaîner les kills fait monter un multiplicateur, d'un cran tous les 8 kills,
jusqu'à ×10. Deux façons de le perdre : encaisser un coup, ou **laisser passer
5 secondes sans tuer** — une barre sous le multiplicateur montre le temps
restant et clignote quand il s'épuise.

Le multiplicateur traverse cinq paliers nommés, et **c'est la couleur du palier
qui pilote tout le décor** : nébuleuses de fond, grille polaire, aura du noyau,
halos et débris d'explosion s'y accordent.

| Palier | À partir de | Couleur |
| --- | --- | --- |
| Chaîne | ×2 | vert menthe |
| Série | ×4 | jaune |
| Furie | ×6 | ambre |
| Déchaîné | ×8 | rose vif |
| Surchauffe | ×10 | blanc chaud |

L'intensité qui en découle est lissée dans le temps : le décor respire d'un
palier à l'autre au lieu de sauter.

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
objets : `CFG` (noyau, séries, cadence d'apparition, rampes), `COMBO_TIERS`
(paliers et couleurs, qui pilotent le décor), `WEAPONS` (un bloc
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
- Les halos ne reconstruisent jamais de dégradé : un sprite radial est cuit
  une fois par couleur dans un canvas hors écran, puis simplement redimensionné.
- Le fond couvre l'écran plusieurs fois par image, ce qui sature le taux de
  remplissage d'un mobile au plein format. Comme il est entièrement flou, il
  est peint dans un calque au tiers de la résolution puis ré-étiré : neuf fois
  moins de pixels, aucune différence visible. Sans cette astuce, la charge
  maximale tombait à 31 fps.
- La poussière de fond dérive vers le noyau avec un effet de parallaxe, se
  régénère au bord une fois absorbée, et accélère avec l'intensité.
- Gestes natifs neutralisés : zoom au double-tap, scroll élastique, sélection,
  surbrillance au tap. Encoches gérées via `env(safe-area-inset-*)`.
- Pas de temps borné à 50 ms : un retour d'arrière-plan ne téléporte pas les
  ennemis sur le noyau. Le jeu se met en pause tout seul quand l'onglet passe
  en arrière-plan.
- Portrait et paysage supportés, l'aire de jeu s'adapte à la diagonale.
- Meilleur score en `localStorage`, avec repli silencieux si le stockage est
  bloqué (navigation privée, iframe sandboxée).
- Vibration courte quand le noyau encaisse, sur les appareils qui la supportent.

Mesuré à 59 fps en émulation iPhone 13 dans le pire cas : 100 ennemis à
l'écran, les quatre armes cumulées, deux bonus actifs, série à ×10 et
explosions en chaîne.

## Pas encore fait

Volontairement laissé de côté : les bonus à ramasser, les ennemis qui tirent à
distance, les boss, l'installation en PWA hors-ligne, et toute progression
conservée d'une partie à l'autre (seul le record l'est).
