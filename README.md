# Anamorfa Protocol

The open protocol of **Anamorfa**, a turn-based RPG with an authoritative server and
free-form clients. The server only speaks in essences, forms, tags and text keys; each
client decides how the world looks — ASCII, pixel art, isometric or realistic 3D.

This repository holds the contract between the server and any client:

| Path | Contents |
| --- | --- |
| `schemas/` | JSON Schema (draft 2020-12) for every message |
| `asyncapi.yaml` | AsyncAPI description of the real-time channel |
| `docs/` | Human-readable protocol documentation |

## Principles

- **The server decides everything.** Clients send intents; the server validates them and
  publishes ordered events.
- **No visuals and no translated text on the wire.** The server sends IDs, tags and
  `text_key`s with parameters. Clients render and localize.
- **Every message carries `api_v`.** New fields are optional; breaking changes only in a
  major version.

## Status

Protocol 0.2 — forms as content, gear sets and the two-way wheel, over REST and the `/play`
WebSocket: actions, numbered events, snapshots and reconnection. Start with [docs/session.md](docs/session.md).

## License

[MIT](LICENSE). Build any client you like.
