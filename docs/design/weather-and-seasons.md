# Weather, seasons and time of day

How the world looks and how Ari responds, for every combination. Code: `src/game/conditions.ts`
(what the day is), `src/game/stage.ts` (`applyLight`, `tendWeather`, `ambient`),
`src/game/weather.ts` (what falls and floats), `src/game/ari.ts` (her light and shelter),
`src/prototype/feel3d/climber.ts` (`dress`). Decisions G-53 to G-60.

## 1. From the record to the sky

The chain is **canon → season → kind**:

- The **canon** comes from the record: the last ended week's verdict. It only says how hard the
  day is.
- The **season** comes from the calendar (northern, 28° N).
- The **kind** is what the world shows.

A calm canon varies by day, from the date alone (same all day, on every device).

| Canon (record) | Spring | Summer | Autumn | Winter |
|---|---|---|---|---|
| clear (climb, summit, or this week secured) | clear | dry ×2, clear | clear ×2, windy | clear (snow lying) |
| calm (no verdict yet, rest, sick) | cloudy, showers, clear, cloudy | cloudy, clear, dull, dry | dull, fog, windy, cloudy | dull, cloudy, fog, clear |
| snow (hold) | showers or rain | rain | rain or windy | snow |
| storm (slip) | thunder | thunder | gale | blizzard |

Rules:

- A good week is never wet.
- It never snows in summer.
- Rest and sick days are always calm, so weather never blames illness or rest.

## 2. Each kind

| Kind | Cloud | Wind | Falls | Haze | Ground | In the air |
|---|---|---|---|---|---|---|
| clear | few | light | – | – | season's colour | season's motes |
| dry | none | light | – | warm haze | sunburnt | pollen |
| cloudy | broken | moderate | – | slight | – | season's motes |
| dull | overcast, flat light | light | – | grey | damp | – |
| fog | low | still | – | thick, short view | damp | – |
| windy | broken, racing | strong gusts | – | – | – | leaves in autumn |
| showers | heavy cloud | moderate | rain comes and goes over minutes | some | wet, puddles | – |
| rain | overcast, darker | moderate | steady rain | some | wet, puddles | – |
| thunder | black | strong | heavy rain, lightning and thunder | some | soaked, puddles | – |
| gale | overcast | very strong | driven rain | some | wet | leaves |
| snow | heavy | moderate | snowfall | some | snow on every upward face | – |
| blizzard | black-white | very strong | driving snow, short view | thick | deep snow | – |

**Seasons add their colour:**

- Spring: fresh green ground, pale bushes, petals.
- Summer: gold-green ground, olive bushes, pollen in the low sun, fireflies on warm, dry nights,
  crickets.
- Autumn: ochre ground, rust bushes, falling leaves.
- Winter: bare brown under lying snow.

## 3. With the time of day

The sun follows the clock. The sky's colours, the key light and its shadow, the fog and the stars
follow the sun's elevation, continuously.

| Band | Sun | Clear | Overcast, rain, snow |
|---|---|---|---|
| Night | below −10° | Stars and the Milky Way wheel about the pole. The real moon (when up) lights the land as much as it is full. Ari's light is on. Low camp camera. | Clouds hide the stars. A dark, close fog. Her light matters most. |
| Blue hour | −10° to −2° | Deep blue and violet. The first stars. Her light comes on. | Grey-blue, early dark, light on. |
| Golden hour | −2° to 16° | Honey-gold light and long shadows. Rays fan in the sky round the sun. Soft god-ray beams cross camp. A rim of sun along her edges. Low camp camera, swung toward the sun. Pollen glints in summer. | Muted, only a warm band low on the horizon. Rain or snow catches it. |
| Day | above 16° | Bright, high, short shadows. Birds. | Flat light, darker under storm cloud. No birds. |

Lightning flashes light the land and the sky for a moment. Thunder follows by distance (sound
travels about 340 m a second).

## 4. Ari's answers

**Clothes** (`outfitFor`):

| When | She wears |
|---|---|
| Rain over 0.3 | A yellow rain shell: a cape over her and the pack, hood included |
| Cold 0.6 and over, or any snow | A parka (bulkier, dark red, a fur ruff round the hood) |
| Heat 0.6 and over | A light shirt with rolled sleeves, no scarf; a straw hat over the hood in strong sun |
| Cold 0.45 and over | A thicker scarf and bigger mitts |
| Otherwise | Her coat |

**Camp** (`shelterFor`):

| When | Camp |
|---|---|
| Rain or snow falling | A sheet over her bag and the woodpile. The flask moves to the log beside her, in view. |
| Heavy rain, or a blizzard | A rain fly over her seat |
| Falling, or strong wind | The tent door laced shut |
| Strong wind with the fly up | Stones on the fly |

**Her light after dark:**

- Lantern: in her hand on the trail, on the ground beside her at camp, swinging as she walks.
- Headlamp: the beam goes where she looks.
- Glow stick: on her strap. She cracks and shakes it to light it.

The choice is made in Setup and kept per device. She lights it as it gets dark, earlier under
storm cloud or in fog.

**Routine** (between your visits, weighted by the weather and the light):

| When | She |
|---|---|
| Cold or a low fire | Warms her hands |
| Rain or snow | Shakes off the rain or brushes snow from her shoulders |
| A hot afternoon | Fans herself, gets a touch thirstier (presentation only) |
| The golden hour, with the sun ahead or to the side | Shades her eyes toward the sun |
| A clear night | Leans back and looks up at the stars |
| Fireflies or petals | Reaches for one |
| Near thunder | Flinches, then looks up |
| Any time | Tends the fire, checks the route |

**On the trail:**

- Head down into rain, shoulders into a gale.
- The lantern is held a little out in front.

**When you shake the phone** (opt-in, Setup):

- The world: snow or petals swirl, a gust bends the trees, her lantern swings, the fire throws
  sparks, the camera jolts.
- Ari steadies herself, then looks at you.

**Seen and unseen changes:** a change of weather that happens while you watch plays as a scene
(she pulls the cape on, covers the bag, lights the lamp). One that happens elsewhere (another
screen, reduced motion, at load) is simply done.

## 5. Checking it

The Environment Lab (Setup → You → The world → "Preview time, season and weather", or `?lab`)
has sliders for the following, and writes nothing:

- the time of day (with presets for dawn, golden, dusk, blue, night and noon);
- the season;
- the weather, any of the twelve kinds;
- the moon, any day of its cycle;
- plus a Shake button.

The readout shows the frame time, the quality tier, the sun's elevation and the season and kind.
