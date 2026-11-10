# Playing a session

A session is one Scribe in the world: it walks a map under fog of war and opens Rifts with the
enemy groups it meets. A session created with an `encounter` is a single fight instead, as in
protocol 0.3. Authentication is fake: a name is enough.

## 1. Create a session

```
POST /sessions        { "player_name": "Ronald", "seed": 42, "map": "first_clearing", "sets": [ … ] }
→ 201                 { "session_id": "s-…", "token": "…", "map": "first_clearing", "encounter": null }

POST /sessions        { "player_name": "Ronald", "encounter": "rift_trial" }
→ 201                 { "session_id": "s-…", "token": "…", "map": null, "encounter": "rift_trial" }
```

Only `player_name` is required. `seed` is 0..2147483647. Without `encounter` the Scribe arrives in
the world on the start Anchor of `map` (`first_clearing`, the default, or `still_crypt`).
`encounter` (`rift_trial`, `rift_first_steps` or `rift_echoes`) makes a fight-only session;
`map` and `encounter` together are invalid. `sets` holds 1 to `max_sets` gear sets (`GET /rules` gives `max_sets`); the
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
Its `mode` is `world` (walking: `world` is set, `rift` is null) or `rift` (fighting: `rift` is set,
and `world` is the map the Scribe will come back to, or null in a fight-only session).

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

## 4. Walk the world

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
  there the fight plays as in section 3. From the rear line, `leave_rift` flees: it costs the action
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
incompatible: a server on 0.4 answers `message.unsupported_version` to a client on 0.3, and the
other way round.

## 5. Reconnect

Keep the highest `seq` you have applied. After a drop, open
`ws://<host>/play?token=<token>&since=<seq>`: the server resends every `event` message with a
higher `seq`, in order, and nothing else. Without `since` you get a fresh `snapshot`.
A `since` that is not a whole number, or is negative, counts as absent: you get a snapshot.

## Other endpoints

- `GET /rules` (`rules`): the form wheel, the forms and essences (slots, grips, reach), the numbers clients may show,
  and the world: terrain, maps, the tick and the vision radius.
- `GET /i18n/{locale}` (`catalog`): text keys to messages; unknown locales get `en`.
