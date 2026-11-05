# Playing a session

Sessions are solo fights: one Scribe against an encounter, played by a signed-in player.

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
| `characters.manage` | reserved for characters (not used yet) |

Access tokens last 5 minutes. Refresh them with the refresh token before they expire.

`POST /sessions` takes the access token as `Authorization: Bearer <token>`; the player's name comes
from the account. Refusals:

| Status | `reason_key` | When |
| --- | --- | --- |
| 401 | `auth.missing_token` | no `Authorization: Bearer` header |
| 401 | `auth.invalid_token` | the token is malformed, forged or expired |
| 403 | `auth.missing_scope` | the token lacks `play` |
| 429 | `rate.limited` | too many sessions; `Retry-After` gives the seconds to wait |

## 1. Create a session

```
POST /sessions        { "seed": 42, "encounter": "rift_trial", "sets": [ … ] }
→ 201                 { "session_id": "s-…", "token": "…", "encounter": "rift_trial" }
```

Every field is optional. `seed` is 0..2147483647. `encounter` is `rift_trial` (the default),
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

Close codes the server uses:

| Code | Reason key | When |
| --- | --- | --- |
| `4401` | `session.unknown_token` | the session token is unknown |
| `4409` | `session.replaced` | another connection took the session over |
| `4403` | `auth.revoked` | the player's access expired, was revoked, or lacks `play` (see "Keeping access") |
| `4429` | `rate.limited` | too many actions, again and again |

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

### Keeping access

The connection stays alive only while the player's access does. Before the access token expires,
refresh it and send the new one:

    { "api_v": "0.4", "type": "reauth", "payload": { "access_token": "<new token>" } }

There is no reply when it is accepted. The token must belong to the same player and client and carry
`play`. If it does not, or if the access expires first (for example because the player revoked the
client), the server closes the connection with `4403`. Sign in again and start or resume the session.

Sending actions too fast gets an `error` with `rate.limited`; keep doing it and the server closes the
connection with `4429`.

## Versions

Every message carries `api_v` (`MAJOR.MINOR`). While the major is 0, a different minor version is
incompatible: a server on 0.4 answers `message.unsupported_version` to a client on 0.3, and the
other way round.

## 4. Reconnect

Keep the highest `seq` you have applied. After a drop, open
`ws://<host>/play?token=<token>&since=<seq>`: the server resends every `event` message with a
higher `seq`, in order, and nothing else. Without `since` you get a fresh `snapshot`.
A `since` that is not a whole number, or is negative, counts as absent: you get a snapshot.

## Other endpoints

- `GET /rules` (`rules`): the form wheel, the forms and essences (slots, grips, reach) and the numbers clients may show.
- `GET /me` (`me`, Bearer with scope `profile.read`): the account's `sub` and `name`.
- `GET /i18n/{locale}` (`catalog`): text keys to messages; unknown locales get `en`.
