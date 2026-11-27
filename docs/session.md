# Playing a session

A session plays one of the account's characters: a Scribe in the world, which walks a map under
fog of war and opens Rifts with the enemy groups it meets. A training session is a single fight
against an encounter instead, with no character. An account has **one open session** at a time.

Everything a session does is stored as it happens. The server answers an action only once its
result is written, so nothing a client was told is lost if the server restarts: reconnect, and the
character, its walk and its fight are where they were.

## 0. Sign in

Players sign in with OpenID Connect, Authorization Code with PKCE (S256), against the server's
Keycloak realm. The discovery document is at `<issuer>/.well-known/openid-configuration`; in local
development the issuer is `http://localhost:8180/realms/anamorfa`. Clients are registered by the
Anamorfa team; ask for a client id.

Scopes:

| Scope | Allows |
| --- | --- |
| `play` | creating sessions and sending actions |
| `profile.read` | `GET /me`: the account id and name |
| `characters.manage` | creating characters and changing their sets |

Access tokens last 5 minutes. Refresh them with the refresh token before they expire.

`POST /sessions` takes the access token as `Authorization: Bearer <token>`; the player's name comes
from the account. Refusals:

| Status | `reason_key` | When |
| --- | --- | --- |
| 401 | `auth.missing_token` | no `Authorization: Bearer` header |
| 401 | `auth.invalid_token` | the token is malformed, forged or expired |
| 403 | `auth.missing_scope` | the token lacks `play` |
| 429 | `rate.limited` | too many sessions; `Retry-After` gives the seconds to wait |

## 1. Characters

```
POST /characters      { "name": "Ronald", "sets": [ … ], "map": "first_clearing" }   (characters.manage)
→ 201                 { "id": "7c9e…", "name": "Ronald", "map": "first_clearing", "in_rift": false }

GET /characters       (profile.read)
→ 200                 { "characters": [ { "id": "7c9e…", "name": "Ronald", "map": "first_clearing", "in_rift": false } ] }

PUT /characters/{id}/sets   { "sets": [ … ] }                                     (characters.manage)
→ 200                 { "id": "7c9e…", "name": "Ronald", "map": "first_clearing", "in_rift": false }
```

Schemas: `character-request`, `character`, `character-list`, `sets-request`.

- A new Scribe starts on the start Anchor of `map` (`first_clearing`, the default, or
  `still_crypt`), with `sets` or the starting loadout.
- A name is trimmed, then must be 3 to 20 characters of letters, digits, spaces, `-` and `_`, and
  unique in the account, ignoring case. An account has up to 5 characters.
- Sets change freely outside Rifts. If the character's session is open, its client gets a
  `sets_changed` event with the new sets.
- A character of another account answers as if it did not exist (`404`).
- Creating a character and changing sets share one limit per player: past it, `429` with
  `rate.limited` and `Retry-After`, as for sessions.

Refusals, besides the sign-in ones of section 0 and the set keys of section 2:

| Status | `reason_key` | When |
| --- | --- | --- |
| 400 | `character.invalid_name` | the name is too short, too long, or has other characters |
| 409 | `character.name_taken` | the account already has a character with that name |
| 409 | `character.too_many` | the account has as many characters as it may |
| 409 | `character.in_rift` | `PUT …/sets` while the character fights |
| 404 | `character.not_found` | no such character in this account |

## 2. Create a session

```
POST /sessions        { "character_id": "7c9e…" }
→ 201                 { "session_id": "s-…", "token": "…", "character_id": "7c9e…", "map": "first_clearing", "encounter": null }

POST /sessions        { "encounter": "rift_trial", "seed": 42 }
→ 201                 { "session_id": "s-…", "token": "…", "character_id": null, "map": null, "encounter": "rift_trial" }
```

- `{character_id}` opens the character where it stands, a fight in progress included. Its map and
  sets belong to it: they are not part of the request.
- `{encounter, sets?, seed?}` opens a training fight (`rift_trial`, `rift_first_steps` or
  `rift_echoes`). It changes no character. `seed` is 0..2147483647.
- **One open session per account.** Opening a session closes the account's open one, whatever it
  was: its connection closes with `4409` (`session.replaced`). If it played the same character,
  the new session takes everything over, a fight in progress included, on the same turn.

