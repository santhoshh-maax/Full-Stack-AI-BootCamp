# Microcontroller AI Lab

An interactive, AI-powered electronics learning platform. Students select a
microcontroller board, choose a lesson, drag components into a virtual
workspace, wire pins together, receive AI explanations, generate
board-compatible code, validate circuits against deterministic rules and
simulate supported behaviour directly in the browser.

Boards supported in this version:

- **Arduino Uno R3** (`arduino-uno-r3`) — ATmega328P, 5V logic
- **ESP32 DevKit V1** (`esp32-devkit`) — ESP32-WROOM-32, 3.3V logic

The architecture is registry-driven so additional boards can be added without
rewriting the application.

---

## 1. Features

- **Board selection** with board-specific pins, capabilities, restrictions and
  code examples.
- **Drag-and-drop circuit workspace** (SVG): place, move, wire, select and
  delete components; draw wires by clicking two pins.
- **Deterministic circuit validation** with clear errors and warnings. The
  backend recomputes validation from its own board registry and never trusts
  pin capabilities supplied by the browser.
- **AI Electronics Tutor** (explanations, code generation, troubleshooting) via
  the backend only — no API key ever reaches the browser.
- **Code editor** that generates Arduino-style code using the pins actually
  resolved from the circuit, a Copy button, line explanations, required
  libraries and the list of simulator-supported operations.
- **Simulation panel**: Run / Stop / Reset, virtual LED, virtual push button,
  simulated DHT11 readings and serial-style output.
