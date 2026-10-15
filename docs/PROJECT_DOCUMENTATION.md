# Microcontroller AI Lab - Technical Documentation

Detailed report on what the project is, how it is built, how each part works
and the engineering decisions behind it.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Technology stack](#2-technology-stack)
3. [High-level architecture](#3-high-level-architecture)
4. [Repository layout](#4-repository-layout)
5. [The shared-module design (UMD)](#5-the-shared-module-design-umd)
6. [Frontend in detail](#6-frontend-in-detail)
7. [Backend in detail](#7-backend-in-detail)
8. [Circuit validation engine](#8-circuit-validation-engine)
9. [Simulator](#9-simulator)
10. [Code generator](#10-code-generator)
11. [AI integration](#11-ai-integration)
12. [Usage, cost and balance tracking](#12-usage-cost-and-balance-tracking)
13. [API reference](#13-api-reference)
14. [Configuration reference](#14-configuration-reference)
15. [Data models](#15-data-models)
16. [Security design](#16-security-design)
17. [Error handling](#17-error-handling)
18. [How to run, extend and test](#18-how-to-run-extend-and-test)
19. [Design decisions](#19-design-decisions)
20. [Known limitations and recommended improvements](#20-known-limitations-and-recommended-improvements)

---

## 1. Project overview

**Microcontroller AI Lab** is a browser-based electronics learning platform. A
student:

1. picks a board (Arduino Uno R3 or ESP32 DevKit V1);
2. picks a lesson (LED Blinking, Push Button, DHT11 Sensor);
3. drags components (board, LED, resistor, push button, DHT11) onto an SVG
   workspace and draws wires between pins;
4. validates the circuit with a deterministic rule engine;
5. asks an AI tutor to explain, generate code or troubleshoot;
6. generates Arduino-style code from the real pins used in the circuit;
7. runs a lightweight in-browser simulation of the supported behaviour;
8. monitors AI API token usage, spend and credit balance on a dashboard.

The central principle is a **separation of responsibility**:

| Concern | Decided by | Never decided by |
| --- | --- | --- |
| Is the circuit valid? | The deterministic validator | The AI |
| Which pins/voltages does a board have? | The board registry | The AI or the browser |
| Explaining, tutoring, troubleshooting | The AI (Claude) | - |
| Whether code "works" | Not claimed; the simulator models a small subset | The AI |

The app is a learning prototype. It is not a compiler, an electrical simulator
or a firmware emulator, and says so in the UI.

---

## 2. Technology stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend | HTML5, CSS3, vanilla JavaScript (ES5 style) | No framework, no bundler |
| Graphics | Inline SVG | Components, pins, wires, LED glow |
| Backend | Node.js 18+, Express 4.19 | Uses Node's built-in `fetch` |
| Config | `dotenv` | The only other dependency |
| AI | Anthropic Messages API (default) | OpenAI-compatible Chat Completions also supported |
| Provider usage | Anthropic Admin Usage and Cost API | Needs an Admin key |
| Storage | One JSON file (`backend/data/usage.json`) | No database |

There are no automated tests; verification is manual (see section 18).

---

## 3. High-level architecture

```
+------------------------------ Browser -------------------------------+
|  index.html                                                          |
|  app.js (orchestrator, shared state "Lab", event bus)                |
|   |-- canvas.js        SVG rendering, dragging, zoom/pan             |
|   |-- wires.js         wire drawing, colours, routing handles        |
|   |-- circuit-validator.js   (shared with backend)                   |
|   |-- simulator.js     LED / button / DHT11 simulation               |
|   |-- code-editor.js   code generation + explanations                |
|   |-- ai-client.js     chat UI  ----------------------+              |
|   |-- usage-dashboard.js  usage UI --------------+    |              |
|  board-registry.js, components.js, lessons.js     |    |  (shared)    |
+---------------------------------------------------|----|-------------+
                                                    |    |
                              HTTP JSON (/api/...)  v    v
+------------------------------ Express backend --------------------------+
| server.js: CORS -> JSON (256kb) -> logger -> static(frontend) -> /api    |
|   routes -> controllers -> services                                      |
|   ai.service.js ---------> Anthropic /v1/messages (x-api-key, server-side)|
|   circuit.service.js ----> requires frontend circuit-validator.js        |
|   usage.service.js ------> backend/data/usage.json (app-tracked usage)   |
|   provider-usage.service.js -> Anthropic Admin usage_report / cost_report|
|   middleware: errors.js, local-only.js                                   |
+--------------------------------------------------------------------------+
```

Key flows:

- **Validation** runs in the browser for instant feedback and again on the
  server (same code) before any AI call.
- **AI requests** go browser -> backend -> provider. The browser never sees the
  API key.
- **Usage dashboard** reads `/api/usage/*`. The backend merges provider-reported
  and application-tracked data and returns them separately.

---

## 4. Repository layout

```text
Full Stack AI BootCamp/
|-- README.md                   user-facing setup and overview
|-- Plan.txt                    original specification (670 lines)
|-- package.json                root scripts delegating to backend
|-- docs/PROJECT_DOCUMENTATION.md   this document
|-- frontend/
|   |-- index.html              layout: Lab view and Usage view
|   |-- css/styles.css          theme and layout
|   `-- js/
|       |-- board-registry.js   board data, pin capabilities  (shared)
|       |-- components.js       component catalogue + board defs (shared)
|       |-- lessons.js          lesson definitions               (shared)
|       |-- circuit-validator.js deterministic validation        (shared)
|       |-- canvas.js           SVG workspace
|       |-- wires.js            wire interaction
|       |-- simulator.js        simulation engine
|       |-- code-editor.js      code generation
|       |-- ai-client.js        tutor chat client
|       |-- usage-dashboard.js  usage dashboard UI
|       `-- app.js              orchestrator and shared model
`-- backend/
    |-- package.json
    |-- .env / .env.example
    |-- test-key.js             manual API-key checker
    |-- data/usage.json         generated, git-ignored
    `-- src/
        |-- server.js
        |-- config/board-registry.js     re-exports the frontend registry
        |-- routes/    (index, boards, ai, circuit, usage)
        |-- controllers/ (boards, ai, circuit, usage)
        |-- services/  (ai, circuit, usage, provider-usage)
        |-- middleware/ (errors, local-only)
        `-- utils/validate.js
```

---

## 5. The shared-module design (UMD)

Four frontend files are used by **both** the browser and the Node backend:
`board-registry.js`, `components.js`, `lessons.js` and `circuit-validator.js`.

Each file is a UMD-style IIFE:

```js
(function (global) {
  // ... module code ...
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CircuitValidator = api;
})(typeof window !== 'undefined' ? window : this);
```

- In the browser the script defines a global (`BoardRegistry`, `Components`,
  `Lessons`, `CircuitValidator`).
- In Node, `circuit.service.js` calls
  `require('../../../frontend/js/circuit-validator.js')`, and
  `backend/src/config/board-registry.js` re-exports the frontend registry.

**Why:** client and server can never disagree about pin capabilities or
validation rules. The server recomputes everything and never trusts the
browser's claims.

---

## 6. Frontend in detail

### 6.1 Page structure (`index.html`)

- **Top bar:** brand, tabs (Lab / AI API Key Usage), board selector, lesson
  picker, validation badge, simulator badge.
- **Lesson sub-navigation:** pills for the three lessons.
- **Lab view (three columns):**
  - left: component library, selected-board info, lesson guide;
  - centre: toolbar (validate, wire mode, wire colour, delete, clear, blink
    interval), the SVG workspace with zoom dock, status bar and validation
    panel;
  - right: tabs for AI Tutor, Code and Simulation.
- **Usage view:** range and model filters, key label, scope notes, cards,
  charts and a details table.

Script load order matters: registry, components, lessons, validator, wires,
canvas, simulator, code-editor, ai-client, usage-dashboard, then `app.js`.

`API_BASE` is `http://localhost:3000` when the page is opened from `file:` or a
dev server on port 5500 or 8080; otherwise API calls are same-origin.

### 6.2 Orchestrator and shared state (`app.js`)

`app.js` builds one object, `Lab` (exported as `window.Lab`), holding:

```js
Lab.state = {
  board: 'arduino-uno-r3',
  lesson: 'led',
  components: [ {id, type, x, y, properties} ],
  connections: [ {id, from: 'comp.pin', to: 'comp.pin', color?, dx?, dy?} ]
};
```

Other fields: `lastValidation`, `selectedComponentId`, `selectedWireId`,
`pendingRef`, `blinkInterval` (default 500).

Modules are created with `X.create(Lab)` and communicate through:

- a tiny **event bus** (`Lab.on` / `Lab.emit`) with events `state:changed`
  (reasons such as add, remove, connect, disconnect, move, board, lesson),
  `component:selected`, `board:changed`, `lesson:changed`;
- direct calls on `Lab` (`addComponent`, `removeComponent`, `addConnection`,
  `setBoard`, `setLesson`, `validate`, `buildAIContext`).

Rules enforced in the model:

- Only one board component may exist; adding another board type switches
  boards and drops wires whose pins no longer exist.
- Duplicate wires (either direction) and board-to-board wires are rejected.
- Removing a component also removes its wires.

Keyboard shortcuts: `W` wire mode, `Esc` exit wire mode, `+`/`-` zoom,
`Ctrl+0` reset zoom, `Delete`/`Backspace` remove selection.

### 6.3 Canvas (`canvas.js`)

- Renders every component as an SVG group translated to its position. Each type
  has a custom drawing: Uno, ESP32, LED (glows when `properties._on`), resistor
  (colour bands derived from the resistance value), push button (pressed
  state) and DHT11.
- Pins are drawn with a 13px transparent hit circle and a 5px visible dot.
  Colours indicate kind: ground, power, analog, anode, cathode, signal.
- Dragging stores the pointer offset and updates `x`/`y` (clamped to >= 0).
- Zoom 0.35x to 2.8x with the wheel (centred on the cursor); background drag
  pans; the base viewBox is 1400x900.
- Drop from the palette places a component under the cursor.
- The 25px grid is decorative; there is no snapping.

### 6.4 Wires (`wires.js`)

- Wire mode must be on. Click one pin, then another, to connect.
- Colour is automatic (ground dark, power red, signal blue) unless the user
  picks one of the colour chips.
- A wire is a cubic Bezier; once the user drags the selected wire's handle it
  becomes a quadratic curve through the waypoint (stored as `dx`/`dy`).
  Double-clicking the handle resets the route.
- Each wire has an invisible 16px hit stroke for easy selection and a delete
  marker when selected.

### 6.5 Components, boards and lessons

- **`components.js`** - catalogue of LED, resistor, button, DHT11 with pin
  coordinates and `internalBridges` (the button's two pins per side are
  internally connected). Board definitions are generated dynamically from the
  registry, so adding a board needs no new drawing code for pins.
- **`board-registry.js`** - single source of truth per board: platform, MCU,
  logic voltage, max pin current, digital/analog/PWM/power/ground pins,
  `pinInfo` (restrictions such as boot-strapping or input-only), default lesson
  pins, notes and an example sketch.
- **`lessons.js`** - lesson id, title, required components, default
  components with coordinates, concepts, simulator-supported operations and
  steps.

| Board | Logic | Digital pins | Default LED / button / DHT |
| --- | --- | --- | --- |
| Arduino Uno R3 | 5 V | D0-D13 | D8 / D2 / D7 |
| ESP32 DevKit V1 | 3.3 V | GPIO 2, 4, 5, 12-19, 21-23, 25-27, 32, 33 | GPIO2 / GPIO4 / GPIO15 |

ESP32 flash pins (6-11) are excluded; GPIO 34/35/36/39 are input-only.

### 6.6 AI client (`ai-client.js`)

Sends questions and actions to the backend, renders replies with a small
Markdown-lite renderer (HTML is escaped first, then code fences, inline code,
bold, italic, headings). Buttons are disabled while a request is in flight. It
includes suggestion chips and shows backend error messages to the user.

`Lab.buildAIContext()` sends board, lesson, circuit, last validation, current
code and blink interval. The backend replaces the board and validation with its
own authoritative versions.

---

## 7. Backend in detail

### 7.1 Request pipeline (`server.js`)

1. Hand-written CORS (`Access-Control-Allow-Origin: *`, GET/POST/OPTIONS).
2. `express.json({ limit: '256kb' })`.
3. Request logger (method, URL, status, ms - never bodies or headers).
4. `express.static(frontend/)` - the backend serves the frontend.
5. `/api` routes.
6. `notFound`, then `errorHandler`.

On start it loads saved usage records and prints configuration status.

### 7.2 Layers

- **Routes** map URLs to controllers. `/api/usage/*` is wrapped by `localOnly`.
- **Controllers** validate and shape requests/responses.
- **Services** hold logic: `ai.service`, `circuit.service`, `usage.service`,
  `provider-usage.service`.
- **Middleware**: `errors.js` (`AppError`, 404, central handler) and
  `local-only.js` (IP allow-list for usage routes).
- **`utils/validate.js`**: request validation and usage-range resolution.

### 7.3 Authoritative context (`ai.controller.js`)

Before any AI call the controller:

1. validates the body (question <= 2000 chars, `context.board.id` required);
2. looks the board up in the server registry (unknown board -> 400);
3. recomputes circuit validation with the shared validator;
4. replaces the client's board data with server capabilities;
5. truncates submitted code to 8000 characters.

The AI therefore receives facts the server verified, not what the browser
claimed.

### 7.4 Limits enforced

| Limit | Value | Error |
| --- | --- | --- |
| JSON body | 256 KB | 413 |
| Question length | 2000 chars | `QUESTION_TOO_LONG` 413 |
| Components per circuit | 200 | `CIRCUIT_TOO_LARGE` 413 |
| Connections per circuit | 400 | `CIRCUIT_TOO_LARGE` 413 |
| Code in AI context | 8000 chars | truncated |
| AI timeout | 30 s (configurable) | `AI_TIMEOUT` 504 |

---

## 8. Circuit validation engine

`circuit-validator.js` is deterministic and has no AI.

### 8.1 Electrical model: union-find nets

Every pin is a node. Wires union two nodes. Component `internalBridges` and
all board ground pins are also unioned. The result: pins in the same set share
an electrical **net**. Power rails stay separate because they can differ in
voltage. Checks then become simple net comparisons (for example "is the LED
cathode on the ground net?").

### 8.2 Validation stages

1. **Structural:** board configured, exactly one board, board matches the
   selection, wire endpoints exist, no self-wires, required lesson components,
   at least one wire. Structural errors stop analysis early.
2. **Global safety:** any GPIO connected directly to ground (`GPIO_SHORT`).
3. **LED stage** (LED and Button lessons) - for **each** LED:
   - anode and cathode not on the same net; anode not on ground;
   - cathode not on a GPIO;
   - find a driving pin by topology:
     - A: GPIO -> resistor -> anode, cathode -> GND (recommended);
     - B: GPIO -> anode, cathode -> resistor -> GND;
     - direct (no resistor) -> `LED_NO_RESISTOR` error;
   - resistor warnings below 100 ohm or above 10 kohm.
   - Results are listed in `info.leds` (id, pin, topology, resistor).
4. **Button stage:** the two sides must be on different nets, one on GND and one
   on a GPIO (INPUT_PULLUP pattern).
5. **DHT11 stage:** GND, VCC on a power pin, DATA on a GPIO, no shorts,
   3.3 V-board voltage warning, pull-up recommendation.

### 8.3 Output

```js
{ valid, board, lesson, errors: [{code, message}], warnings: [...],
  info: { pins: { outputPin, outputPins, inputPin, dataPin },
          topology, resistor, leds: [{id, pin, topology, resistor}] } }
```

`valid` is simply `errors.length === 0`. The same output feeds the UI panel,
the simulator, the code generator and the AI context.

---

## 9. Simulator

`simulator.js` does **not** compile or run code. It runs a structured model of
the lesson using the pins the validator resolved.

- Run is allowed only when the last validation passed.
- **LED lesson:** a timer toggles every blink interval; **all** LEDs found by
  the validator switch together and glow on the canvas.
- **Button lesson:** a virtual button (mouse or touch) simulates `INPUT_PULLUP`
  (pressed = LOW) and drives all LEDs.
- **DHT11 lesson:** sliders set temperature and humidity (defaults 28 C / 65 %)
  and a simulated reading is logged.
- A serial-style log is shown. Unsupported function calls found by the code
  analyser are listed and not pretended to run.
- Timers are cleared on stop, reset and lesson change.

---

## 10. Code generator

`code-editor.js` builds Arduino-style C++ from the validated circuit.

- Pin names are converted per board (D8 -> 8 on Uno, GPIO2 -> 2 on ESP32).
- With several LEDs it emits one constant per LED (`LED1_PIN`, `LED2_PIN`, ...),
  one `pinMode` each, and switches them together; with one LED it emits
  `LED_PIN`.
- Falls back to the board's default example pin when no valid circuit exists.
- Produces an explanation, a required-libraries list (DHT needs the Adafruit
  libraries) and the simulator-supported operations.
- `analyze()` scans code for function calls the simulator cannot model.

The generator is deterministic. The AI "generate code" button is a separate
path that asks Claude for code in a fenced block.

---

## 11. AI integration

All AI traffic goes through `ai.service.js`, the only module that talks to the
model.

### 11.1 Providers

| Aspect | Anthropic (default) | OpenAI-compatible |
| --- | --- | --- |
| Endpoint | `<base>/messages` | `<base>/chat/completions` |
| Auth | `x-api-key` + `anthropic-version: 2023-06-01` | `Authorization: Bearer` |
| System prompt | `system` field | first `system` message |
| Temperature | Sent only if set (newer Claude models reject it) | default 0.3 |
| Token fields | `usage.input_tokens/output_tokens` | `prompt_tokens/completion_tokens` |

### 11.2 Prompts

A shared **guardrail** system prompt tells the model to: act as a beginner
tutor; use only supplied board capabilities; never contradict the validator;
never claim code was compiled, uploaded or tested on hardware; separate facts
from suggestions; remember the simulator is limited. Feature-specific text is
added for `explain`, `generate-code` and `troubleshoot`.

The user message embeds a JSON block: board, lesson, circuit, validation
(valid, errors, warnings, resolved pins), code and blink interval.

### 11.3 Features

| Endpoint | Feature label | Returns |
| --- | --- | --- |
| `POST /api/ai/explain` | `explain` | `{reply}` |
| `POST /api/ai/generate-code` | `generate-code` | `{code, explanation, libraries}` |
| `POST /api/ai/troubleshoot` | `troubleshoot` | `{reply}` |

`parseCodeReply` extracts the first fenced code block, treats surrounding text
as the explanation and collects `#include` lines as libraries.

### 11.4 Error mapping

| Condition | Code | HTTP |
| --- | --- | --- |
| No API key | `AI_NOT_CONFIGURED` | 503 |
| Timeout | `AI_TIMEOUT` | 504 |
| Network failure | `AI_UNREACHABLE` | 502 |
| Provider 429 | `AI_RATE_LIMIT` | 429 |
| Other provider error | `AI_PROVIDER_ERROR` | 502 |
| Empty answer | `AI_EMPTY_RESPONSE` | 502 |

Every call except "not configured" is recorded in usage tracking.

---

## 12. Usage, cost and balance tracking

The dashboard has two distinct data sources that are never summed.

### 12.1 Provider-reported usage (overall)

`provider-usage.service.js`, enabled by `AI_USAGE_API_ENABLED=true` and an
**Admin API key** (`sk-ant-admin...`, organization accounts only).

- `GET /v1/organizations/usage_report/messages` - daily buckets grouped by model;
  input tokens = uncached + cache-read + cache-creation tokens.
- `GET /v1/organizations/cost_report` - amounts in cents, converted to USD.
- Both are paginated (`has_more` / `next_page`) so long ranges are complete.
- Reports **organization-level** usage: every app and tool on the account, not
  only this app.
- OpenAI-compatible fallback: `/organization/usage/completions`.

### 12.2 Application-tracked usage

`usage.service.js` records, for each AI call made through the backend:
timestamp, model, feature, input/output/total tokens, status and duration. It
stores no keys, headers or prompts.

- File: `backend/data/usage.json`, capped at 5000 records, written with a
  500 ms debounce.
- Cost is an **estimate** from a built-in per-model price table (USD per
  million tokens), counted only for successful calls.
- This covers only calls through this app.

### 12.3 Source selection

The dashboard shows provider-reported data when available ("authoritative"),
otherwise application-tracked data, and states which one is displayed.

### 12.4 Total amount and remaining balance

No provider exposes a prepaid-balance API, so the balance is computed:

```
remaining = max(0, AI_CREDIT_TOTAL - spend since AI_CREDIT_START)
```

Spend comes from the provider cost report when the Admin API works; otherwise
from the app-tracked estimate (labelled as such). If `AI_CREDIT_TOTAL` is
unset, the card shows "Not available".

### 12.5 Dashboard UI

Cards (input, output, total tokens, requests, success, failed, total spent),
a credit-balance group (total, spent, remaining and % left), charts (token
distribution, prompt/completion split, average tokens per call, activity
timeline, tokens by feature) and a details table. Filters: today, 7 days,
30 days, custom range and model.

### 12.6 Why other sessions do not appear

Usage from other tools (for example a coding assistant) is only visible if it
bills to the same Anthropic organization **and** the Admin key is configured.
The app cannot observe calls that never pass through its backend.

---

## 13. API reference

| Method | Path | Body / query | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | - | Service status |
| GET | `/api/boards` | - | Board capabilities |
| POST | `/api/circuit/validate` | circuit (or `{context:{circuit}}`) | Deterministic validation |
| POST | `/api/ai/explain` | `{question, context}` | Tutor answer |
| POST | `/api/ai/generate-code` | `{context}` | AI-generated code |
| POST | `/api/ai/troubleshoot` | `{context}` | Diagnosis |
| GET | `/api/usage/status` | - | Source configuration |
| GET | `/api/usage/summary` | `range, start, end, model` | Totals, balance |
| GET | `/api/usage/details` | same | Per-period rows |

Usage routes are localhost-only by default. Error format:

```json
{ "error": { "code": "AI_RATE_LIMIT", "message": "..." } }
```

Validation failures return HTTP 200 with `valid: false`; only malformed input
returns 4xx.

---

## 14. Configuration reference

All set in `backend/.env` (never committed).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | HTTP port |
| `AI_PROVIDER` | anthropic | Provider selection |
| `AI_API_KEY` | - | AI key (required for AI features) |
| `AI_BASE_URL` | https://api.anthropic.com/v1 | API base |
| `AI_MODEL` | claude-sonnet-4-5 | Model |
| `AI_TIMEOUT_MS` | 30000 | Request timeout |
| `AI_MAX_TOKENS` | 1024 | Per-request output cap (not a usage counter) |
| `AI_TEMPERATURE` | blank | Omitted when blank |
| `AI_USAGE_API_ENABLED` | false | Use provider usage API |
| `AI_USAGE_API_KEY` | - | Admin key |
| `AI_USAGE_BASE_URL` | Anthropic base | Usage API base |
| `AI_USAGE_SCOPE` | account | `account` or `key` label |
| `AI_CREDIT_TOTAL` | - | Credits purchased (USD) |
| `AI_CREDIT_START` | 1 year ago | Date to start counting spend |
| `USAGE_LOCALHOST_ONLY` | true | Restrict usage endpoints |

The server reads `.env` only at startup; restart after changes.

---

## 15. Data models

### 15.1 Circuit

```js
{
  board: 'arduino-uno-r3',
  lesson: 'led',
  components: [
    { id: 'board-1', type: 'arduino-uno-r3', x: 80, y: 140 },
    { id: 'led-1', type: 'led', x: 620, y: 180, properties: { color: 'red' } },
    { id: 'resistor-1', type: 'resistor', x: 470, y: 210, properties: { resistance: 220 } }
  ],
  connections: [
    { id: 'wire-1', from: 'board-1.D8', to: 'resistor-1.pin1' },
    { id: 'wire-2', from: 'resistor-1.pin2', to: 'led-1.anode' },
    { id: 'wire-3', from: 'led-1.cathode', to: 'board-1.GND' }
  ]
}
```

### 15.2 Usage record (`usage.json`)

```js
{ timestamp, model, feature, inputTokens, outputTokens, totalTokens,
  status: 'success' | 'failed', durationMs }
```

### 15.3 Summary response (`/api/usage/summary`)

```js
{ balance: { configured, available, total, spent, remaining, source, since },
  providerReported: { available, inputTokens, outputTokens, totalTokens, cost, ... },
  applicationTracked: { inputTokens, outputTokens, totalTokens, requests,
                        successful, failed, cost, rawCost, models },
  models: [...], period: { start, end }, lastUpdated }
```

---

## 16. Security design

- API keys live only in `backend/.env` (git-ignored) and are used server-side.
  The browser only ever sees a masked suffix label.
- The backend recomputes board capabilities and validation; the client is never
  trusted for them.
- AI output is constrained by guardrails and cannot override validation.
- Markdown rendering escapes HTML first (XSS protection for AI replies).
- Request size, question length and circuit size are limited; provider calls
  have timeouts; error details are hidden unless explicitly safe.
- Usage endpoints are restricted to loopback addresses; proxy headers are not
  trusted.
- Usage storage keeps metadata only, never prompts or credentials.
- No `eval` in the simulator.

---

## 17. Error handling

`AppError(code, message, status)` marks errors safe to expose. The central
handler returns `{ error: { code, message } }`, hides unexpected internal
messages, and logs only 5xx errors. The frontend surfaces backend messages in
toasts and chat bubbles, and AI failures do not break the rest of the app:
validation, deterministic code generation and simulation work without a key.

---

## 18. How to run, extend and test

### 18.1 Run

```bash
cd backend
npm install
copy .env.example .env      # then add AI_API_KEY
npm start                   # http://localhost:3000
```

`npm run dev` restarts on file changes; `npm run check-key` tests the API key.

### 18.2 Add a board

1. Add an entry to `frontend/js/board-registry.js` (pins, capabilities,
   restrictions, defaults, example code).
2. Optionally add a custom drawing in `canvas.js`.
3. No backend change is needed - the registry is shared.

### 18.3 Add a lesson

Add it to `lessons.js` (components, defaults, simulator support), add a
validation stage in `circuit-validator.js`, a generator branch in
`code-editor.js` and a simulation branch in `simulator.js`.

### 18.4 Testing

There is no automated test suite. Recommended manual checks:

- Build each lesson on each board; confirm validation passes/fails as expected.
- Break circuits deliberately (reverse LED, remove resistor, short to GND).
- Draw 3 LEDs on separate pins; confirm all validate, blink and appear in code.
- Stop the AI key / go offline; confirm graceful errors.
- Open the usage dashboard with and without an Admin key.

A validator can be unit-tested in plain Node because it is a UMD module:
`require('./frontend/js/circuit-validator.js').validate(state)`.

---

## 19. Design decisions

| Decision | Reason |
| --- | --- |
| Vanilla JS and SVG, no framework | Small footprint, easy for learners to read, no build step |
| Shared UMD modules | One source of truth for registry and validation |
| Deterministic validator, AI explains | Reliability; the AI cannot invent a "pass" |
| Backend proxy for AI | Keeps keys secret, enables limits and usage tracking |
| Server recomputes context | Defends against a tampered browser |
| Union-find nets | Simple, fast, and expresses "connected through wires" correctly |
| Registry-driven boards | New boards are data, not code |
| Separate provider vs app usage | Avoids double counting and mislabelled scope |
| Computed balance | No provider balance API exists; computation is transparent |
| JSON file storage | Sufficient for a local prototype; no DB setup |

---

## 20. Known limitations and recommended improvements

**Limitations**

- Not a compiler, electrical simulator or firmware emulator; simulation covers
  a small documented subset.
- The workspace grid is decorative: no grid or pin snapping.
- All LEDs in a circuit switch together; independent patterns are not modelled.
- Overall usage requires an Anthropic Admin key (organization accounts); the
  provider usage API does not report per-key usage or request counts.
- The credit balance is computed from a user-entered total, not read from the
  provider.
- Application-tracked cost is an estimate from a hard-coded price table.
- No automated tests; no authentication (usage endpoints rely on localhost
  restriction); CORS is open (`*`).
- No client-side AI request timeout or retry.
- Startup banner defaults the provider label to `openai-compatible` while the
  service defaults to `anthropic` (cosmetic).

**Suggested improvements**

- Add unit tests for the validator and board registry, plus API tests.
- Add authentication and strict CORS before any public deployment.
- Add snapping, undo/redo and saving circuits (local storage or database).
- Support independent LED patterns and more components (servo, potentiometer,
  buzzer).
- Per-user usage tracking and token budget enforcement.
- Stream AI responses and add client-side timeouts.