A training `sets` holds 1 to `max_sets` gear sets (`GET /rules` gives `max_sets`); the
first one starts active, and without `sets` the Scribe gets the starting loadout. The same rules
check a character's sets. A set is a
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
- `set.obsolete`: the content no longer makes that form or essence (`GET /rules` marks it `obsolete`);
- `session.too_many_sets`: more than `max_sets` sets;
- `session.no_sets`: an empty `sets` list;
- `character.not_found` (404): no such character in this account.

When the server cannot store anything right now it answers `503` with `server.storage_unavailable`.

## 3. Connect

`ws://<host>/play?token=<token>`. The server sends one `snapshot` carrying the latest `seq`.
Its `mode` is `world` (walking: `world` is set, `rift` is null) or `rift` (fighting: `rift` is set,
and `world` is the map the Scribe will come back to, or null in a fight-only session). It names
the `character_id` played (null in training); `player_name` is the character's name.

**Content changes.** Content can retire a form, an essence, a map, an Anchor or a group, naming a
replacement. When a character loads after such a change, what it held or where it stood moves to the
replacement, and the `event` that comes right after the snapshot holds `content_converted` with each
change (`{kind, from, to}`). That event carries the snapshot's own `seq`: the snapshot already shows
the converted state, and the event only tells what changed. A client that reconnects with `since`
finds it in the replay instead. For `kind: set`, `from` and `to` are the set's 1-based number: that set broke the
rules once converted and became the starting set. A character in a fight is converted when the fight
ends.

One connection per token: a new one closes the old with code `4409` (`session.replaced`).
An unknown token closes with `4401` (`session.unknown_token`).

Close codes the server uses:

| Code | Reason key | When |
| --- | --- | --- |
| `4401` | `session.unknown_token` | the session token is unknown |
| `4409` | `session.replaced` | another connection took the session over, or the account opened another session |
| `4403` | `auth.revoked` | the player's access expired, was revoked, or lacks `play` (see "Keeping access") |
| `4429` | `rate.limited` | too many actions, again and again |
| `1011` | `server.storage_error` | the server could not store what the session did; the session is closed and what was not stored is lost. Open a new session for the character: it starts from what was stored. Reconnecting to the old token closes with `4401` |

## 4. Play

Every message is in the envelope (`envelope`, `client-message`, `server-message`).

- Pick an entry of `turn.available_actions` and send its `action`, `actor_id` and `params` as the
  payload of an `action` message, with your own `request_id` (1 to 64 printable ASCII characters).
- The server answers `action_accepted` and then one `event` message, or `action_rejected` with a
  `reason_key`. Both come once the result is stored. When the server cannot store it, the action
  is rejected with `server.storage_unavailable` and nothing happened: try again shortly.
- `reshape {set}` switches the active gear set to the set at that index and costs the action
  (and Ink, see `GET /rules`). `fix {target_id}` takes only a target: it stabilizes the target
  and costs the action and Ink.
- An `event` message holds every event of your action and of the enemy turns that follow, and the
  new `turn`. `seq` grows by one per `event` message; the fight's opening is `seq` 1.
- Malformed messages get an `error` with `message.malformed`, `message.unknown_type` or
  `message.unsupported_version`. The connection stays open.

### Keeping access

The connection stays alive only while the player's access does. Before the access token expires,
refresh it and send the new one:

    { "api_v": "0.6", "type": "reauth", "payload": { "access_token": "<new token>" } }

There is no reply when it is accepted. The token must belong to the same player and client and carry
`play`. If it does not, or if the access expires first (for example because the player revoked the
client), the server closes the connection with `4403`.

A session lives only as long as its access: once it has expired without a `reauth`, the session
closes, and reconnecting to it also closes with `4403`. A Scribe that was fighting is removed from the
Rift at once (`removed` with reason `access_ended`), which counts as a flight. The character keeps
everything else: sign in again and open a new session with it. Keep the token fresh
(refresh a minute before `exp`) and send `reauth` on every new connection, so a reconnect within the
token's lifetime resumes the fight.

Sending actions too fast gets an `error` with `rate.limited`; keep doing it and the server closes the
connection with `4429`.

### The turn clock

Only Scribes' turns have a clock; enemy turns resolve at once.

- In a fight, the `turn` of a Scribe carries `time_left_ms` (this turn) and `reserve_left_ms` (one
  reserve for the whole fight), measured when the message was sent. Count down from there; they are
  durations because your clock and the server's may differ.
- When the turn's time runs out, the reserve runs. When both are gone, the server ends the turn:
  `turn_timed_out {entity, missed}`, then the turn passes as with `end_turn`. `missed` counts such
  turns in a row; any action resets it. Spent reserve does not come back.
