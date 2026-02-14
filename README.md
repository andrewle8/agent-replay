# AgentTV

Twitch-style live visualizer for Claude Code sessions. Watch AI code monkeys work in real-time with pixel art webcams, animated chat, and streaming overlays.

![AgentTV screenshot](screenshot.png)

## Install

```bash
pip install -e .
```

Requires Python 3.10+ and a `~/.claude/projects/` directory with Claude Code session logs.

## Usage

```bash
# Launch the web dashboard (opens browser)
agent-replay

# Options
agent-replay --port 8420          # Custom port (default: 8420)
agent-replay --host 0.0.0.0      # Bind to all interfaces
agent-replay --no-browser         # Don't auto-open browser
agent-replay --public             # Redact secrets for public sharing
```

## Features

**Dashboard** — Browse all Claude Code sessions as channel cards with live pixel art thumbnails showing actual code from each session. Cards show project name, branch, agent count, event count, and live/offline status. Master Control Room view aggregates all active sessions.

**Pixel Art Webcam** — Each session gets a unique procedurally generated scene:
- Character with idle animations (sipping drinks, stretching, looking around, scratching head, leaning forward)
- Eye blinking and breathing animation
- Dynamic monitor content cycling between code, terminal, file tree, and debug log views
- Monitors show actual code from agent events
- Monitor glow and ambient lighting effects
- Keyboard keys light up during typing, flash red on errors, rainbow on completion
- Desk decorations: coffee with steam particles, cats that stretch, plants that sway, lamps with orbiting moths, rubber ducks that bob and talk
- Window scenes with rain, shooting stars, drifting clouds, city skylines
- Ambient dust motes and monitor light particles

**Reactions** — The character reacts to agent events in real-time:
- Error: desk shakes, red ! above head, skull on monitor, BSOD flash
- Complete: fist pump, gold sparkles, confetti, checkmark on monitor
- Spawn: purple rings radiate outward
- Think: thought bubble dots, hand on chin
- User: wave at camera, ? speech bubble
- Bash: lightning bolt above keyboard

**Chat** — Event log styled as Twitch chat with badges, colored agent names, expandable content, token counts. Viewers randomly chat and tip. Streamer reacts to tips. Scroll-to-bottom button when scrolled up.

**Master Control Room** — Wall of 6 monitors each showing different content modes, status LEDs, ceiling alert light on errors, manager character scanning monitors, coffee mug with steam, phone pickup animation.

**Public Streaming** — Run with `--public` to share your coding sessions. Server-side redaction scrubs API keys, tokens, passwords, JWTs, full file paths, and long base64 strings before data leaves the machine.

## Public Streaming Setup

To expose on the web via Cloudflare + Nginx Proxy Manager:

1. Run: `agent-replay --host 0.0.0.0 --public --no-browser`
2. Nginx Proxy Manager: add proxy host pointing to your server IP:8420, enable WebSocket support, request SSL cert
3. Cloudflare DNS: A record to your IP (proxied), enable WebSockets in Network settings, SSL mode Full (strict)

What `--public` redacts (server-side, data never leaves the machine unredacted):
- API keys, tokens, passwords, bearer tokens, JWTs, GitHub PATs, Slack tokens, AWS keys
- Long base64 strings (40+ chars)
- Full file paths reduced to just filenames
- Session file paths hashed to opaque IDs

What still shows through:
- Project names, branch names, agent names
- Event types and timing
- Code structure on monitors (with secrets scrubbed)
- Token counts and costs

## Architecture

```
agent_replay/
  server.py    # FastAPI web server, WebSocket live updates, --public redaction
  parser.py    # JSONL parsing -> normalized event stream
  models.py    # Event, Agent, Session, SessionSummary dataclasses
  scanner.py   # Session discovery — scans ~/.claude/projects/

web/
  index.html   # Dashboard + session view layout
  app.js       # Pixel art engine, chat rendering, WebSocket client
  style.css    # Twitch-inspired dark theme
```

## Dependencies

- [FastAPI](https://fastapi.tiangolo.com/) >= 0.104
- [Uvicorn](https://www.uvicorn.org/) >= 0.24

## Supported Formats

- **Claude Code** JSONL transcripts (full support)

## License

MIT
