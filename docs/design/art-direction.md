# Art direction: the painted mountain

Decided 15 Oct 2026 (Xander: "be a creative director and revamp, pick a stylised version, take
reference from Little Devil Inside"). Implemented in M10 as a presentation-only pass: no record,
rule or story change.

## The look in one line

A storybook mountain painted in gouache: soft rounded forms, warm light and cool saturated shade,
a soft halo on every edge, haze that turns distance blue-violet, and a cold-pressed paper grain
over everything.

## What we take from Little Devil Inside, and what we don't

| Take | Leave |
| --- | --- |
| Chunky, readable silhouettes; a hooded hero with a simple face | Its specific characters, creatures or UI |
| Painterly, banded light with a soft terminator | Hard cel outlines |
| Earthy, slightly desaturated palette lifted by a few warm accents | Grimdark tones; Ascent stays gentle |
| Big sculpted cumulus clouds | Volumetric or photographic skies |
| Lived-in props that tell you who lives there | Clutter without a reason |

## The system

- **One shading model** (`src/game/style.ts`): the Lambert term is replaced for every world
  material with wrapped diffuse, a painted terminator and highlight band, a fresnel rim toward the
  light, and cool, slightly saturated indirect light. Changing it changes the whole world at once.
- **Smooth forms**: terrain, range and organic props use smooth normals with per-vertex painted
  colour (blotches of lush green, dry ochre, warm earth path). Stones are welded, noise-pushed
  icospheres with moss on top. Only distant cones and a few hard props stay faceted.
- **Paper**: a CSS grain and vignette over the canvas (`.paper`), no extra render pass.
- **Palette** (`src/game/sky.ts` stops): teal-blue nights that never go black, a moss-dark ground
  colour by night so shapes read, honey golden hours, cream horizons, violet cloud shade.

## Clouds

`src/game/clouds.ts`: each cloud is 7 to 10 round puffs on a flat base, one instanced mesh with
its own shader: lit side toward the sun, violet shade, a darker belly, a silver or golden lining
near the light, horizon haze with distance. They swell in and shrink away as cover changes.

## Camp: everything has a reason to be where it is

| Zone | What | Why there |
| --- | --- | --- |
| Hearth | Stone ring, logs leaned in a cone, painted flames, smoke, kettle on a flat stone at the edge | Warm without boiling; smoke shows the wind |
| Ari's place | Her log; pack on her right (flask rides in it); bread and apples on a cloth on her left | In reach while she sits |
| Toward the heat | Mittens drying on a stick | Wet gear dries by the fire |
| Your place | Log and cup across the fire (kit.ts) | Facing her |
| Tent | Ridge tent, door to the fire, bedroll inside, boots outside, poles leaned on the pole, guy lines and pegs | Shelter behind her, out of the wind |
| Woodshed | Chopping stump with the hatchet in it, chips | Off to the side, away from the tent |

Earned improvements (windbreak, lantern, woodpile, pennants, bench, tarp, chime) still arrive by
story day and keep their places.

## Night: light that belongs on a mountain

1. The fire, the warm key light, with shadows.
2. The tent's candle: the inside warms and a soft glow spills from the door.
3. Ari's own lamp or headtorch (Setup choice).
4. The camp lantern, once built: lit dusk to dawn with a small real light.
5. Fireflies on warm, dry nights.
6. Moon and starlight: a cool key, lifted so shapes read.
7. The Ninth Hut's beacon on the summit.

## Life

`src/game/fauna.ts`, presentation only, never in reduced motion:

- **Butterflies**: warm, still, dry days in spring and summer; they wander, settle, open and
  close their wings.
- **Birds**: a loose flock crosses high now and then by day.
- **Rabbit**: soft hours; hops across the meadow beyond Ari, nibbles, sits up to listen.
- **Deer**: dawn and dusk at the forest edge, grazing, lifting its head, ears turning.
- **Grass and flowers**: painted tufts and five-petal flowers sway in the shared wind, sink under
  snow, and the flowers close at dusk and in rain.

## Ari

- Two warm eyes in the shadow of the hood. They blink (sometimes twice) and droop when she is
  tired (the water record's fatigue).
- She glances about when idle and follows a butterfly or a rabbit when one comes by. Her eyes
  lead the head.
- She keeps her existing acts: warm, tend, shade, stars, catch, drink, stretch.

## Budget

Mid-range 2026 phone: grass 10 blades a tuft, scaled by quality tier. Clouds are one draw call
(about 70k triangles). Fauna is a few hundred triangles plus two instanced draws. One extra point
light (the lantern) at intensity 0 until it is built and dark.

## Next, if wanted

- New idle acts: eating an apple, pouring from the kettle.
- A hood tassel on a spring; a cloth cape with secondary motion.
- Hand-painted textures for the tent and ground (needs an asset budget decision).