- After 3 missed turns in a row (`rift.missed_turns_before_removal`), the Scribe is taken out of the
  Rift from any line: `removed {entity, reason: "missed_turns"}`. It counts as a flight: on the map
  the group keeps its wounds; in training the fight, and the session, end: the connection closes
  with code `1000` and reason `session.training_over`.
- Each clock event comes in an `event` message without `request_id`, like a step of a walk.

## 5. Walk the world

- **Known tiles only.** `world.tiles` lists every tile of the current map the Scribe has seen, as
  `[x, y, terrain]`; x grows to the east, y to the south. Terrain once seen stays known. New tiles
  arrive in `tiles_revealed` events. Right after `map_changed` or `respawned`, `tiles_revealed`
  carries every known tile of that map, not only new ones, so a client may keep only the current
  map's tiles. `GET /rules` describes each terrain (`world.terrains`).
- **Entities in sight only.** `world.entities` holds the Anchors, passages and groups the Scribe sees now;
  `entity_seen` and `entity_lost` keep it up to date. Forget an entity on `entity_lost`.
- **Walking.** `available_actions` has one `move_to` template with empty `params` and
  `open_params: ["x", "y"]`: send it with the `x` and `y` of a known tile. The server answers
  `action_accepted` and an `event` with `path_planned`, then walks one step per tick
  (`world.tick_ms` in `GET /rules`). Each step is an `event` message **without** `request_id`:
  `stepped`, then what the step reveals, binds or crosses. The walk ends with `movement_stopped`
  (`arrived`, `stopped`, `blocked` or `passage`). A new `move_to` replaces the path; `stop` drops it.
  Walks never cross a passage they do not end on. A path avoids the groups in sight only, so it never
  tells where a hidden group stands; a walk that runs into one stops with `blocked`.
- **Anchors.** Stepping on an Anchor binds it (`anchor_bound`): it is where the Scribe comes back
  after a lost Rift. `rest`, on an Anchor, restores hp and Ink (`rested`).
- **Passages.** An entity of kind `passage` names the map it leads to (`to`). Stepping on it takes
  the Scribe there (`map_changed`, then a `tiles_revealed` with every known tile of that map).
- **Rifts.** Next to a group in sight, `available_actions` offers `enter_rift {group_id}`. Its
  `event` holds `rift_entered`, with the participants as they enter, and the fight's opening. From
  there the fight plays as in section 4. From the rear line, `leave_rift` flees: it costs the action
  and ends the turn, and whoever fled can no longer be targeted;
  when no Scribe is left the fight ends with `combat_ended` and a `null` winner. The message that ends
  the fight also holds `rift_ended` (`won`: the group is gone and the reward is given; `lost`: a
  `respawned` event follows at the bound Anchor, with full hp and Ink, and the group heals; `fled`:
  the group stays, wounded), and the Scribe is back on the map.
- World rejections (`reason_key`): `action.rejected.unknown_tile`, `blocked`, `unreachable`,
  `already_there`, `not_moving`, `no_anchor`, `unknown_group`, `not_adjacent`, `in_rift`,
  `not_in_rift`; `leave_rift` away from the rear gives `action.rejected.not_at_rear`.

## Versions

Every message carries `api_v` (`MAJOR.MINOR`). While the major is 0, a different minor version is
incompatible: a server on 0.6 answers `message.unsupported_version` to a client on 0.5, and the
other way round.

## 6. Reconnect

Keep the highest `seq` you have applied. After a drop, open
`ws://<host>/play?token=<token>&since=<seq>`: the server resends every `event` message with a
higher `seq`, in order, and nothing else. Without `since` you get a fresh `snapshot`.
A `since` that is not a whole number, or is negative, counts as absent: you get a snapshot.
A `since` too far behind the session (more than the server replays, 1000 messages by default), or a
replay the server cannot read, also gets a snapshot.

This works across server restarts: the messages are read back from storage. After a restart the
turn in progress starts again with its full time (the time the server was down does not count) and
the reserve stays as it was; a walk goes on at the next tick.

## Other endpoints

- `GET /rules` (`rules`): the form wheel, the forms and essences (slots, grips, reach), the numbers clients may show,
  and the world: terrain, maps, the tick and the vision radius. Forms, essences and maps the content
  no longer uses carry `obsolete: true`; leave them out when building sets.
- `GET /me` (`me`, Bearer with scope `profile.read`): the account's `sub` and `name`.
- `GET /i18n/{locale}` (`catalog`): text keys to messages; unknown locales get `en`.
