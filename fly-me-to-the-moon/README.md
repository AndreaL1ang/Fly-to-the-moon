# Draw Me to the Moon

Draw someone. Then they wake up.

Your doodle crunches into a pixel sprite, hops off the page, and asks: **"Can you get me to the moon?"** You balance their wobbly launch, draw a road through orbit, play one goofy space duet, and draw the invention that gets them onto the moon.

Everything is drawn at 192×144 in a 16-colour palette and blown up with crisp pixels. Your character is always on screen: you are not the pilot, you are the one flying *them*.

## Run it (5 minutes)

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to `npm install`.

1. Open a terminal in this folder.
2. Run `node server.js`
3. Open http://localhost:3000

That's it. With no API key, the game runs in **demo mode** using built-in characters and lines, so you can play and build the UI right away.

## Turn on the AI (free)

1. Get a free Gemini key at [Google AI Studio](https://aistudio.google.com/apikey). No credit card needed.
2. Copy `.env.example` to a new file called `.env`.
3. Paste your key after `GEMINI_API_KEY=`.
4. Check your AI Studio dashboard for which Flash model is free on your account, and put its name in `GEMINI_MODEL` if it differs from the default.
5. Restart the server. The footer will say `AI provider: gemini`.

To use Groq instead, get a free key at [console.groq.com](https://console.groq.com/keys), set `AI_PROVIDER=groq`, and fill in `GROQ_API_KEY`.

Keep `.env` private. It's already in `.gitignore`, so it won't be pushed to GitHub.

## Every character gets their own trip

The launch vehicle and space singer come from the character's story. A dog-loving doodle might wobble away in a cardboard kennel and howl with a moon hound.

A character going to the moon for their dog Rocket might launch in Rocket's old cardboard kennel, chase seagulls for dog biscuits, howl back at a moon hound, and catch bones thrown from the Space Pound. The character sheet shows the trip ("Your trip") before you fly it.

The AI can't draw, so it picks from a fixed library of pixel art in `public/themes.js` (22 icons, 6 singing creatures, 5 vehicles, sky and ground styles) and names each piece to fit. The server rejects a world that's mostly stock pieces. With no AI, or if the call fails, the server themes the trip from keywords in the character's story instead (dogs, grandmothers, the sea, music, baking…), and the built-in characters have hand-made trips.

## The trip

| Beat | View | What you do | Powers read |
| --- | --- | --- | --- |
| Wake up | cutscene | The doodle pixelates, hops off the page, and asks for your help | — |
| Wobble launch | side | Balance a wildly unstable homemade rocket | pointer / arrow keys |
| Orbit painter | map | Draw one flight path through star rings and around planets | freehand drawing |
| Space duet | front | Play one short rhythm game with a character from their story | timing |
| Draw the landing | — | Add something that helps them land; the AI judges the idea | imagination |
| The end | cutscene | The thank-you, then Earth rising over the moon, then THE END | — |

Each level scores you out of 100 and turns that into an HP swing on a per-level range. Then your character tells you how it went, in their own voice, using the facts the game hands the AI. The AI never decides the outcome, so what they say can't contradict what your hands did. Run out of HP and they drift off among the stars, asking to try again.

## How it's put together

```
server.js           The backend. Holds your API key, talks to the AI, validates its answers.
public/index.html   Every screen: draw, manual, wake-up, sheet, briefing, level, level clear, sketch, finale.
public/style.css    The 8-bit look.
public/retro.js     The pixel renderer: 192x144 canvas, 16-colour palette, bitmap font, pseudo-3D floor,
                    input, and the code that turns the doodle into an outlined pixel sprite.
public/themes.js    The art library the AI themes each trip from: icons, singers, vehicles, skies, floors.
public/minigames.js The three playable challenges, plus the wake-up, finale, and game-over cutscenes.
public/game.js      Game state, the journey, the dialogue box, and the flow between screens.
```

The server has four routes:

- `POST /api/character` takes the drawing and returns its name, HP, personality, and reason for visiting the moon.
- `POST /api/world` takes the character and returns their themed trip, built only from pieces in `themes.js`.
- `POST /api/beat` takes the level id, your score, and a list of plain facts, and returns `{ headline, outcome }` spoken by the character to you. No numbers come back from the model.
- `POST /api/repair` compares the character before and after the landing doodle and returns what changed, a score, and the character's reaction.

Every AI answer passes through a cleaning step that clamps numbers, trims text, and checks shapes. If an AI call fails for any reason (bad key, rate limit, slow Wi-Fi), the server quietly serves built-in content instead, so the game never freezes during a demo.

## Easy things to change

- **The trip itself:** `LEVELS` at the top of `public/game.js` — reorder beats, change the HP range each one can swing, drop one out.
- **What the character says:** the themed `line`s come from the AI; the fallbacks are `DEFAULT_WORLD` in `public/themes.js`. The wake-up lines are in `wakeUp()` and `FINAL_LINE` is in `public/game.js`.
- **New art for themed trips:** add a drawing to `ICONS`, `SINGERS` or `VEHICLES` in `public/themes.js`, and its name to `WORLD_VOCAB` in `server.js` so the AI can pick it.
- **Story clues for the no-AI fallback:** `WORLD_CLUES` and `KEEPSAKE_CLUES` in `server.js`.
- **Difficulty:** tune the wobble physics and duration in `wobble`, the path scoring in `orbit`, and note timing in `whale`.
- **The palette:** `P` in `public/retro.js` and the matching variables at the top of `public/style.css`.
- **Point budget for manual characters:** `POINT_BUDGET`, `BASE_HP`, and `HP_PER_POINT` in `public/game.js`.
- **Tone of the writing:** the `TONE` line and the prompt functions in `server.js`.
- **A new level:** add an entry to `MINIGAMES` with `run(ctx)` returning `{ score, facts }`, then list it in `LEVELS`.
- **A new AI provider:** write one function like `askGemini` and add it to `PROVIDERS`.

## Demo day checklist

- Play through twice with your real key the night before.
- Free tiers have per-minute limits. Groq's free tier allows about 1,000 output tokens a minute, which is roughly one new character plus their trip. The server waits out a limit and retries once. If several judges will play at once, have a second key or provider ready in `.env`.
- If the venue Wi-Fi fails, set `AI_PROVIDER=mock` and the whole game still works.
- Draw something funny live. The moment it hops off the page and asks for help is the one people remember.
- Levels take a pointer or a finger; the arrow keys, Space, and 1/2/3 work too.

## Hosting it online

Because this has a small Node server, host it somewhere that runs Node, such as Render or Railway. Set your key as an environment variable in their dashboard rather than uploading `.env`. Moving to Vercel or Netlify would mean turning the four routes into serverless functions.
