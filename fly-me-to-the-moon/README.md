# Fly Me to the Moon

Draw someone. Then they wake up.

Your doodle crunches into a pixel sprite, hops off the page, tells you who they are and why the moon matters to them, and asks: **"Can you bring me to the moon?"** You answer **"But how...?"**, and from then on you steer them — through six retro arcade levels, two drawing emergencies, and a landing — while they talk to you the whole way. When you get there they say **"Thank you for flying me to the moon. This is so beautiful."** and you watch the Earth rise from the moon. The end.

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

## Traits are the difficulty settings

Every trait carries a **power**, and each power is a real number the levels read:

| Power | What it governs |
| --- | --- |
| `steady` | timing and nerve — the launch spark, the landing fuel |
| `agile` | handling — how sharply your character turns, how fast they move |
| `clever` | reading ahead — slower whale notes, fatter zaps |
| `lucky` | second chances — a free retry, more stars, less junk |
| `heart` | getting along with whatever lives out there — the whale's patience |

A strength adds `+1` to its power, a weakness subtracts `1`. The briefing before each level spells out what your character's sheet is doing to that level ("the gold zone is tiny and the spark races"), so the link between the doodle and the difficulty is never hidden.

## The trip

| Beat | View | What you do | Powers read |
| --- | --- | --- | --- |
| Wake up | cutscene | The doodle pixelates, hops off the page, and asks for your help | — |
| Lift-off | side | Stop a sweeping spark in the gold zone to light three engine stages | steady, lucky |
| Emergency sketch | — | Draw them something to fix the snapped engine; the AI judges it | — |
| Sky dash | behind | Steer them around storm clouds over a cloud-sea checkerboard, grab stars | agile, lucky |
| Whale song | front | Three-lane rhythm game: hit each note as it lands on its ring | heart, clever |
| Refuel | side | Catch fuel cans falling from a station, dodge the junk (this one heals) | agile, lucky |
| Rock blaster | behind | Steer and zap asteroids over a neon grid while the moon rises | agile, clever |
| Emergency sketch | — | Draw a replacement for the lost landing scanner | — |
| Moon landing | side | Classic lander: hold to thrust, drift onto the flashing pad | steady, agile |
| The end | cutscene | The thank-you, then Earth rising over the moon, then THE END | — |

Each level scores you out of 100 and turns that into an HP swing on a per-level range. Then your character tells you how it went, in their own voice, using the facts the game hands the AI. The AI never decides the outcome, so what they say can't contradict what your hands did. Run out of HP and they drift off among the stars, asking to try again.

## How it's put together

```
server.js           The backend. Holds your API key, talks to the AI, validates its answers.
public/index.html   Every screen: draw, manual, wake-up, sheet, briefing, level, level clear, sketch, finale.
public/style.css    The 8-bit look.
public/retro.js     The pixel renderer: 192x144 canvas, 16-colour palette, bitmap font, pseudo-3D floor,
                    input, and the code that turns the doodle into an outlined pixel sprite.
public/minigames.js The six levels, plus the wake-up, finale, and game-over cutscenes.
public/game.js      Game state, the level list, trait maths, the dialogue box, and the flow between screens.
```

The server has three routes:

- `POST /api/character` takes the drawing and returns `{ name, hp, personality, intro, reason, traits }`, where each trait has a `power`.
- `POST /api/beat` takes the level id, your score, and a list of plain facts, and returns `{ headline, outcome }` spoken by the character to you. No numbers come back from the model.
- `POST /api/repair` takes a sketch and returns what it sees, a score, an HP change, and the character's reaction.

Every AI answer passes through a cleaning step that clamps numbers, trims text, and checks shapes. If an AI call fails for any reason (bad key, rate limit, slow Wi-Fi), the server quietly serves built-in content instead, so the game never freezes during a demo.

## Easy things to change

- **The trip itself:** `LEVELS` at the top of `public/game.js` — reorder beats, change the HP range each one can swing, drop one out.
- **What the character says:** each level's `line` in `public/minigames.js`, the wake-up lines in `wakeUp()`, and `FINAL_LINE` in `public/game.js`.
- **What a trait does to a level:** `POWER_NOTES` in `public/game.js` (the words) and the `stats` reads inside each level (the rules).
- **Difficulty:** `band` in `liftoff`, the `runner` config in `sky` and `rocks`, `travel`/`win` in `whale`, `junkChance` in `refuel`, `gravity`/`thrust`/`maxFuel` in `lander`.
- **The palette:** `P` in `public/retro.js` and the matching variables at the top of `public/style.css`.
- **Point budget for manual characters:** `POINT_BUDGET`, `BASE_HP`, and `HP_PER_POINT` in `public/game.js`.
- **Tone of the writing:** the `TONE` line and the prompt functions in `server.js`.
- **A new level:** add an entry to `MINIGAMES` with `run(ctx)` returning `{ score, facts }`, then list it in `LEVELS`.
- **A new AI provider:** write one function like `askGemini` and add it to `PROVIDERS`.

## Demo day checklist

- Play through twice with your real key the night before.
- Free tiers have per-minute limits. If several judges will play at once, have a second key or provider ready in `.env`.
- If the venue Wi-Fi fails, set `AI_PROVIDER=mock` and the whole game still works.
- Draw something funny live. The moment it hops off the page and asks for help is the one people remember.
- Levels take a pointer or a finger; the arrow keys, Space, and 1/2/3 work too.

## Hosting it online

Because this has a small Node server, host it somewhere that runs Node, such as Render or Railway. Set your key as an environment variable in their dashboard rather than uploading `.env`. Moving to Vercel or Netlify would mean turning the three routes into serverless functions.
