# MAYA V1 — Android Native Wrapper Setup

## What this is

`android/` is the native Android wrapper that hosts Maya's web UI in a WebView
and gives the web page safe access to real phone features **through official
Android mechanisms only** (Intents, AlarmClock API, SpeechRecognizer, TTS,
PackageManager). No hacking, rooting, surveillance, or credential access.

## How the web UI communicates with the native app

The WebView injects a JavaScript bridge object:

- **JS → Android**: `window.MayaNative.<method>(...)`
  (implemented in `MayaBridge.java` via `@JavascriptInterface`)
- **Android → JS**: MainActivity calls
  `window.mayaNativeEvent('<event>', payload)` inside the page.

Legacy smaller intent for page-level notifications:
- `window.__mayaNativeCallback(event)` — used by `MainActivity.pushJs()`.

## Methods the web UI can call

| Method | Purpose | Official mechanism used |
|---|---|---|
| `speak(text)` | Voice output | Android `TextToSpeech` |
| `stopSpeech()` | Stop speaking | `TextToSpeech.stop()` |
| `listen()` | Voice input | `SpeechRecognizer` (system STT engine) |
| `stopListening()` | Stop listening | `SpeechRecognizer.stopListening()` |
| `speechLang()` | Ask STT its language | `Locale.getDefault()` |
| `openUrl(url)` | Open a URL | `Intent.ACTION_VIEW` |
| `openApp(name)` | Launch installed app by name | `PackageManager` + launcher intent |
| `intent(kind)` | camera/settings/wifi/bluetooth/maps/alarm/calculator/whatsapp | Official Intents / Settings.* |
| `reminder(text)` | Create reminder | `AlarmClock.ACTION_SET_ALARM` (system UI confirms) |
| `timer(seconds)` | Quick timer | `AlarmClock.ACTION_SET_TIMER` |
| `goBack()` | Navigate back | `Activity.onBackPressed()` |
| `vibrate(ms)` | Haptic feedback | `Vibrator` |
| `device()` | Platform info (JSON) | `Build` metadata |

Events pushed back to JS (`window.mayaNativeEvent`): `ttsReady`, `speakStart`,
`speakEnd`, `speakError`, `sttResult`, `sttError`, `micPermission`, `noActivity`.

## Permissions (and why — nothing silent)

| Permission | Reason |
|---|---|
| `RECORD_AUDIO` | Voice input via Android's SpeechRecognizer. Requested at runtime with an explanation. |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Talking to the Maya backend for AI answers. |
| `VIBRATE` | Short haptic pulse when the mic activates. |
No contacts, SMS, location, storage, or camera permissions are ever requested.

## Building

```bash
cd android
# put the web files where Gradle embeds them:
mkdir -p app/src/main/assets/frontend
cp ../frontend/index.html ../frontend/style.css ../frontend/script.js \
   ../frontend/manifest.json app/src/main/assets/frontend/

# need a launcher icon in app/src/main/res/mipmap-*/ic_launcher.png
# (any 192px Maya icon works; keep the dark #05060F background)

./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Set the backend URL used for AI requests: the web UI's Settings → "Server URL"
field (saved in WebView localStorage), e.g. `https://your-server.com`.

## Security notes for the wrapper

- API key is *never* in the APK. All AI calls go to your backend
  (`/api/assistant`), which holds `OPENAI_API_KEY` server-side.
- Bridge exposes only the few official-intent helpers above — it never
  executes arbitrary code, touches files, or reads personal data.
- `usesCleartextTraffic="false"` enforces HTTPS.
- Reminders/alarms always open Android's **own** system UI for confirmation —
  Maya never schedules anything invisibly.
