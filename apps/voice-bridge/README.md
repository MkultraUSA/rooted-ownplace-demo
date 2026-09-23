# voice-bridge (Agent0 Slack listener)

Live meeting bridge: Slack Socket Mode listener + push-to-talk voice floor
(piper TTS voices, faster-whisper STT) + OpenCode reasoning handoff for
`act:` turns. Implements `docs/voice-action-bridge.md` (M9 #61, PR #62).

## Layout
- `agent0_slack_listener.py` — the bridge (imported from workstation
  `~/.local/share/agent0-slack-listener/`, 2026-09-23)
- `requirements.txt` — Python deps

## Excluded (download/provision on setup, never commit)
- `voices/` — piper `.onnx` TTS models (~121 MB: amy, ryan)
- `whisper-models/` — faster-whisper STT models (~75 MB)
- `state/` — runtime state (opencode session id, seen Slack events)

## Config (env, never repo)
`SLACK_BOT_TOKEN`, `SLACK_OWNER_USER_ID`, `AGENT0_OPENCODE_URL`
(default `http://127.0.0.1:4096`), `SLACK_MIC_SOURCE`,
`SLACK_STT_MODEL` (default `tiny.en`).

## Per-project action directory
`AGENT0_PROJECT_DIRS` maps `channel-id:/path,...`. Action turns open the
reasoning session in the mapped directory (one session file per directory);
unmapped channels use the server default. Previously every turn reasoned
inside the supervisor repo regardless of topic.

## Mic discipline (default paused)
The microphone starts PAUSED. Saying `listen` / `mic on` in an allowed
channel opens the meeting window (`mic off` closes it). This prevents
24/7 room transcription (CPU + privacy).

## Safety
Voice may EXECUTE read-only/status turns and PROPOSE privileged ones per
`docs/voice-action-bridge.md`. Merges, deploys, closes, credentials: typed
confirmation only, never spoken.
