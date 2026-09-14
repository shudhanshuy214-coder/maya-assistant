# MAYA V1 — My AI Assistant

Maya (My AI Assistant) is a personal AI voice assistant that runs in a browser
and, optionally, inside a native Android app wrapper. You speak or type, Maya
understands, answers with AI, reads her answer aloud, and can perform **only
the phone actions Android officially allows** (Intents, AlarmClock API,
system speech, Settings, etc.).

Maya never fakes control of your phone, never asks for permissions she
doesn't need, and never puts your OpenAI key in the client.

## Project structure

```
Maya-V1/
├── frontend/                # Maya's UI (PWA-capable, mobile-first, dark futuristic)
│   ├── index.html
│   ├── style.css
│   ├── script.js            # STT, TTS, chat, command router — contains NO api key
│   ├── manifest.json
│   └── sw.js
├── backend/                 # Secure OpenAI proxy (Node.js + Express)
│   ├── server.js            # holds OPENAI_API_KEY via env var — never sent to client
│   ├── package.json
│   └── .env.example         # copy to .env and add YOUR key locally
├── android/                 # Native Android wrapper (WebView + bridge)
│   ├── README.md            # build steps + full API/permission map
│   ├── app/build.gradle
│   ├── app/proguard-rules.pro
│   ├── build.gradle
│   ├── settings.gradle
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/maya/assistant/MainActivity.java
│       ├── java/com/maya/assistant/MayaBridge.java
│       └── res/layout/activity_main.xml
├── .gitignore
└── README.md                # this file
```

## STEP 1 — Frontend UI
**Created**: `frontend/index.html`, `style.css` — Maya logo, animated orb,
mic button with pulse, chat area, text input + send, quick-action chips,
status indicator (`Maya is ready → Listening… → Thinking… → Speaking…`),
mute toggle, settings sheet, confirm dialog. Dark futuristic mobile-first
layout, no ads.
**Where**: `frontend/` folder.
**Run**: any static server, e.g. `npx serve frontend` or open
`http://localhost:3000` after step 2 (backend can serve it too).
**Expected**: the Maya interface appears, status bar shows “Maya is ready”.

## STEP 2 — Backend AI connection
**Created**: `backend/server.js`, `package.json`, `.env.example`.
**Where**: `backend/` folder.
**Run**:
```bash
cd backend
npm install
cp .env.example .env       # then edit .env → OPENAI_API_KEY=sk-...YOUR KEY
npm start                  # backend listens on http://localhost:3000
```
**Expected**: `GET /api/health` returns `{ ok: true, configured: true }`.
Features: request validation (1 KB limit), 20 req/min rate limit per IP,
model configurable via `OPENAI_MODEL`, absolute key secrecy (used only in the
server-side `Authorization` header, never logged, never returned).

## STEP 3 — Connect frontend to backend
**Created**: the fetch logic in `frontend/script.js` (`askAi()` hitting
`POST /api/assistant` with your command + recent history as context).
**Where**: already wired; no extra step.
**Run**: load the UI, type “What is 25 multiplied by 4?”.
**Expected**: Maya replies briefly — “25 multiplied by 4 is 100.” Connection
and offline states are shown by the dot in the status bar.

## STEP 4 — Voice input
**Created**: `toggleMic()` + SpeechRecognizer integration in `script.js`.
**Where**: `frontend/`.
**Run**: tap the big mic button, say “What is the time?”.
**Expected**: status → “Listening…”, your words appear in chat as your
message. If the mic is denied, a friendly error appears. In the Android
wrapper, `MayaNative.listen()` uses Android's own STT engine instead.

## STEP 5 — Text-to-speech
**Created**: `speak()` / `stopSpeaking()` in `script.js`.
**Where**: `frontend/`.
**Run**: ask anything with the speaker icon enabled.
**Expected**: Maya says the reply aloud; status → “Speaking…”. Mute toggle
turns voice off, on-device TTS is used in the Android wrapper. Failures show a
polite notice, never crash.

## STEP 6 — Safe command routing
**Created**: `route()` table in `script.js`, matching only safe commands.
**Where**: `frontend/`.
**Run**: try “hello Maya”, “open google”, “go back”, “what's the date”.
**Expected**: instant local responses — no AI call needed for these. Anything
unknown falls through to the AI brain. Invalid input gets “I didn’t catch a
valid command…”.

## STEP 7 — Legitimate Android phone actions
**Created**: `MayaBridge.java` + `MainActivity.java` in `android/`.
**Where**: `android/` (see `android/README.md` for the exact method list,
build command, and permission rationale).
**Run**: build the wrapper `cd android && ./gradlew assembleDebug`.
**Expected**: inside the Android app, “Open YouTube”, “Open camera”,
“Set a reminder”, “Search Google for …” run real Intents and the official
AlarmClock picker — always with your confirmation when enabled. If the same
command is used from a plain browser, Maya says:
“That action requires the Android version of Maya.”

## STEP 8 — Test everything
Checklist:
- Offline → “You seem to be offline…”
- Backend down → “Maya’s brain isn’t reachable right now…”
- Mic denied → “…enable the microphone for Maya…”
- No match → “Sorry, I couldn’t hear that clearly…”
- TTS failure → “…My voice output had a small hiccup…”
- Rate limit (20/min) → “You’re sending messages too quickly…”
- Unsupported phone action → “That action requires the Android version of Maya.”

## API key security (unchangeable rules)

1. The key exists only as `OPENAI_API_KEY` in the backend's `.env`
   (server-side environment variable).
2. Copy `backend/.env.example` → `backend/.env`, and put YOUR OWN key there.
   Never the real key in HTML/CSS/JS/APK/git or browser storage.
3. The proxy uses the key only in the server-side Authorization header.
   It is never echoed, logged, or returned to any client.
4. `.gitignore` blocks `.env`, keystores, and build outputs.

## Command examples answered locally (no AI call)

| Say / Type | Maya |
|---|---|
| Hello Maya | “Hello! I’m Maya. How can I help you?” |
| What is the time? | “The time is …” |
| Open Google / Open YouTube | “Opening …” (Intent, with confirmation if enabled) |
| Search Google for Class 9 science | “Opening Google search…” |
| Set a reminder | Android AlarmClock picker (native app) |
| Go back / Show my assistant | navigates / greets |
