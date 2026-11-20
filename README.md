# ParliBot

A free local parliamentary debate practice room for two partners. Set a motion, prep together, debate an AI opposition, and review your speaking and case afterward.

## Start

Requires Node.js 22+ and [Ollama](https://ollama.com/) with at least one local chat model. No npm dependencies or API key.

```sh
cd parliBot
# Terminal 1, if Ollama is not already running:
ollama serve
# Terminal 2:
npm start
```

Open **http://127.0.0.1:3210**. For example, install a local model with `ollama pull llama3.2`. It is a small model, not a validated world-champion opponent. The model picker lists local models, so a stronger installed model can be selected without changing the app.

## Local voice setup

On macOS, build the on-device speech helper once with `npm run setup:voice` (requires Apple command-line developer tools). Click **Test mic**, then approve microphone and speech-recognition access yourself. Use headphones. Actual transcription and audible playback still require a live user test. Typed practice remains available.

## Practice flow

1. Enter a resolution, your side, your two speaker names, a judge paradigm and a difficulty.
2. Adjust prep and all six speech clocks. Defaults are 20-minute prep and 7/8/8/8/4/5-minute speeches. Custom values are practice settings, not changed tournament rules.
3. Test the microphone and review the visible transcription before beginning. Headphones prevent the microphone from hearing the AI voice.
4. Start prep, work through the milestones, and keep notes private from the AI opponent.
5. Start each speech deliberately. Give a nonargumentative off-time roadmap (up to 15 seconds), arm the speech timer, then speak. The timer begins on detected speech activity, with a manual fallback.
6. Offer/accept/decline points when available. Manually end each speech and move to the next. Zero shows overtime instead of cutting you off.
7. End the round to receive a coach review. Correct recognition errors before asking for another review. Export your transcript and feedback if wanted.

## Rules and points

- **POIs:** constructives only, outside the first and last minute. The speaker can accept or decline. Accepted questions last at most 15 seconds and the speech clock continues. The answer is part of the speaker’s speech, not a second 15-second question window.
- **POOs:** rebuttals only, for alleged new arguments. Speech clock pauses for an explanation up to 15 seconds and response up to 15 seconds, then resumes. No mid-round judge ruling.
- **POCs:** separate points of clarification are an optional custom-practice feature, not represented as authorized by CHSSA's reviewed parliamentary rules.
- **Rebuttals:** no new arguments/responses, except PMR may respond to new MOC arguments. New analysis of earlier arguments is allowed.
- **Roadmaps:** maximum 15 seconds off time, nonargumentative. Thank-yous count as speech. Speech detection is an estimate, not a certified timing system.

The [John Lewis SVUDL 2026 invitation](https://www.tabroom.com/index/tourn/main.mhtml?tourn_id=39924) specifies November 20–22, online debate through NSDA Campus and CHSSA parliamentary rules. [CFL's membership code](https://www.coastforensicleague.org/league-rules/membership-code) adopts CHSSA event rules with an NSDA evidence-rule exception. Official tournament updates and judge instructions should be checked separately.

## Coaching and limitations

The coach selects public transcript entries for case-review questions about burden, evidence, causal mechanisms, solvency, clash, weighing, organization and rules. The server supplies transcript excerpts, three suggested drills and a revision scaffold. It does not produce a judge ballot, rubric score, readiness verdict or acoustic assessment. This deliberately trades free-form personalized evaluation for a constrained review format after real testing exposed an unsupported delivery judgment. Model-selected targets can still be irrelevant or unhelpful and require your judgment.

Speaking metrics are only meaningful to the extent their source is measured. Words per minute requires measured speaking time. A transcript alone cannot establish confidence, tone, pronunciation or volume. Recognition mistakes can look like delivery mistakes. Typed notes are not an audio recording.

AI responses can be wrong. There is no live evidence search or automatic fact verification. Never treat a generated statistic or citation as verified. Champion is a difficulty setting that asks for stronger reasoning, not a benchmarked equivalence to current champions. No tournament recordings are bundled or used for training.

## Privacy

The app server binds to loopback. Local model requests go to Ollama on this Mac. Private prep notes are excluded from opponent prompts. No raw audio is saved by default. Transcript export is opt-in. Keep this server local, not publicly exposed.

On-device speech recognition requires macOS support and explicit permissions. An optional browser speech-recognition mode may send audio to the browser vendor and must not be described as offline. Typed transcript entry is available if voice permissions or recognition are unavailable.

**Practice only.** CHSSA restricts communications and electronic materials during actual rounds, including prep. This app's AI coaching is not permission to use AI assistance at a tournament.

## Development

```sh
npm test
```

- `public/engine.js`: deterministic timers, speech sequence, parliamentary point rules
- `public/app.js`, `public/views.js`, `public/styles.css`: practice interface
- `public/audio.js`, `native/`, `server/speech.js`: voice lifecycle and local recognition
- `server/index.js`, `server/model.js`: local server and inference transport
- `server/prompts.js`, `server/coaching.js`: debate policies and measured feedback
- GitHub issues: verification gaps and known limitations



Optional browser checks require an installed Playwright package and Chrome. Set `PLAYWRIGHT_MODULE` to its module path if it is not in local dependencies. With the server running, `node tests/browser.acceptance.mjs` tests the six-speech workflow with synthetic model/audio adapters. `node tests/browser.local-smoke.mjs` instead uses the real installed model and local synthesis with muted audio. Neither records the microphone.


### Optional real full-round verification

With the application server and a supported local Ollama model running, run:

```sh
node tests/browser.local-round.mjs
```

This requires Playwright and installed Chrome. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path when it is not locally resolvable. The test uses six short speech slots, real inference and local synthesis, typed human contributions, automatic coaching and a session download. Audio is muted and no microphone permission is requested. A passing run verifies the functional workflow, not the factual quality of model feedback. Real testing found an unsupported delivery judgment despite the text-only coaching policy. Treat qualitative feedback as unverified practice suggestions, never an acoustic assessment or a certified ballot.
