# MONJED

MONJED solves the problem of language barriers between non-Arabic callers and emergency operators. It provides real-time speech recognition, automatic language detection, translation, and voice responses using AI APIs, enabling fast, accurate communication that can save lives and improve public services.

## How it works

- The caller opens the caller page, connects, and speaks in any language. Audio is captured in short chunks and streamed to the server over WebSocket.
- The server transcribes the audio (OpenAI speech-to-text), detects the language, and translates it to Arabic.
- The operator sees the original text, the detected language, and the Arabic translation in real time.
- The operator types a reply in Arabic. The server translates it to the caller's language, converts it to speech, and plays it on the caller's device.

## Requirements

- Node.js 18.17 or newer
- An OpenAI API key

## Setup

```bash
npm install
```

Create a `.env` file (copy `.env.example`) and set your key:

```
OPENAI_API_KEY=your-openai-api-key-here
PORT=3000
```

## Run

```bash
npm start
```

Then open:

- Caller page: `http://localhost:3000/caller.html`
- Operator page: `http://localhost:3000/operator.html`

Use the same call ID on both pages to link the caller with the operator.

## Configuration (optional)

These environment variables override the default models:

| Variable | Default |
|---|---|
| `TRANSCRIPTION_MODEL` | `whisper-1` |
| `TRANSLATION_MODEL` | `gpt-4o-mini` |
| `TTS_MODEL` | `gpt-4o-mini-tts` |
| `TTS_VOICE` | `alloy` |
