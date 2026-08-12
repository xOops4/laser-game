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

## Terrains

Deux dispositions, choisies au menu et retenues en `localStorage`.

**Orbite** — le noyau au centre, les ennemis de toutes parts. Le mode
d'origine.

**Rempart** — le noyau posé en bas de l'écran, les ennemis descendent du haut
dans un cône de ±74°. Le canon ne passe jamais sous l'horizontale, les
satellites et les mines se répartissent sur l'arc supérieur au lieu de plonger
sous le socle, et un rayon qui viserait le sol est **rabattu en miroir
au-dessus de l'horizon** — c'est ce qui sauve le Revers, qui couvre alors le
flanc opposé à celui qu'on vise au lieu de tirer dans le décor.

Tout le jeu étant écrit en coordonnées polaires autour du noyau, le second
mode se résume à déplacer ce noyau et à restreindre l'arc : armes, bonus,
séries et ennemis fonctionnent sans modification.

L'équilibrage, lui, a demandé du travail. Un arc deux fois plus étroit signifie
qu'un seul balayage couvre en permanence tout le cône de menace : à réglages
identiques, le noyau n'était **jamais touché en deux minutes**, les ennemis
mourant à 300 px. Doubler la cadence n'y changeait rien, ni les faire naître au
ras du bord plutôt que sur un cercle plus large — le facteur limitant n'est pas
leur nombre ni leur trajet, mais leur survie face à un rayon qui ne les quitte
jamais. En Rempart ils ont donc +50 % de points de vie et +28 % de vitesse, ce
qui ramène les deux modes dans la même bande : 2 morts sur 3 parties de bot,
à 45 s et 62 s, contre une médiane de 67 s en Orbite.

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
Chaque partie repart du seul Rayon.

La barre du bas affiche l'arsenal sous forme de carrés d'icônes, sans un mot :
une arme en service s'allume à sa couleur, une arme verrouillée reste en
pointillés et se **remplit par le bas** au rythme du score qui mène à son
palier. Les noms restent accessibles aux lecteurs d'écran et au survol.

| Arme | Palier | Ce qu'elle apporte |
| --- | --- | --- |
| Rayon | dès le départ | Polyvalent. Perce, porte jusqu'au bord de l'écran. |
| Éventail | 350 | Deux rayons de flanc. Élargit la coupe, ne porte pas loin. |
| Lance | 950 | Concentre le tir sur la cible la plus proche. Perce les blindés. |
| Orbiteurs | 2 100 | Trois satellites qui visent et tirent seuls, même doigt levé. |
| Revers | 4 200 | Un rayon dans le dos. Couvre ce que tu ne regardes pas. |
| Foudre | 7 000 | Un arc qui saute jusqu'à quatre ennemis, tout seul. |
| Mines | 11 000 | Cinq mines en orbite lointaine, qui sautent au contact. |

