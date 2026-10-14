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
- **AI API Key Usage dashboard**: shows usage for the single configured API key,
  distinguishing provider-reported usage from application-tracked usage.

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
| `AI_MAX_TOKENS` | `max_tokens` (required by the Messages API) |
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

Open **AI API Key Usage** in the top navigation bar. The dashboard reports usage
for the single key configured in `backend/.env`.

- With Anthropic, enable the optional **Admin Usage & Cost API** by setting
  `AI_USAGE_API_ENABLED=true` and `AI_USAGE_API_KEY` to a **separate Admin API
  key** (`sk-ant-admin...`). The backend then calls
  `GET /v1/organizations/usage_report/messages` and
  `GET /v1/organizations/cost_report` and shows provider-reported token and cost
  figures.
- Anthropic reports these at **organization level**, not scoped to one API key —
  the dashboard labels this scope accurately.
- If the Admin API is not enabled (or the key is not admin-scoped), the
  dashboard shows **application-tracked usage** — metadata recorded by this
  backend while using the configured key (timestamp, model, feature, token
  counts returned by the AI response, status, duration). It does **not** store
  API keys, authorization headers, prompts or personal content.
- The two sources are never summed into one total unless the scope is verified.
- The full key is never displayed — only a masked suffix (or `Not configured`).
- Missing metrics show `Unavailable from provider` / `Not provided`; nothing is
  invented.

Related environment variables: `AI_USAGE_API_ENABLED`, `AI_USAGE_API_KEY`,
`AI_USAGE_BASE_URL`, `AI_USAGE_SCOPE`, `USAGE_LOCALHOST_ONLY`. Usage endpoints
are restricted to localhost by default; add authentication before any public
deployment.

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
| GET | `/api/usage/status` | Usage retrieval configuration and availability |
| GET | `/api/usage/summary` | Usage summary for the configured key scope |
| GET | `/api/usage/details` | Detailed / time-bucketed usage |

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
