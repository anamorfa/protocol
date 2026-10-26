# Playing a session

Phase 3 sessions are solo fights: one Scribe against an encounter. Authentication is fake: a name
is enough.

## 1. Create a session

```
POST /sessions        { "player_name": "Ronald", "seed": 42 }      (seed optional, 0..2147483647)
→ 201                 { "session_id": "s-…", "token": "…", "encounter": "rift_trial" }
```

Schemas: `session-request`, `session-response`. A bad body answers 400 with
`{ "reason_key": "session.invalid_request" }`.

## 2. Connect

`ws://<host>/play?token=<token>`. The server sends one `snapshot` carrying the latest `seq`.

One connection per token: a new one closes the old with code `4409` (`session.replaced`).
An unknown token closes with `4401` (`session.unknown_token`).

## 3. Play

Every message is in the envelope (`envelope`, `client-message`, `server-message`).

- Pick an entry of `turn.available_actions` and send its `action`, `actor_id` and `params` as the
  payload of an `action` message, with your own `request_id`.
- The server answers `action_accepted` and then one `event` message, or `action_rejected` with a
  `reason_key`.
- An `event` message holds every event of your action and of the enemy turns that follow, and the
  new `turn`. `seq` grows by one per `event` message; the fight's opening is `seq` 1.
- Malformed messages get an `error` with `message.malformed`, `message.unknown_type` or
  `message.unsupported_version`. The connection stays open.

## 4. Reconnect

Keep the highest `seq` you have applied. After a drop, open
`ws://<host>/play?token=<token>&since=<seq>`: the server resends every `event` message with a
higher `seq`, in order, and nothing else. Without `since` you get a fresh `snapshot`.
A `since` that is not a whole number, or is negative, counts as absent: you get a snapshot.

## Other endpoints

- `GET /rules` (`rules`): the form triangle and the numbers clients may show.
- `GET /i18n/{locale}` (`catalog`): text keys to messages; unknown locales get `en`.