Les **Mines** occupent des emplacements fixes sur une orbite large (36 % du
rayon d'apparition), qui tourne lentement à contresens des Orbiteurs. Une mine
saute au premier contact, souffle tout dans 84 px — projectiles ennemis
compris — puis son emplacement se recharge en 3,4 s. On voit donc en
permanence quel secteur de l'orbite est encore protégé : une mine armée est un
point vif, une mine en recharge un arc qui se referme.

Un joueur correct franchit les trois premiers paliers vers 25 s, 40 s et 55 s,
le Revers vers 90 s ; la Foudre est un objectif de fin de partie. Cumulées,
les armes multiplient largement les dégâts du Rayon seul — c'est pourquoi les
ennemis gagnent des points de vie avec le temps (+100 % en 260 s).

## Chiffres de dégâts

Chaque ennemi touché affiche le montant encaissé, en chiffres flottants dont
la taille suit l'ampleur du coup. Le coup fatal prend la couleur du palier de
série en cours, ce qui le distingue des dégâts qui grattent.

Deux choix méritent d'être explicités.

**Les dégâts continus sont regroupés.** Un rayon frappe à chaque image :
afficher les 1,8 points d'une image serait illisible. Les dégâts sont donc
cumulés par ennemi et relâchés toutes les 0,2 s — un Rayon nu affiche 23, le
même Rayon avec Surcharge et trois Amplificateurs affiche 71.

**Le montant n'est jamais plafonné aux points de vie restants.** Un coup de
mine à 135 sur un ennemi qui n'en a plus que 5 affiche bien 135. Et lorsqu'un
ennemi est pulvérisé en une seule image, c'est la force du coup qui s'affiche,
pas la fraction réellement consommée : sinon un arsenal surpuissant produirait
paradoxalement de tout petits nombres.

Le nombre de chiffres simultanés est plafonné à 40.

## Détonations en chaîne

À partir du palier **Furie** (×6), chaque mort souffle ses voisins dans un
rayon de 58 px. Une nuée dense part alors en réaction en chaîne, ce qui rend
les hauts multiplicateurs spectaculaires — et instables, puisqu'il suffit
d'une seconde sans kill pour tout perdre. La récursion est bornée à trois
niveaux : sans cela une nuée dense faisait déborder la pile d'appels.

## Bonus

Les ennemis lâchent parfois un bonus (6 % du temps, 18 % pour les tanks). On le
ramasse **en passant un rayon dessus** ; il disparaît au bout de 9 secondes et
clignote sur la fin. Le tirage est pondéré : les améliorations définitives sont
nettement plus rares que les effets temporaires.

**Temporaires** — décomptés en haut à gauche par une barre qui se vide.

| Bonus | Durée | Effet |
| --- | --- | --- |
| Faisceaux | 12 s | Deux rayons de plus sur chaque arme |
| Surcharge | 10 s | Dégâts doublés |
| Ralenti | 8 s | Ennemis à 42 % de leur vitesse |
| Arsenal | 10 s | Toutes les armes tirent, même celles encore verrouillées |
| Réparation | — | +35 PV au noyau, immédiat |

**Définitifs** — acquis jusqu'à la fin de la partie, affichés sans barre.

| Amélioration | Effet | Plafond |
| --- | --- | --- |
| Blindage | +30 PV maximum, et le noyau les reçoit pleins | — |
| Amplificateur | +18 % de dégâts, cumulable | — |
| Satellite | Un orbiteur de plus | 3 |
| Aimant | Les bonus sont attirés par le noyau | 1 |

Reprendre un bonus temporaire déjà actif prolonge sa durée au lieu d'empiler
l'effet. La Réparation ne tombe jamais quand le noyau est presque intact, ni
une amélioration déjà à son plafond.

## Ennemis

| Ennemi | Forme | Comportement |
| --- | --- | --- |
| Grunt | Triangle orange | Le tout-venant. Meurt en ~0,3 s de rayon. |
| Darter | Losange jaune | Rapide et fragile, à partir de 20 s. Punit les balayages lents. |
| Tank | Hexagone violet | Lent mais très résistant, à partir de 42 s. Frappe fort. |
| Rôdeur | Pentagone turquoise | À partir de 50 s. Ne fonce pas : il s'enroule vers le noyau, ce qui le fait glisser hors d'un rayon tenu droit. |
| Essaim | Carré rouge | À partir de 68 s. Se scinde en trois éclats rapides à sa mort — l'abattre trop près du noyau se paie comptant. |
| Sentinelle | Chevron bleu pâle | À partir de 88 s. S'arrête à distance et bombarde. Ses projectiles sont lents et **destructibles au rayon**. |

## Densité

Les ennemis **ne vont jamais plus vite** : leur vitesse est fixe pour un type
donné, du début à la fin. Toute la montée en difficulté passe par la densité,
c'est-à-dire par leur nombre.

Un palier est franchi toutes les 10 secondes et raccourcit l'intervalle
d'apparition de 12 %, ce qui donne une progression géométrique. Un indicateur
en haut à droite affiche le niveau, le coefficient — combien de fois plus
d'ennemis qu'au départ — et une barre d'avancement vers le palier suivant.
Chaque passage de palier se signale par deux notes montantes.

| Temps | Niveau | Intervalle | Coefficient |
| --- | --- | --- | --- |
| 0 s | 1 | 1,25 s | ×1 |
| 90 s | 10 | 0,40 s | ×3 |
| 190 s | 20 | 0,11 s | ×11 |
| 290 s | 30 | 0,031 s | ×40 |

**La progression n'a pas de plafond.** Deux garde-fous naturels suffisent : une
seule apparition par image, donc 60 par seconde au maximum quoi qu'il arrive,
et un plafond de 260 ennemis vivants simultanément.

## Recul de caméra

Tous les dix paliers, la caméra recule d'un cran — ×0,84, puis ×0,71, puis
×0,60 où elle s'arrête. Les ennemis paraissent plus petits mais **on les voit
venir de bien plus loin**, ce qui rend la densité croissante tenable. Le rayon
du monde passe ainsi de 445 à 733 unités pendant que l'écran, lui, ne change
pas.

Le recul s'arrête à ×0,60 parce qu'au-delà les ennemis deviendraient trop
petits pour être lus : un grunt y mesure déjà 7,8 px de rayon contre 13 au
départ. Le recul est purement visuel — les distances de collision, elles, sont
inchangées — et il s'anime sur environ une seconde, annoncé par un bandeau
pour qu'un écran qui s'éloigne ne passe pas pour un défaut d'affichage.

Deux détails d'implémentation : les chiffres de dégâts compensent le recul
pour garder une taille constante à l'écran, et le décor de fond raisonne en
pixels d'écran plutôt qu'en unités du monde, puisqu'il est peint hors de la
transformation.

Difficulté mesurée sur cinq parties d'un bot qui balaie sans jamais viser :
quatre morts entre 47 s et 70 s, médiane 67 s, et une survie au-delà de 120 s.
Cette dernière tient entièrement aux **améliorations définitives** — deux
ramassées tôt suffisent à faire basculer une partie. C'est la plus grosse
source de variance du jeu, et une exécution isolée ne dit donc rien de la
difficulté réelle.

## Structure

```
index.html   page, styles, écrans de menu / pause / fin
game.js      tout le jeu : boucle, entrées, ennemis, laser, rendu
```

Les réglages d'équilibrage sont regroupés en haut de `game.js` dans quatre
objets : `MODES` (disposition et compensations de chaque terrain), `CFG`
(noyau, séries, densité, recul, rampe de points de vie), `COMBO_TIERS`
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
filtré — donc aucun fichier à télécharger. Chaque arme à rayon a son
bourdonnement de tir ; les impacts, les explosions graduées selon la taille,
les répliques des grosses morts, les détonations de zone, le crépitement de la
Foudre (d'autant plus aigu qu'il rebondit), les paliers de série, les
ramassages, l'accord d'une acquisition définitive et l'effondrement final ont
chacun leur signature. Les rafales sont bridées pour ne pas saturer la sortie :
à ×10 il peut y avoir des dizaines de détonations par seconde.

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
  maximale tombait à 31 fps. Le noir de fond est peint dans ce calque plutôt
  que sur le canvas, ce qui économise encore une passe plein écran.
- **Résolution adaptative.** Un profil du pire cas passe 89 % du temps en
  rastérisation : le jeu est limité par les pixels, pas par le calcul. Plutôt
  que d'appauvrir les effets pour tout le monde, la résolution de rendu
  descend par paliers jusqu'à 60 % quand la cadence flanche, et remonte après
  trois fenêtres propres d'affilée. Le canvas garde sa taille CSS, l'affichage
  ré-étire.

  Deux métriques ont été essayées avant d'arriver là, et toutes deux échouent
  pour des raisons instructives. Chronométrer `update` + `render` ne mesure
  rien d'utile : les appels de dessin partent en file d'attente, si bien que
  le pire cas ne coûte que 2 ms côté JavaScript. Comparer la durée d'image à
  un seuil échoue autrement : avec la synchro verticale elle vaut 16,7 ms dès
  qu'on tient les 60 fps, marge confortable ou non — la résolution descendait
  au moindre à-coup sans jamais pouvoir remonter. Ce qui fonctionne est de
  compter la **proportion d'images longues** sur une fenêtre de 2 s : le
  signal reste lisible dans les deux sens.
- La boucle principale réarme `requestAnimationFrame` dans un `finally`. Une
  exception dans une image affiche une erreur mais ne fige plus la partie —
  un bug réel l'a démontré pendant le développement.
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