- **AI API Key Usage dashboard**: shows overall AI API token usage and cost as
  reported by the provider (all API traffic, not just this app's chatbot), with
  application-tracked usage as a fallback.

Three lessons: **LED Blinking**, **Push Button** and **DHT11 Sensor**, each for
both boards.

---

## 2. Project structure

```text
microcontroller-ai-lab/
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── board-registry.js      # central board + pin capabilities
│       ├── components.js          # component catalog + instance factory
│       ├── lessons.js             # lesson definitions
│       ├── canvas.js              # SVG workspace: render, drag, pins
│       ├── wires.js               # wire drawing / selection / deletion
│       ├── circuit-validator.js   # deterministic validation
│       ├── simulator.js           # LED / button / DHT11 simulation
│       ├── code-editor.js         # code generation + explanation
│       ├── ai-client.js           # chat client (calls the backend)
│       ├── usage-dashboard.js     # AI API key usage dashboard
│       └── app.js                 # orchestrator + shared circuit model
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── config/board-registry.js
│   │   ├── routes/ (boards, ai, circuit, usage, index)
│   │   ├── controllers/
│   │   ├── services/ (ai, circuit, usage, provider-usage)
│   │   └── middleware/ (errors, local-only)
│   ├── data/usage.json            # app-tracked usage (git-ignored, auto-created)
│   ├── .env.example
│   └── package.json
├── .gitignore
└── README.md
```

The backend imports the **same** `circuit-validator.js` and `board-registry.js`
that the frontend uses, so client and server can never disagree about
capabilities.

---

## 3. Setup

Requirements: **Node.js 18+** (uses the built-in `fetch`).

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Create your environment file
copy .env.example .env       # Windows
# cp .env.example .env       # macOS / Linux

# 3. Edit .env and add your AI provider credentials (see section 4)

# 4. Start the server (serves the frontend and the API)
npm start
```

Then open **http://localhost:3000**.

You can also open `frontend/index.html` directly, but AI features require the
backend; in that case the page talks to `http://localhost:3000` automatically.

---

## 4. AI provider configuration

This project is configured for the **Anthropic Claude API**. All AI calls are
proxied through the backend using the Messages API
(`POST https://api.anthropic.com/v1/messages`) with the API key sent only in the
`x-api-key` header server-side.

Set these in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `anthropic` |
| `AI_API_KEY` | **Required for AI features.** Server-side only. |
| `AI_BASE_URL` | `https://api.anthropic.com/v1` |
| `AI_MODEL` | A Claude model your key can access (e.g. `claude-sonnet-4-5`) |
| `AI_TIMEOUT_MS` | Request timeout |
| `AI_MAX_TOKENS` | Per-request `max_tokens` cap (required by the Messages API); not a usage counter |
| `AI_TEMPERATURE` | Usually leave blank: the newest Claude models reject `temperature` |

If `AI_API_KEY` is missing, AI endpoints return a clear `AI_NOT_CONFIGURED`
error and the rest of the app (validation, deterministic code generation,
simulation) still works. **Never commit `.env`.** Keys are read only on the
backend and are never returned to the browser or written to logs.

The service also still works with any OpenAI-compatible Chat Completions
endpoint: set `AI_PROVIDER` and `AI_BASE_URL` accordingly and it will select the
right request/response format automatically.

---

## 5. AI API Key Usage dashboard

Open **AI API Key Usage** in the top navigation bar. The dashboard reports
**overall AI API usage**: every request made against the provider account
(other apps, scripts, the Console and this app's chatbot, code generation and
troubleshooting), not just this application's chatbot traffic.

**Primary source: provider-reported usage (overall).** Enable the optional
Anthropic **Admin Usage & Cost API** by setting `AI_USAGE_API_ENABLED=true` and
`AI_USAGE_API_KEY` to a **separate Admin API key** (`sk-ant-admin...`). The
backend then calls:

- `GET /v1/organizations/usage_report/messages` (daily buckets grouped by model;
  input tokens include uncached, cache-read and cache-creation tokens)
- `GET /v1/organizations/cost_report` (amounts converted from cents to USD)

OpenAI-compatible providers use `/organization/usage/completions`. Anthropic
reports usage at **organization level**, not per API key, and the dashboard
labels the scope accordingly. When provider data is available, the cards,
charts and details table use it ("Provider-reported (authoritative)").

**Fallback: application-tracked usage.** If the Admin API is not enabled (or the
key is not admin-scoped), the dashboard falls back to usage recorded by this
backend. Every AI call (`explain`, `generate-code`, `troubleshoot`) goes through
`ai.service.js`, which records timestamp, model, feature, input/output/total
tokens from the provider response, status and duration to
`backend/data/usage.json` (git-ignored, last 5000 records). This only covers
calls made through this app, so it is a subset of overall usage. Failed calls
are recorded without tokens. Prompts, API keys and authorization headers are
never stored. Cost in this mode is an estimate from built-in per-model rates.

**Total amount and remaining balance.** The dashboard shows total spend (the
provider's cost report for overall usage, paginated across the full range) and a
credit balance. No provider exposes a prepaid-balance API, so the balance is
computed: `AI_CREDIT_TOTAL` (credits purchased, USD) minus overall spend since
`AI_CREDIT_START` (optional ISO date). Without the Admin API it uses the
app-tracked estimate and labels it as such. If `AI_CREDIT_TOTAL` is unset the
balance shows "Not available".

Other behaviour:

- The two sources are never summed; the dashboard shows one source at a time
  and states which.
- The full key is never displayed, only a masked suffix (or `Not configured`).
- Missing metrics show `Unavailable from provider` / `Not provided`; nothing is
  invented.
- `AI_MAX_TOKENS` is only the per-request `max_tokens` cap, not a usage counter.

Related environment variables: `AI_USAGE_API_ENABLED`, `AI_USAGE_API_KEY`,
`AI_USAGE_BASE_URL`, `AI_USAGE_SCOPE` (`account` or `key`), `AI_CREDIT_TOTAL`,
`AI_CREDIT_START`,
`USAGE_LOCALHOST_ONLY`. Usage endpoints are restricted to localhost by default;
add authentication before any public deployment.

---

## 6. Supported boards

### Arduino Uno R3
- Digital: `D0`–`D13`; Analog inputs: `A0`–`A5`
- PWM: `D3, D5, D6, D9, D10, D11`; Power: `5V`, `3V3`; Ground: `GND`
- 5V logic. `D0`/`D1` are the serial lines. `D13` drives the on-board LED.

### ESP32 DevKit V1 (ESP32-WROOM-32)
- Verified output-capable GPIO: `2, 4, 5, 12–19, 21–23, 25–27, 32, 33`
- Input-only: `34, 35, 36, 39`; ADC (ADC1): `32, 33, 34, 35, 36, 39, 25, 26, 27, 4`
- Power: `3V3`, `VIN`; Ground: `GND`
- **3.3V logic — never feed 5V into a GPIO.** Flash pins (6–11) are excluded and
  boot-strapping pins are flagged with restrictions.

Pin capabilities are configuration data, not assumptions. Add or change a board
by editing `frontend/js/board-registry.js`; the backend picks it up
automatically.

---

## 7. Circuit data model

```js
const circuit = {
  board: 'arduino-uno-r3',
  lesson: 'led',
  components: [
    { id: 'board-1',    type: 'arduino-uno-r3', x: 80,  y: 140 },
    { id: 'led-1',      type: 'led',            x: 620, y: 180, properties: { color: 'red' } },
    { id: 'resistor-1', type: 'resistor',       x: 470, y: 210, properties: { resistance: 220 } }
  ],
  connections: [
    { id: 'wire-1', from: 'board-1.D8',       to: 'resistor-1.pin1' },
    { id: 'wire-2', from: 'resistor-1.pin2',  to: 'led-1.anode' },
    { id: 'wire-3', from: 'led-1.cathode',    to: 'board-1.GND' }
  ]
};
```

---

## 8. Validation

The deterministic validator (`circuit-validator.js`) checks, per board and
lesson:

- the selected board is configured and exactly one matching board is placed;
- all wire endpoints exist as real pins on that board;
- required lesson components are present;
- LED polarity and a current-limiting resistor in the loop;
- ground return for the LED cathode;
- button: one side to a GPIO input, the other to GND (no floating input);
- DHT11: power, ground and data connections, with a pull-up recommendation and
  a voltage sanity check on 3.3V boards.

It returns meaningful `errors` and `warnings`. The AI may *explain* results but
never overrides them.

---

## 9. Simulation

The simulator is a lightweight custom JavaScript engine. It does **not** compile
or execute arbitrary firmware and uses no `eval`. It runs a validated structured
representation of the lesson using the pins resolved from the circuit:

- **LED**: toggles HIGH/LOW on the interval; animates the LED.
- **Button**: a virtual button updates a digital input (`INPUT_PULLUP`) and
  drives the LED.
- **DHT11**: simulated temperature/humidity values (default 28 °C / 65 %) that
  can be changed within ranges.

Unsupported operations reported by the code are listed; the app never pretends
unsupported code ran. All output is clearly labelled as simulated.

---

## 10. API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Backend status |
| GET | `/api/boards` | Configured boards and capabilities |
| POST | `/api/ai/explain` | Explain components, circuits and concepts |
| POST | `/api/ai/generate-code` | Generate board-compatible code |
| POST | `/api/ai/troubleshoot` | Diagnose errors from real circuit data |
| POST | `/api/circuit/validate` | Deterministic board-specific validation |
| GET | `/api/usage/status` | Usage source configuration and availability (localhost-only) |
| GET | `/api/usage/summary` | Provider-reported overall usage and app-tracked usage, kept separate |
| GET | `/api/usage/details` | Provider per-period rows, or app-tracked rows as fallback |

AI request bodies are validated for size and shape, provider calls use
timeouts, and rate-limit/timeouts/provider errors map to clear messages.

---

## 11. Adding a new board

1. Add an entry to `frontend/js/board-registry.js` with pins, capabilities,
   power/ground pins, restrictions and default lesson pins.
2. Add the board illustration in `canvas.js` if a custom look is desired.
3. No backend changes are needed — the registry is shared.

---

## 12. Security notes

- API keys live only in `backend/.env` (git-ignored) and are used only
  server-side.
- The backend recomputes board capabilities and validation; it does not trust
  the client.
- AI output is instructed never to override board configuration or validation,
  and never to claim code was compiled or run on hardware.
- Usage endpoints are localhost-only by default and require authentication
  before public deployment.

---

## 13. Limitations

This is a learning prototype, **not** a compiler, electrical simulator or
firmware emulator. Simulation models a small documented subset of behaviour.
Voltage/current physics, timing at the microsecond level and peripheral
behaviour are approximated or not modelled. Physical hardware results may
differ.
