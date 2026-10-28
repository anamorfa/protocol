# Playing a session

Sessions are solo fights: one Scribe against an encounter. Authentication is fake: a name
is enough.

## 1. Create a session

```
POST /sessions        { "player_name": "Ronald", "seed": 42, "encounter": "rift_trial", "sets": [ … ] }
→ 201                 { "session_id": "s-…", "token": "…", "encounter": "rift_trial" }
```

Only `player_name` is required. `seed` is 0..2147483647. `encounter` is `rift_trial` (the default),
`rift_first_steps` or `rift_echoes`. `sets` holds 1 to `max_sets` gear sets (`GET /rules` gives `max_sets`); the
first one starts active, and without `sets` the Scribe gets the starting loadout. A set is a
`main_hand` (`essence`, `form`, `grip`) and an optional `off_hand` (`essence`, `form`).
An off hand must pair with the main hand: `GET /rules` lists, for each off-hand form, the main-hand
forms it goes with (`pairs_with`). Its attack and damage bonuses add to the main hand's strikes.
`active_set` is always below the number of sets.
Sets are addressed by their 0-based index.

Schemas: `session-request`, `session-response`. A bad body answers 400 with a `reason_key`:

- `session.invalid_request`: the body does not match the schema;
- `set.form_not_accepted`: the essence does not accept that form, or the form does not fit the slot;
- `set.grip_not_allowed`: the form cannot be held with that grip;
- `set.off_hand_needs_one_hand`: an off hand with a two-handed main hand;
- `set.off_hand_not_paired`: the off hand does not pair with that main hand;
- `set.form_not_known`: the Scribe has not mastered that form;
- `session.too_many_sets`: more than `max_sets` sets;
- `session.no_sets`: an empty `sets` list.

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
- `reshape {set}` switches the active gear set to the set at that index and costs the action
  (and Ink, see `GET /rules`). `fix {target_id}` takes only a target: it stabilizes the target
  and costs the action and Ink.
- An `event` message holds every event of your action and of the enemy turns that follow, and the
  new `turn`. `seq` grows by one per `event` message; the fight's opening is `seq` 1.
- Malformed messages get an `error` with `message.malformed`, `message.unknown_type` or
  `message.unsupported_version`. The connection stays open.

## Versions

Every message carries `api_v` (`MAJOR.MINOR`). While the major is 0, a different minor version is
incompatible: a server on 0.3 answers `message.unsupported_version` to a client on 0.2, and the
other way round.

## 4. Reconnect

Keep the highest `seq` you have applied. After a drop, open
`ws://<host>/play?token=<token>&since=<seq>`: the server resends every `event` message with a
higher `seq`, in order, and nothing else. Without `since` you get a fresh `snapshot`.
A `since` that is not a whole number, or is negative, counts as absent: you get a snapshot.

## Other endpoints

- `GET /rules` (`rules`): the form wheel, the forms and essences (slots, grips, reach) and the numbers clients may show.
- `GET /i18n/{locale}` (`catalog`): text keys to messages; unknown locales get `en`.
