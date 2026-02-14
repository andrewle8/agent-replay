# Changelog

## v0.3.1

- Add `/no_think` mode for Ollama prompts (viewer chat, narrator, reactions) — skips internal reasoning for faster responses on Qwen3/Cogito models. Interactive "explain" replies keep thinking mode for higher quality answers.
- Add code overlay panel showing real code snippets from agent events
- Add real content to Master Control Room monitors
- Improve chat viewer personalities and variety
- Add monkey-behind-desk character variant
- Change default Ollama model to `qwen3:14b`
- Fix browser opening `localhost` instead of `0.0.0.0` on Windows

## v0.3.0

- Add narrator bot with esports-style play-by-play commentary
- Add live stream titles generated from recent agent activity
- Add interactive chat — ask the LLM about specific agent events
- Add viewer reactions to user chat messages
- Add LLM on/off toggle and dynamic model picker
- Remove demo mode — users always have real sessions
- Add `httpx` dependency for LLM API calls
- Update README with full feature documentation
