# AGENTS.md - MetaChain Engineering Guide

Last reviewed against codebase: 2026-04-01 (commit `d058eb75` + Group photo sync fix + GroupService event listener + Discovery default view set to 'all' + Log optimization strategy + Reply-to-message feature + Reply-to bug fixes: DM Phase 2 drop, channel customid guard, group handler param pass-through)
Scope: `/home/joanramon/Minima/metachain`

## 0) Mandatory Update Mandate (Required)

**ANY AGENT (AI) making modifications to this repository IS REQUIRED to update this file (`AGENTS.md`) before finishing its task.** 

The goal is that any learning, architectural change, new "fragility point" or design decision is recorded here for future agents. Do not use this file only for reading; it is your shared memory.

## 1) Project Intent

MetaChain is a Minima MiniDapp for decentralized messaging, discovery and token interactions.
It runs in two coordinated runtimes:
- Frontend runtime: React + TypeScript app (`src/`)
- Background runtime: Service Worker script (`public/service.js`, built from `public/service-workers/*`)

You must treat this as a distributed local system. Bugs usually come from FE/SW divergence, duplicate handlers, or incorrect assumptions about Maxima contact state.

## 2) Runtime Topology (Critical)

### 2.1 Frontend
- Bootstrapped by `src/main.tsx` and `src/AppContext.tsx`
- Initializes MDS through `MDS.init(...)`
- Owns UI state, route logic, optimistic UX and local cache
- Reads/writes DB via `MDS.sql` wrappers in services
- Also consumes MAXIMA events through `minimaService.processEvent`

### 2.2 Service Worker
- Entry: `public/service-workers/main.js` (compiled to `public/service.js`)
- Initializes its own DB schema and periodic tasks on `NEWBLOCK`
- Handles inbound MAXIMA payload routing:
  - chat
  - contacts
  - maxima contacts
  - groups
  - beacon/gossip
  - profile
  - transaction checks
- Emits FE refresh signals via `MDS.comms.solo(...)`

### 2.3 Real-world consequence
Both FE and SW process overlapping protocol messages. Never implement new protocol logic in one side only without deciding ownership first.

## 3) Source of Truth Rules

When implementing features/fixes, use this precedence:
1. Message persistence + confirmation state: Service Worker is authoritative.
2. UI reaction and route behavior: Frontend is authoritative.
3. Discovery identity cache (`DISCOVERED_PEERS`): shared, but writes must be deterministic and idempotent.
4. Contact permission gating (`allow_non_contact_chats`): DB-driven, not UI-only.

If you are unsure where to place logic, default to SW for network/event ingestion and DB mutation, FE for rendering and user interaction.

### 3.1 Build and Compile Ownership (Owner-run)
- Compilation, build, packaging and release commands are owned by the project maintainer (Joan Ramon).
- Agents do not run `npm run build`, `npm run lint`, `npm run minima:*`, `capacitor` builds, or release packaging unless explicitly requested in that task.
- Agents must always provide exact verification commands and pass criteria in handoff notes, even when they were not executed.

## 4) Beacon + Gossip + MLS (Must Understand)

### 4.1 Beacon transport: P2P, NOT Maxima (with MLS hub exception)

Beacon messages are sent via **Minima P2P network** (`MDS.cmd("message data:0x...")`) which maps to `MSG_GENMESSAGE` (type byte 5) in the Minima NIO layer. This is a **direct-peer broadcast only** — Minima does NOT relay `MSG_GENMESSAGE` between nodes. A node receives a beacon only if it is a direct P2P peer of the sender.

Maxima is used for **unicast follow-up** (gossip replies, chat, history). **Exception:** the Service Worker now also unicasts its own beacon to the configured MLS server via Maxima so the MLS can act as a discovery hub.

### 4.2 Beacon payload and processing
Beacon messages use type `BEACON` (and legacy/MLS registration type `register` is also accepted).

SW `handleBeacon` (`public/service-workers/handlers/beacon.handler.js`) currently enforces:
- required fields: `pubkey`, `address`, `alias`
- debounce: 10s per peer (except `GOSSIP`/`BOOTSTRAP` sources)
- self-beacon ignore by comparing `MY_MAXIMA_PK` (except `source === SELF` so the node can persist itself)
- profile overwrite protection: if incoming `timestamp` is missing and a profile already exists, only `last_seen` is updated
- persistence into `DISCOVERED_PEERS` with `allow_non_contact_chats` and `extra_data`
- public listings sync: `listings` array (max 10, types `group`/`channel`) cached in `DISCOVERED_LISTINGS`, updated only when beacon `timestamp` is newer. Both groups and public channels are listed here; handlers must normalize both types.
- promotion into stable `METACHAIN_USERS`
- reactive relay: when source is `P2P` or `MAXIMA`, calls `sendWelcomePackage` + `askPeers` only when the peer is newly discovered (not already in `DISCOVERED_PEERS`)

### 4.3 Beacon relay chain (how discovery propagates)
When a node receives a beacon from a P2P or MAXIMA source, it:
1. Saves the peer to `DISCOVERED_PEERS`
2. Calls `sendWelcomePackage(pubkey, alias)` — broadcasts ALL known peers as a `peers_response` via `message data:` (P2P broadcast to all direct NIO connections)
3. Calls `askPeers([pubkey])` — sends `get_peers` via Maxima to the new peer

This creates a **reactive multi-hop relay**: Node A broadcasts → Node X (MetaChain) receives → X broadcasts its catalog → Node B (MetaChain, neighbor of X) learns A's existence.

**Critical constraint**: only nodes with MetaChain installed participate in this relay. Nodes without MetaChain receive `MSG_GENMESSAGE` and discard it (Minima core only logs it). There is no way to make non-MetaChain nodes relay beacons.

**Consequence for sparse networks**: two MetaChain nodes that share no MetaChain-running P2P neighbors cannot discover each other via beacon alone. The solution is either a shared MLS server (for Maxima messaging) or a MetaChain node acting as a common P2P neighbor.

### 4.4 Periodic beacon schedule (SW-owned)
SW sends its own beacon every `GOSSIP_INTERVAL` (30s, hardcoded in `public/service-workers/utils.js`) on `NEWBLOCK` events via:
- `sendBackgroundBeacon()` — emits **own** beacon via `message data:` + saves self to DB
- `startGossip()` — if `DISCOVERED_PEERS` is not empty, sends `get_peers` to top 5 peers via Maxima; if empty, falls back to `maxcontacts`

> **Known Bug**: `src/routes/settings/discovery.tsx` exposes `discovery_interval` and `discovery_limit` controls that save values to keypair, but the Service Worker reads **hardcoded** `GOSSIP_INTERVAL`/`BEACON_INTERVAL` from `utils.js` and never reads these keypair values. The settings UI has no effect on the actual gossip frequency. Fix requires SW to read `discovery_interval` keypair value at startup and use it instead of the hardcoded constant. See section 17.

### 4.5 Discovery freshness and cleanup
- SW cleanup TTL for `DISCOVERED_PEERS`: 10 minutes (`startCleanupTimer`)
- Discovery UI online threshold (`src/services/discovery.service.ts`): 5 minutes
Do not change one without evaluating the other.

### 4.6 MLS / Static MLS behavior
MLS is managed through Maxima static MLS configuration (`maxextra action:staticmls`).
UI settings page: `src/routes/settings/discovery.tsx`

Current behavior:
- Reads `maxima action:info` -> `mls` + `staticmls`
- Settings UI supports manual server entry and "use my node as server" mode
- Settings UI does NOT auto-set static MLS on load
- Self-MLS detection uses `p2pidentity` to avoid loops when contact address differs
- `staticmls` persists across normal restarts and is lost only on clean reset or data wipe (e.g. `-clean`, `reset`, basefolder change, or restoring an old backup)
- Service Worker does NOT auto-attempt default static MLS assignment (removed to avoid profile blocking during startup)
- Service Worker does NOT call `bootstrapFromMLS()` on reconnection (removed to avoid message queue saturation)

**Important Change (v0.9)**: Automatic MLS initialization and bootstrap were removed because they caused interference with profile requests and message delivery. If manual MLS configuration is desired, use the UI settings page. Automatic MLS is now only managed through explicit user configuration or operator intervention.

MLS is used for **Maxima routing** (unicast) when manually configured. Nodes can unicast messages and discover peers via MLS assuming both nodes share an MLS server. `get_peers` includes the requester `address` to handle non-contact responses. MLS responses are sent to both `to:<address>` and `publickey` to handle stale/ephemeral addresses.

### 4.7 Permanent registration flow
`minima.service.ts` handles incoming `mls_register_permanent` and runs:
- `maxextra action:addpermanent publickey:<pubkey>`

If you touch MLS flows, preserve compatibility with this type.

## 5) Non-contact Messaging Model (Maxima Constraints)

The app supports communication with peers not present in Maxima contacts.
This depends on fallback routing and discovery cache quality.

### 5.1 Send strategy (required fallback chain)
For chat/contact sends, code paths use variants of:
1. Try `maxima action:send publickey:<0x...>`
2. If “No Contact found”, resolve `Mx...` from `DISCOVERED_PEERS.ADDRESS`
3. Retry `maxima action:send to:<Mx...>`

Relevant files:
- `public/service-workers/utils/maxima-sender.js`
- `src/services/messaging.service.ts`
- `src/services/contact-requests.service.ts`
- `src/services/minima.service.ts` (smart sync/history paths)

Never remove fallback-to-address logic unless replacing it with an equivalent robust path. **Use `poll:false` by default** for all outbound MAXIMA sends to prevent runtime blocking (77s+) when targets are offline or not in contacts.

### 5.5 MDS API: Service Worker vs Frontend (Critical Distinction)

The `MDS` object behaves differently depending on the runtime context:

| Context | `MDS.cmd(string, cb)` | `MDS.executeRaw(string, cb)` | Typed methods |
|---|---|---|---|
| **Service Worker** (raw `mds.js`) | ✅ Callable as a function | ✅ Available | Not applicable |
| **Frontend TS** (`@minima-global/mds`) | ❌ `MDS.cmd` is a **namespace object**, NOT callable | ⚠️ Available but avoid for simple Maxima sends | `MDS.cmd.maxima(...)`, `MDS.cmd.block()`, etc. |

**Rule**: Prefer `MDS.cmd.maxima(...)` (typed API) over `MDS.executeRaw` for all standard Maxima operations from the frontend:
```typescript
// Preferred: typed, clean, and error-safe
MDS.cmd.maxima({
  params: {
    action: 'send',
    to: peerAddress,
    application: 'metachain',
    data: hexData
  }
}, callback);

// Fallback only when raw command string is required (rare):
MDS.executeRaw(`maxima action:send to:${addr} application:metachain data:${hex} poll:false`, callback);
```

Using raw `MDS.executeRaw` adds hidden complexity (SQL dependencies, executeRaw semantics) without benefit for normal sends. `MDS.cmd.maxima()` is the canonical, safe path. Use `executeRaw` only for SQL queries, debug commands, or when a raw string is absolutely necessary — and document why.

### 5.2 Contact systems are intentionally dual
Two parallel protocols:
- MetaChain chat request: `contact_request`, `contact_accepted`, `contact_declined`, `contact_cancelled`
- Maxima contact request: `maxima_contact_request`, `maxima_contact_accepted`, `maxima_contact_declined`, `maxima_contact_cancelled`

Tables:
- `CONTACT_REQUESTS`
- `MAXIMA_CONTACT_REQUESTS`

Do not merge these domains implicitly.

### 5.3 Permission gate for strangers
`allow_non_contact_chats` is stored in:
- `MY_PROFILE` (self policy)
- `DISCOVERED_PEERS` (peer-advertised policy)

Chat open/send logic in `src/routes/chat/$address.tsx` and `src/services/contact-requests.service.ts` relies on this.

If this field is missing/stale, app may incorrectly block or allow chat. Schema migrations and beacon parsing must preserve it.

Canonical key naming rule:
- DB column: `allow_non_contact_chats`
- Beacon/profile JSON field: `allowNonContactChats`
- Legacy keypair fallback keys exist (`allow_noncontact_chats`, `profile_chat_permission_allow_all`).
Do not introduce additional permission key names.

### 5.4 Optimized Non-Contact Messaging (Caching)
To reduce RPC latency and "No Contact found" error noise, both FE and SW implement a session-based `ContactStatusCache` (Record<publicKey, boolean>).

**Sending Strategy (Dual-Runtime):**
1. **Recipients in Contacts**: Prioritize `maxima action:send publickey:<0x...>` (standard Maxima routing).
2. **Recipients NOT in Contacts**: 
   - Resolve `Mx...` address from `DISCOVERED_PEERS`.
   - If resolved, send via `maxima action:send to:<Mx...>` directly, bypassing the initial `publickey` attempt.
   - If not resolved, fallback to `publickey` (standard behavior).

**Cache Lifecycle:**
- **Initialization**: Populated on the first message send to a peer by checking `MAXIMA_CONTACT_REQUESTS` and `CONTACT_REQUESTS`.
- **Invalidation**: Cleared automatically via `clearContactStatusCache(publicKey)` when a contact request is accepted in either frontend (`contact-requests.service.ts`) or service worker (`contact.handler.js`).
- **Persistence**: Session-only (in-memory).

## 6) FE <-> SW Coherence Contract

### 6.1 Events/signals in use
- SW -> FE:
  - `MDS.comms.solo("CHAT_LIST_UPDATE")`
  - reconnect signal via `MDS.comms.solo(JSON.stringify({ type: 'RECONNECTED', ... }))`
  - `MDS.comms.solo(JSON.stringify({ type: 'profile_response', publickey, data }))` — SW forwards received profile_response to FE so `ProfileService` can resolve pending promises
  - `MDS.comms.solo(JSON.stringify({ type: 'group_list_updated' }))` — fired by SW after inserting a new group from a `group_invite` (invite-link join path); triggers `GROUP_UPDATE` CustomEvent in FE
  - `MDS.comms.solo(JSON.stringify({ type: 'group_sync_start', groupId }))` — fired by SW immediately after a group join to trigger history sync on the joiner side; **lowercase** (unlike `GROUP_SYNC_START` which is fired during the sync protocol itself)
- FE internal browser events:
  - `peer_updated`
  - `DISCOVERY_UPDATE`
  - `minima_balance_update`
  - `profile_response_received` — dispatched by `minima.service.ts` when a forwarded profile_response arrives; detail: `{ publickey, profile }`

Bridge caveat:
- `CHAT_LIST_UPDATE` is consumed through `MDS.init` event handling (`minimaService.processEvent`) and also legacy `window.MDS_SOLO_LISTENER` usage in `ChatsAndGroups`.
- Reconnect handling is normalized in `minimaService.processEvent` (parses `RECONNECTED` from MDS event payloads) and calls `offlineQueueService.triggerImmediateRetry(...)`.
- `offline-queue.service.ts` still keeps a `window.message` fallback listener for compatibility, but MDS event handling is canonical.
- If you change SW comms payload shape, update all FE listeners in the same patch.
- **Log Noise Suppression**: FE `minimaService.processEvent` must silently ignore internal protocol types (`chat_history_request`, `sync_status_check`, etc.) that are already handled by the Service Worker to keep console clean.

### 6.2 Message insertion ownership
- SW inserts inbound messages/history and updates delivery/read where applicable.
- FE should avoid duplicate inserts when SW already writes.
- Use `skipMessageInsert` patterns where available for optimistic actions that are mirrored by SW.

### 6.3 History/sync ownership
SW handles:
- `chat_history_request`
- `chat_history_response` DB merge
- gap detection by `sender_seq`
- `sync_status_check` / `sync_status_report`
- group/channel history request fanout and `*_SYNC_START`/`*_SYNC_END` signaling, including immediate `*_SYNC_END` when there are no remote peers (or only self)
- group sync timeout and retry via `checkSyncTimeouts()` (hooked to `MDS_TIMER_10SECONDS`)
- chat sync concurrent guard via `_pendingChatSyncs` + `checkChatSyncTimeouts()` (also hooked to `MDS_TIMER_10SECONDS`)
- channel sync concurrent guard via `_pendingChannelSyncs` + `checkChannelSyncTimeouts()` (also hooked to `MDS_TIMER_10SECONDS`)

FE handles:
- triggering sync requests from open chats
- showing syncing UI and refresh requests

Do not create independent history merge algorithms in FE.

### 6.4 Protocol Matrix (Ingress -> Persistence -> UI)
| Protocol / Type | Ingress Owner | Persistence Owner | Primary Tables | FE Refresh Signal |
| --- | --- | --- | --- | --- |
| `BEACON`, `register` | SW `main.js` -> `beacon.handler.js` | SW | `DISCOVERED_PEERS`, `METACHAIN_USERS`, `DISCOVERED_LISTINGS` | no direct SW signal; FE refreshes via DB reads / discovery events |
| `get_peers`, `peers_response` | SW `gossip.handler.js` | SW | `DISCOVERED_PEERS` | `DISCOVERY_UPDATE` |
| `text`, `token`, `charm` chat payloads | SW `chat.handler.js` | SW | `CHAT_MESSAGES`, `TRANSACTIONS` (tx flows) | `CHAT_LIST_UPDATE`, `onNewMessage` |
| `delivery_receipt`, `read` | SW `chat.handler.js` | SW | `CHAT_MESSAGES` | `onNewMessage` |
| `contact_request` domain | SW `contact.handler.js` | SW | `CONTACT_REQUESTS`, `CHAT_MESSAGES` | `onNewMessage` |
| `maxima_contact_*` domain | SW `contact.handler.js` | SW | `MAXIMA_CONTACT_REQUESTS`, `CHAT_MESSAGES` | `onNewMessage` |
| `profile_request`, `profile_response` | SW `profile.handler.js` (both request and response) | SW (authoritative), FE may cache | `DISCOVERED_PEERS`, `MY_PROFILE` | `peer_updated` + `profile_response` forwarded to FE via `MDS.comms.solo` |
| `chat_history_*`, `sync_status_*` | SW `chat.handler.js` | SW | `CHAT_MESSAGES`, `MESSAGE_COUNTERS` | `CHAT_LIST_UPDATE`, `history_sync` |
| `history_request` / `history_response` (groups) | SW `group.handler.js` | SW | `GROUP_MESSAGES` | `GROUP_SYNC_START`, `GROUP_SYNC_END` via `MDS.comms.solo` |
| `chat_history_request` / `chat_history_response` | SW `chat.handler.js` | SW | `CHAT_MESSAGES` | `CHAT_LIST_UPDATE` via `MDS.comms.solo` |
| `channel_history_request` / `channel_history_response` | SW `channel.handler.js` | SW | `CHANNEL_MESSAGES` | `CHANNEL_SYNC_START`, `CHANNEL_SYNC_END` via `MDS.comms.solo` |
| `channel_subscriber_added` / `channel_subscriber_removed` | SW `channel.handler.js` | SW | `CHANNEL_SUBSCRIBERS` | `CHANNEL_UPDATE` via `MDS.comms.solo` |
| reconnect signal (`RECONNECTED`) | SW `main.js` | FE queue state | local queue/cache | offline queue + chat refresh |

### 6.5 Single Owner Per Flow (Do Not Duplicate)
1. Beacon ingestion and peer persistence: SW only.
2. Gossip request/response protocol: SW only.
3. Contact-request protocol state transitions: SW only.
4. History merge, sequence gap recovery and sync reports: SW only.
5. UI presentation, optimistic rendering and route-level UX: FE only.
6. FE can trigger sends; SW owns canonical inbound persistence and reconciliation.
7. `ping`/`pong` protocol responses are SW-owned; FE may observe `pong` for presence UI but must not send `pong`.

### 6.6 Handler Signature Contract (Critical)
For SW message handlers, preserve argument order consistently between dispatcher and handler definitions.

Current required contract examples:
- `handleSyncStatusCheck(msg, fromKey)`
- `handleSyncStatusReport(msg, fromKey)`

Do not swap to `(fromKey, msg)` in dispatcher calls. This breaks sequence SQL checks and sync-gap reporting.

### 6.7 Group Auto-Approve Sync Contract
- Canonical network message for group settings sync (including `auto_approve`) is `group_update_details`.
- SW still accepts legacy `group_info_updated` for backward compatibility, but new sends should use `group_update_details`.
- When a member is promoted to `admin`, the promoter's SW sends a settings snapshot (`group_update_details` with current `auto_approve`) directly to the promoted admin.
- Frontend group creation (`src/routes/create-group.tsx`) must expose and pass the initial `auto_approve` value into `groupService.createGroup(...)`; otherwise newly created groups default to manual approval even if the UI suggests otherwise.
- `group_invite` must include the current group `avatar`, and SW invite ingestion must persist it into `GROUPS.avatar`; otherwise non-creators see letter avatars in chat lists until a later `group_update_details` happens.
### 6.8 Chat Synchronization and UI Optimizations (FE-side)
1. **Lazy/Debounced Reloads**: Chat message list reloads in `$address.tsx` must be suppressed for "control" payloads (e.g., `ping`, `pong`, `read_receipt`, `delivery_receipt`) that do not change content visibility.
2. **Discovery Loading UX**: When accessing a non-contact's profile, the **Actions** tab in `ContactInfoPage` uses `isCheckingProfile` to show a "Verifying Permissions" loading state while waiting for real-time permission confirmation (via `profile_response`). This prevents UI flashes of restricted states based on stale Discovery/Beacon cache.
3. **Profile Discovery Trigger**: Chat view (`$address.tsx`) and Contact Info both trigger `requestProfile` if the cached peer is a non-contact or has incomplete data (missing alias/address).
4. **Profile Request Guardrails**: `requestProfile` in `profile.service.ts` enforces a 30s per-peer module-level throttle. A `force: boolean = false` parameter bypasses the throttle for explicit user navigations (e.g., `contact-info.$address.lazy.tsx` passes `force: true`). The SW `handleProfileRequest` does NOT throttle — any throttle there was removed because it silently dropped retries for legitimate re-requests. The SW response send uses `poll:false` via `MDS.cmd` (raw string). The FE request send uses `MDS.executeRaw` with `poll:false` for direct P2P delivery (~1–3s); without `poll:false`, delivery waits for a blockchain block event (~10–20s per hop).
5. **Discovery Identity Preview**: `/discovery` should avoid prefix/suffix-only truncation for user IDs because many Minima public keys share visually similar starts/ends. Prefer rendering a centered middle segment for quick human differentiation.
6. **Creator/Admin Badge Checks**: Channel creator badges in FE lists must compare `admin_publickey` and `myPublicKey` case-insensitively (`.toUpperCase()` on both sides). A strict string compare mislabels the creator as `admin` when one side uses `0x` and the other `0X`.
7. **Rhino Syntax Guard**: Service Worker code must avoid trailing commas in function parameter lists. Rhino/Nashorn throws `EvaluatorException: missing formal parameter` and the service starts in a broken state even though Minima still reports `Started service.js`.

## 7) Ordering, Dedup and Transaction Safety

### 7.1 Message ordering invariants
Use this mental model:
- Primary order: `COALESCE(original_timestamp, date)`
- Sequence order: `sender_seq` for same sender
- Pending (`sender_seq=0`) should be placed after confirmed same-sender messages

### 7.2 Dedup keys
In practice, dedup depends on combinations of:
- `customid` (best)
- `sender_seq`
- content + timestamp window fallback

Do not simplify dedup to a single key.

### 7.3 Transaction coupling
For token/charm lifecycle, keep `txpowid` synchronized in both:
- `TRANSACTIONS.txpowid`
- `CHAT_MESSAGES.txpowid`

Confirmation/recovery logic depends on that coupling.

### 7.4 History dedup strategy
`checkByContentAndTime()` in `chat.handler.js` deduplicates messages using **timestamp window + type only** — NOT message content. Reason: token and charm messages differ between sender (`message` includes `tokenid`) and receiver (no `tokenid`), so content-based matching caused false negatives and duplicate insertions. The current query matches:
```sql
WHERE publickey='...' AND username='Me'/'...'
AND type='<type>'
AND (original_timestamp BETWEEN <min> AND <max>)
```
Do not add a `message=` clause back to this query.

### 7.5 History processing concurrency
`_historyProcessingLock` in `chat.handler.js` is a per-peer mutex (plain object). When a `chat_history_response` arrives, the lock prevents parallel processing for the same peer, which would cause duplicate inserts. The lock is released in the final batch completion callback (`processHistoryMessage` when `index >= messages.length`) and on empty-history early-return. Always preserve this lock pattern when refactoring history processing.

## 8) SQL and Data Conventions (Production Guardrails)

1. Always escape interpolated user values (`escapeSql()` or equivalent safe transform).
2. Assume H2/Minima row keys may arrive uppercase (`ROW.FIELD`) or lowercase.
3. Use explicit `UPPER(...)` comparisons for public key matching where casing may drift.
4. Keep SQL keywords uppercase and multiline SQL readable for review.
5. Every schema change requires:
- SW `db-init.js` migration
- FE `database.service.ts` migration parity

Never add a new column in only one runtime.

6. Schema parity for shared tables must keep minimum compatible columns across both runtimes:
- `DISCOVERED_PEERS`: `publickey`, `address`, `alias`, `last_seen`, `source`, `allow_non_contact_chats`, `bio`, `extra_data`, `avatar`, `minimaaddress`
- `DISCOVERED_LISTINGS`: `owner_publickey`, `listings`, `timestamp`, `last_seen`
- `METACHAIN_USERS`: `publickey`, `alias` (plus SW registry fields used by discovery merge)
- `MESSAGE_COUNTERS`: `publickey`, `next_seq`

  **`DISCOVERED_PEERS` extended columns** (added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):
  - `bio` — profile bio cached from beacon payload (`p2p_bio` keypair)
  - `extra_data` — JSON blob with additional profile fields (avatar URL, etc.)
  - `avatar` — avatar URL cached directly for quick access
  - `minimaaddress` — Minima wallet address, populated from profile_response (not beacon)

If one runtime extends a shared table, add backward-compatible `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` in both runtimes.

7. **Virtual Column Constraint**: Do NOT use `ALTER TABLE ... ALTER COLUMN ... SET DATA TYPE` for computed/virtual columns (e.g. `AS UPPER(...)`). H2 does not allow altering columns referenced by expressions. Ensure `ADD COLUMN IF NOT EXISTS` already specifies the desired length.

## 9) TypeScript and Frontend Standards

1. Must pass strict TS (`npm run build` includes type-check).
2. Avoid `any`; if unavoidable, isolate and document boundary.
3. Use path aliases (`@/...`) in frontend code.
4. Prevent render churn in hot chat paths:
- memoize heavy computed lists
- avoid unstable inline object/array props for repeated components
5. All async MDS operations must have error handling and timeout where UX-critical.

## 10) Logging Standard

Use consistent prefixed logs so cross-runtime traces are searchable:
- `[SW]`, `[CHAT]`, `[GOSSIP]`, `[BEACON]`, `[PROFILE]`, `[CONTACTS]`, `[TX]`, `[PERM]`

When changing protocol code, log:
- payload type
- sender (shortened)
- DB action outcome
- fallback path chosen (publickey vs Mx)

**Silence Rule**: Explicitly ignore common internal protocol types in message-reception logs if they are handled by lower layers (e.g., Service Worker) to ensure application logs remain focused on content and state transitions.

## 11) Known Fragility Points

1. Duplicate protocol handlers in FE can appear during refactors. Keep one canonical branch per type.
2. Beacon heartbeat ownership is SW-only; FE should not auto-send beacons on startup. Manual `sendBeacon()` calls are allowed for explicit profile/update actions.
3. `DISCOVERED_PEERS.ADDRESS` normalization is essential (whitespace/port cleanup) to avoid Maxima send failures.
4. Chat acceptance may involve migration from `Mx...`-keyed rows to `0x...` public key rows; preserve that migration logic.
5. SW sync handler dispatch must match function signatures (`msg, fromKey`). Mismatched order silently corrupts sync logic.
6. FE currently has mixed comms listeners (`MDS.init` event handling + `window.MDS_SOLO_LISTENER` + `window.message` for reconnect). Treat bridge changes as high-risk.
7. Chat-permission state uses DB first with legacy keypair fallbacks. Adding new key names increases false allow/deny risk.
8. Group invite payload member fields can arrive with uppercase DB-style keys (`PUBLICKEY`/`USERNAME`/`ROLE`) or protocol lowercase keys; invite send/receive paths must normalize both.
9. Legacy/corrupt `GROUP_MEMBERS` rows with blank `publickey` can break Maxima sends (`BLANK param not allowed : publickey`); sender/sync loops must skip and cleanup blank keys.
10. **`discovery_interval` / `discovery_limit` keypair values must be read by the SW on `inited`**: `src/routes/settings/discovery.tsx` saves these to keypair. The SW reads them in the `inited` handler (`main.js`) and updates the `GOSSIP_INTERVAL` (ms) and `DISCOVERY_LIMIT` globals in `utils.js`. If you add new settings that affect SW behaviour, follow this same pattern. Minimum values are enforced: `discovery_interval >= 30s`, `discovery_limit` between 1 and 50. *(Fixed in v0.9; previously the SW ignored these keypair values entirely.)*
11. **Beacon transport is P2P-only (`MSG_GENMESSAGE`), not Maxima**. Two MetaChain nodes with no shared MetaChain-running P2P neighbor cannot discover each other via beacon. Do not assume discovery will work on sparse mainnet deployments without a common MetaChain relay node or shared MLS for Maxima fallback. See section 4.3.
12. **`MDS.comms.solo("type")` does NOT support a second callback argument** in the Minima JS/TS bridge. Providing one (a frequent legacy pattern) causes the notification to fail silently. Notifications must be fire-and-forget; let the FE logic handle state transitions via DB reads.
13. **Blocking Sends (`poll:true`) are prohibited** in hot paths (chat/beacon/history). A blocking send to an offline peer will freeze the Service Worker event loop for ~77 seconds, pausing all gossip, incoming message processing, and DB maintenance. Always use `poll:false`.
14. **Dual Identity (Mx vs 0x)**: Messages arriving via Service Worker always use Hex Keys. Frontend must query using both the address from the URL (`Mx...`) and the canonical Hex Key (`0x...`) to ensure all messages are visible.
15. **SW/FE Race Condition**: Maxima events trigger reloads in both SW (persistence) and FE (UI). FE must use a small delay (e.g. 200ms) for `MAXIMA` content reloads to ensure SW has finished its DB work. `CHAT_LIST_UPDATE` signals from SW are deterministic and do not require a delay.
16. **`MDS.cmd` is NOT callable as a function from the frontend TypeScript context**. `MDS.cmd` in `@minima-global/mds` is a namespace object with typed methods (`MDS.cmd.maxima(...)` etc.), not a function. Calling `(MDS.cmd as any)(rawString, cb)` silently does nothing or ignores `poll:false`. Always use the typed `MDS.cmd.maxima(...)` API for Maxima sends; reserve `MDS.executeRaw` for SQL queries only. See section 5.5.
17. **H2 BOOLEAN columns return strings, not booleans**. `SELECT allow_non_contact_chats` returns `"true"` or `"false"` (strings), not JS `true`/`false`. All boolean DB checks must handle both: `value === 1 || value === true || value === "1" || value === "true"`. Missing this causes permission gates to always evaluate to `false`.
18. **`MDSCOMMS` not `MDS_SOLO`**: `MDS.comms.solo()` in the SW fires a **`MDSCOMMS`** event at the frontend, NOT `MDS_SOLO`. The event data structure is `{ event: "MDSCOMMS", data: { public: false, message: "<string>" } }` — the payload string is at `event.data.message`, not `event.data`. In `processEvent` (minima.service.ts), always check `event.event === "MDSCOMMS"` and extract `event.data?.message ?? event.data`. Using the wrong event name means `NEW_CHAT_MESSAGE` and `CHAT_LIST_UPDATE` signals from the SW are silently dropped, causing messages to not appear in the UI unless a MAXIMA fallback fires.
19. **Profile Request/Response Simplicity**: Profile request/response must NOT use `MDS.executeRaw` SQL lookup or add requestId tracing. The FE uses `MDS.cmd.maxima()` to send directly to `peerAddress`; the SW sends the response via `MDS.cmd()` directly to `requesterAddress` (validating the Mx prefix). Avoid complexity: keep the flow straightforward with regex address validation and fallback-to-publickey logic.
20. **Public Key Case Inconsistency (`0x` vs `0X`)**: Minima/Maxima returns public keys with lowercase `0x` prefix, but DB `UPPER()` calls and some internal flows store them with uppercase `0X`. Any code that uses `startsWith('0x')` or `Set.has(publickey)` for comparison MUST be case-insensitive (use `.toLowerCase().startsWith('0x')` or normalize both sides with `.toUpperCase()`). This caused silent Maxima send failures and contact list duplication.
21. **`MDS.cmd("timer X", callback)` fires immediately in Rhino**: In the Minima Service Worker (Rhino/Nashorn engine), `MDS.cmd("timer 30000", cb)` calls `cb` immediately with the command result — it does NOT wait X milliseconds. Use `MDS_TIMER_10SECONDS` (fires every ~10s reliably) combined with `Date.now()` timestamps for real elapsed-time checks. Pattern: store `startedAt: Date.now()` in state, check `Date.now() - startedAt >= threshold` inside a `checkXxxTimeouts()` function called from `MDS_TIMER_10SECONDS` handler. See `checkSyncTimeouts()` in `group.handler.js`.
22. **Group sync pubkey case normalization**: Public keys stored in `GROUP_MEMBERS` come from SQL as uppercase (`0X30819F...`), but Maxima `msg.data.from` delivers them lowercase (`0x30819f...`). Any `pending`/`paginating` tracking object that uses pubkeys as keys MUST normalize with `.toUpperCase()` on both write and read. Failure causes `delete pending[pubkey]` to silently no-op, leaving remaining count stuck and sync completing only via timeout.
23. **Mobile long-press menus must not rely on a document-level `click` to close**: In `src/components/chat/ChatsAndGroups.tsx`, the archive/favorite menu is opened from `onTouchStart` after a 500ms timer. Mobile browsers then emit a synthetic `click` on finger release; if the component closes the menu from `document.addEventListener("click", ...)`, the menu appears and disappears immediately. Use `pointerdown` outside detection, keep a ref to the menu container, and ignore outside-close events for a short window right after opening from long-press.
24. **Inbox long-press context menus should deep-link to existing info screens instead of duplicating actions inline**: `src/components/chat/ChatsAndGroups.tsx` now routes from the context menu to `/contact-info/$address`, `/group-info/$groupId`, or `/channel-info/$channelId` via a typed `itemType` stored in the menu state. If you add more inbox actions, prefer routing into the canonical profile/info pages rather than recreating profile/group/channel management UI inside the menu.

25. **Chat sync concurrent guard (`_pendingChatSyncs`)**: `requestChatHistory()` in `chat.handler.js` must check `_pendingChatSyncs[normPk]` before sending a request. Without this guard, startup sync (`requestHistoryFromRecentContacts`) and frontend-triggered syncs can issue multiple overlapping requests to the same peer within milliseconds — observable as 4+ `[HISTORY-SYNC] Requesting history from: 0X30819F30` entries in a single startup. The guard key MUST be normalized with `.toUpperCase()` (same reason as #22). The guard is cleared in `handleChatHistoryResponse()` on response, and by `checkChatSyncTimeouts()` after 30s on timeout.

26. **Frontend `historyRequestedFor` guard must use `.toUpperCase()`**: The React ref `historyRequestedFor.current` in `$address.tsx` is compared with `contact.publickey` to prevent duplicate sync triggers within a session. If not normalized, `0X30819F...` (from SQL) and `0x30819F...` (from Maxima) bypass the guard and trigger two independent sync cycles. Fix: compare and assign using `contact.publickey.toUpperCase()`.

27. **Channel sync concurrent guard (`_pendingChannelSyncs`)**: `requestChannelHistoryFromSW()` in `channel.handler.js` must check `_pendingChannelSyncs[channelId]` before sending requests. Without this guard, startup fanout and FE-triggered syncs can issue overlapping requests. The guard is cleared: (a) in `handleChannelHistoryResponse()` on first valid response received; (b) in all early-exit paths of `requestChannelHistoryFromSW()` (SQL error, no remote peers); (c) by `checkChannelSyncTimeouts()` after 30s on timeout. Unlike group sync, channels take the first response (no per-peer tracking needed).

28. **`handleChannelSubscriberAdded/Removed` must exist before main.js dispatches to them**: `main.js` calls these functions when `messageType === "channel_subscriber_added/removed"` is received. If the stubs are absent, Rhino throws `ReferenceError` and silently drops the message. Both functions upsert/delete from `CHANNEL_SUBSCRIBERS` and fire `CHANNEL_UPDATE` via `MDS.comms.solo`.

29. **Channel startup sync self-filter must be case-insensitive**: `requestChannelHistoryFromSW()` skips the local node when fanning out history requests using `if (subPk === myPubkey) continue`. `myPubkey` comes from `maxima action:info` (lowercase `0x...`) but `CHANNEL_SUBSCRIBERS` rows may have been inserted with uppercase `0X...`. The strict equality bypasses the self-filter, causing the node to send a redundant history request to itself on startup. Fix: `subPk.toUpperCase() === myPubkey.toUpperCase()`.

28. **`ON CONFLICT ... DO UPDATE` is PostgreSQL syntax — H2 uses `MERGE INTO ... KEY (...) VALUES (...)`**: Any upsert using PostgreSQL's `ON CONFLICT(col) DO UPDATE SET` will throw `JdbcSQLSyntaxErrorException [42000-214]` and silently fail, leaving counters/state permanently stale. All upserts must use H2's `MERGE INTO table (cols) KEY (key_cols) VALUES (vals)` syntax. Affected table: `CHANNEL_MSG_COUNTERS` (corrected). Check all future upserts.

30. **TypeScript service return objects use lowercase keys — never cast to `any` and access uppercase**: `getGroupInfo()`, `getMyGroups()`, and similar service methods explicitly map SQL rows to TypeScript objects with **lowercase** field names (`group.name`, `group.description`, `group.created_date`, etc.). If you cast the result to `any` and access `(group as any).NAME`, you get `undefined` — which `JSON.stringify` **silently omits** from the serialized message. The receiver then gets a protocol message with a missing required field (e.g., no `groupName` in a `group_invite`), which the SW inserts as an empty string. Always use the typed field name directly (e.g., `group.name`). This affected 7 call sites in `group.service.ts` (bugs W and X). SQL row objects from `MDS.sql` still use uppercase (`row.NAME`), but typed service return objects do not.

31. **React component re-mapping of service data must use spread, not explicit uppercase fields**: When a component calls a service method and then re-maps the result to a new object, do not rebuild the object with hardcoded uppercase assumptions (e.g., `{ group_id: group.GROUP_ID, name: group.NAME }`). This silently sets every field to `undefined` when the service returns lowercase keys. Use `{ ...group, extraField: computedValue }` to preserve all service-layer keys while adding computed fields. Confirmed pattern: `GroupList.tsx` was rebuilding the object with uppercase field names; fix was to replace with `...group` spread (bug W).

32. **Group metadata broadcasts must reuse the same sender path as `group_message` / `group_invite`**: `group_update_details` and `group_role_update` can silently fail to reach existing members if they use ad-hoc `MDS.cmd.maxima({ to:<Mx...> })` sends. Reuse `sendMaximaMessage()` so metadata changes get the same `to:<Mx...>` plus `publickey:` fallback path, and compare self pubkeys case-insensitively when skipping the sender.

29. **New subscriber must insert admin into `CHANNEL_SUBSCRIBERS` before requesting history**: When `handleChannelInvite` runs on the subscriber side, only the invitee (self) is inserted into `CHANNEL_SUBSCRIBERS`. `requestChannelHistoryFromSW` queries that table to find who to send the history request to — finding only self, it exits with `No remote subscribers` and the subscriber never receives historical messages. Fix: after inserting self, also insert the admin (`maxjson.adminPublickey`, `maxjson.adminUsername`, `role='admin'`) via `MERGE INTO CHANNEL_SUBSCRIBERS (..., joined_date, ...) KEY (...) VALUES (...)`, then call `requestChannelHistoryFromSW` in the callback. **Critical**: `joined_date BIGINT NOT NULL` must be included in the MERGE — omitting it causes H2 to silently reject the insert (NOT NULL violation), leaving the admin absent and the history request going nowhere.

33. **`minima.service.ts` MDSCOMMS handler must include all SW group event types**: The SW fires `group_list_updated` (after inserting a new group from a `group_invite`) and `group_sync_start` (lowercase, after invite-link joins). The MDSCOMMS handler in `minima.service.ts` must include both in its condition alongside `group_update`, `GROUP_SYNC_START`, and `GROUP_SYNC_END`. Without them, the joiner's frontend never dispatches `GROUP_UPDATE`, so the group does not appear in the chat list — even though the SW has already inserted it into the DB. Always update this condition when the SW adds new group signal types.

35. **`loadMessagesFromDB` Phase 2 map must include ALL fields from Phase 1**: `loadMessagesFromDB` in `$address.tsx` runs a two-phase parse. Phase 1 maps every DB row into a rich object (including `replyTo`, `forwarded`, `type`, `filedata`, etc.). Phase 2 runs a `Promise.all` to check transaction status for token/charm messages and returns a NEW object. If Phase 2's return object omits any field from Phase 1, that field silently disappears from the rendered messages. This caused `replyTo` to appear briefly (optimistic) and then vanish as soon as `loadMessagesFromDB` completed. Rule: when adding any new field to the Phase 1 map object, **always** add the same field to the Phase 2 return object. The Phase 2 return currently covers `id, text, fromMe, charm, amount, timestamp, status, tokenAmount, isCharm, isToken, sender_seq, customid, originalTimestamp, isSystem, type, filedata, forwarded, replyTo`.

36. **`CHANNEL_MESSAGES` has no `customid` column — reply-to guard must use `reply_to_text || reply_to_sender`**: `CHAT_MESSAGES` and `GROUP_MESSAGES` have a `customid` column populated at insert time. `CHANNEL_MESSAGES` does NOT. When a user taps Reply on a channel message, `msg.customid` is always `""` (empty string). This makes `replyTo.customid = ""`, which is falsy — so `reply_to_customid` is stored as `NULL` in the DB. Any display condition of the form `(row.REPLY_TO_CUSTOMID) ? {...} : null` always returns `null` for channels. The correct guard for channels is `(row.REPLY_TO_TEXT || row.REPLY_TO_SENDER) ? {...} : null`, since those columns ARE populated even when `customid` is empty. This fix applies in both `channels.$channelId.lazy.tsx` `loadMessages` and `channel.handler.js` history row mapping. If you add `customid` to `CHANNEL_MESSAGES` in the future, this guard can be reverted, but the migration must also backfill existing rows.

37. **SW handler function parameter lists must exactly match the call site — missing params become `undefined`, not a ReferenceError**: In `group.handler.js`, `handleGroupMessage()` parses `grpReplyToCustomid`/`Text`/`Sender`/`Type` from the inbound payload and then calls `processGroupMessage(...)`. If these 4 variables are NOT passed as arguments, `processGroupMessage` tries to reference them as free variables — they are defined in `handleGroupMessage`'s scope, not `processGroupMessage`'s. This is fine on the sender's node (they share a scope), but crashes with `ReferenceError` on the receiver's node where `handleGroupMessage` is running in a different call context. Result: **every incoming group message crashes the SW silently** — recipients never receive messages. Fix: always pass new state variables as explicit function arguments, never rely on lexical scope bridging between sibling functions in the SW.

34. **`handleChannelInvite` must fire `CHANNEL_UPDATE` even when the channel already exists**: When a user re-joins via invite link and the channel is already present in the DB, `handleChannelInvite` was silently returning without notifying the frontend. The frontend never dispatched `CHANNEL_UPDATE`, so the channel did not appear in the chat list for the joiner. Fix: on the early-exit path, fire `MDS.comms.solo(JSON.stringify({ type: "CHANNEL_UPDATE", channelId }))` and call `requestChannelHistoryFromSW(channelId)` before returning. This also handles cases where a user reinstalls/resyncs and their DB is partially empty.

## 12) Pre-merge Checklist (Mandatory for protocol/state changes)

1. Owner runs `npm run lint`.
2. Owner runs `npm run build`.
3. Verify one full flow of each:
- contact request accept/decline
- maxima contact request accept/decline
- non-contact message send via fallback address
- discovery refresh from beacon/gossip
- history sync after reconnect
- token/charm pending -> confirmed
4. Validate both runtimes touched as needed:
- FE `src/services/*` / routes
- SW `public/service-workers/*`
5. Agent handoff must explicitly say `Owner-run pending` for any build/test command not executed by the agent.
6. If your change touches protocols, discovery, permissions, sync, DB schema or runtime ownership rules, update `AGENTS.md` in the same patch.
7. If you intentionally do not update `AGENTS.md`, include `AGENTS.md: N/A` with explicit reason.

## 13) Regression Playbook (Owner-run, executable)

1. Action: Configure `staticmls` on two nodes (`/settings/discovery`) and ensure both show a connected server.
Expected: both nodes display a populated MLS value and no discovery error.
2. Action: Wait for beacon/gossip cycle, then open `/discovery`.
Expected: peer appears in `DISCOVERED_PEERS` and is shown online when `last_seen` is fresh.
3. Action: Send a message to a non-contact peer (not in `maxcontacts`).
Expected: fallback path succeeds (`publickey` send or `to: Mx...` retry) and message is persisted once.
4. Action: Send/accept/decline MetaChain `contact_request`.
Expected: `CONTACT_REQUESTS.status` transitions are consistent on both nodes and chat system message is inserted once.
5. Action: Send/accept/decline `maxima_contact_request`.
Expected: `MAXIMA_CONTACT_REQUESTS.status` transitions are correct and contact add path is only triggered on accepted flow.
6. Action: Force offline period on one node, then reconnect.
Expected: reconnect signal triggers sync path; missing messages are recovered through `chat_history_*` / `sync_status_*`.
7. Action: Send token/charm transfer and wait confirmations.
Expected: `TRANSACTIONS.status` and `CHAT_MESSAGES.state` converge; `txpowid` remains linked in both tables.
8. Action: Toggle `allow_non_contact_chats` and retry stranger chat.
Expected: permission gate behavior changes accordingly and beacon updates propagate the new flag.

## 14) Files You Should Read First for Networking Features

1. `public/service-workers/main.js`
2. `public/service-workers/handlers/beacon.handler.js`
3. `public/service-workers/handlers/gossip.handler.js`
4. `public/service-workers/handlers/chat.handler.js`
5. `src/services/minima.service.ts`
6. `src/routes/chat/$address.tsx`
7. `src/services/contact-requests.service.ts`
8. `src/routes/settings/discovery.tsx`

## 15) Non-goals / What Not To Do

- Do not remove sequence tracking or gap-detection because it “looks complex”.
- Do not assume Maxima contacts are required for all sends.
- Do not move protocol DB writes fully into FE.
- Do not change beacon/MLS payload types without backward compatibility.
- Do not introduce schema drift between SW and FE DB initialization code.

## 16) AGENTS.md Maintenance Rules

1. Update the header review line (date + commit hash) whenever protocol handlers, discovery logic, or DB schema are touched.
2. Any new message type must update section `6.4 Protocol Matrix` and section `6.5 Single Owner Per Flow` in the same change.
3. Any schema change must include migration parity in both runtimes:
   - `public/service-workers/db-init.js`
   - `src/services/database.service.ts`
4. Documentation update is mandatory in the same patch when changes impact behavior described in this file (protocols, flows, schema, ownership, guardrails).
5. If a PR/patch touches networking logic and does not update this document, include an explicit `AGENTS.md: N/A` rationale in handoff notes.
6. Handoff notes must include one line: `AGENTS.md updated: yes/no` and, if `yes`, list affected sections.

## 17) Open Bugs / Pending Fixes

| # | Component | Description | Severity |
|---|---|---|---|
| ~~1~~ | ~~`src/routes/settings/discovery.tsx` + `public/service-workers/utils.js`~~ | **Fixed.** On `inited`, SW now reads `discovery_interval` (seconds → ms) and `discovery_limit` from keypair and updates `GOSSIP_INTERVAL` and `DISCOVERY_LIMIT` globals. `startGossip()` uses `DISCOVERY_LIMIT` instead of hardcoded `LIMIT 5`. Changes take effect on next SW restart. | ~~Medium~~ |
| 2 | Discovery / mainnet | Two MetaChain nodes with no shared MetaChain P2P neighbor cannot discover each other via beacon relay. No fix possible at SW level without a common MetaChain intermediary or MLS-based Maxima contact exchange. | By design / known limitation |

### Closed / Fixed (v0.9)
| # | Component | Description |
|---|---|---|
| A | Profile Request Bug | Auto-MLS bootstrap and aggressive requestId + SQL lookup in profile requests caused timeouts and blocking sends. Reverted both the FE and SW to simple, direct routing with typed `MDS.cmd.maxima()` and regex address validation. Service Worker no longer auto-attempts static MLS or calls `bootstrapFromMLS()` on reconnection. |
| B | Profile Response Not Resolving | SW received `profile_response` and saved it to DB but never notified the FE, so `ProfileService` promises timed out after 30s. Fix: SW `profile.handler.js` now forwards the response via `MDS.comms.solo({ type: 'profile_response', publickey, data })`. FE `minima.service.ts` routes it to `profileService.handleProfileResponse()` and dispatches `profile_response_received`. `ProfileService` adds in-flight deduplication and 30s throttle per peer. |
| C | History Dedup False Negatives (Tokens/Charms) | `checkByContentAndTime()` matched on `message = 'content'` which failed for token and charm messages because the sender includes `tokenid` in the message but the receiver does not. Result: duplicate messages after history sync. Fix: dedup now matches on `type + timestamp window` only, without content comparison. See section 7.4. |
| D | Charm UI (status + animation) | Charm messages used `bg-transparent` bubble and showed no PROCESSING/CONFIRMED/FAILED status. Also, `FlyingMoney` animation only fired for token transfers, not charms. Fix: charm and token transfer now share a unified card component in `MessageBubble.tsx` with consistent bubble style, status badge, and pending animation. |
| E | Profile Response Silent Fail | SW `profile.handler.js` called `MDS.comms.solo(payload, callback)` with a second callback argument. Per section 11.12, this causes the notification to fail silently, meaning the FE never received the forwarded profile_response. Fix: removed callback; call is now fire-and-forget `MDS.comms.solo(forwardPayload)`. |
| F | `contact_declined` notification never delivered to sender | `resolveMaximaAddress()` in `contact-requests.service.ts` used `startsWith('0x')` (case-sensitive) which failed for `0X...` keys. Returned the raw key instead of `null`, causing Maxima to send to `to:0X30819F...` (invalid). Fix: use `.toLowerCase().startsWith('0x')` and return `null` on guard fail. Also added fallback to `from_address` stored in `CONTACT_REQUESTS` table. See section 11.20. |
| G | `ContactActions` showing "Send Chat Request" after decline | When `requestStatus === 'declined'`, the condition `requestStatus !== 'declined'` acted as a global veto in the ternary, overriding `userAllowsNonContactChats`. Fix: restructured condition so `userAllowsNonContactChats` is checked independently. |
| H | Chat page reload loop on `contact_declined` | Two separate handlers processed the same `contact_declined` event (lines 1528 and 1600) without a `return` in the first. Result: 2x `checkPending()` + 2x `loadMessagesFromDB()` per event. Also, `searchParams.requestPending` was never cleared, causing every `checkPending()` call to re-trigger `loadMessagesFromDB()`. Fix: consolidated into single handler with `return`, added `requestPendingHandled` ref to fire once. |
| I | Duplicate contacts after Maxima contact accept | `CheckContacts.tsx` dedup used case-sensitive `Set.has()` to filter chat-only contacts. `maxcontacts` returns `0x...` but `CHAT_MESSAGES` stores `0X...`, so the same user appeared twice. Fix: normalize both sides with `.toUpperCase()` before comparison. |
| J | Contact-info shows "Request Maxima Contact" for existing contacts | `isMaximaContact` was set once on mount via `fetchContact()` and never re-checked. Fix: `checkStatus()` now queries `MAXIMA_CONTACT_REQUESTS` for `status='accepted'` in both directions and sets `isMaximaContact(true)` if found. |
| K | Group sync timer fires immediately in Rhino | `MDS.cmd("timer 30000", cb)` was used for retry/timeout logic in `startSyncTimer()`. In the Rhino SW engine, this calls `cb` immediately (not after 30s), causing all 3 retry attempts within 1-2 seconds and the sync completing before any peer responses arrived. Fix: removed `startSyncTimer()`; added `startedAt: Date.now()` to `_pendingSyncs` state and `checkSyncTimeouts()` called from the `MDS_TIMER_10SECONDS` event handler. See section 11.21. |
| L | Group sync peer tracking broken by pubkey case mismatch | `_pendingSyncs[groupId].pending` was keyed with SQL-uppercase pubkeys (`0X...`), but `markSyncPeerDone()` received Maxima lowercase pubkeys (`0x...`). `delete pending[pubkey]` was a no-op, so `remaining` never reached 0 and syncs always completed via timeout (30-40s) even when all peers had responded. Fix: `.toUpperCase()` normalization at all write/read points for `pending`/`paginating` objects. See section 11.22. |
| M | Group sync centralized in SW; frontend delegates via service command | Frontend previously ran its own history request logic in `group.service.ts` with empty `senderPublickey` (filled-by comment but never actually filled). Sync was not guarded against concurrent calls. Fix: SW owns all group sync logic via `requestGroupHistoryFromSW(groupId)`; frontend sends `service:GROUP_SYNC:<groupId>` via `(window as any).MDS?.cmd()` to delegate. SW guards against concurrent syncs per group via `_pendingSyncs[groupId]` check. |
| N | Chat sync: multiple concurrent requests per peer, no guard | `requestChatHistory()` had no concurrent guard. Startup sync (`requestHistoryFromRecentContacts`) called it 4x for the same peer due to duplicate entries in `DISCOVERED_PEERS` with different pubkey casing. Frontend also triggered independently. Result: 4+ history requests to the same peer per startup. Fix: added `_pendingChatSyncs[normPk]` guard (normalized to uppercase), cleared on response or 30s timeout via `checkChatSyncTimeouts()`. Also changed `requestChatHistory()` to query DB for last message timestamp instead of hard-coded 7-day window. See sections 11.23–24. |
| O | Chat sync triggered from frontend with stale pubkey case | Frontend `$address.tsx` used `historyRequestedFor.current !== contact.publickey` (exact string) as guard. SQL returns `0X...` and Maxima returns `0x...`, causing the same contact to trigger two independent sync flows per session open. Fix: normalize with `.toUpperCase()` in both the assignment and the comparison. Frontend now delegates to SW via `service:CHAT_SYNC:<pubkey>` instead of calling `messagingService.requestChatHistory()` directly. |
| P | Channel sync had no concurrent guard | `requestChannelHistoryFromSW()` had no guard, so startup fanout and any FE-triggered sync could launch overlapping requests for the same channel. Also `checkChannelSyncTimeouts()` was called in `main.js` but the function did not exist, causing a silent `ReferenceError` every 10 seconds. Fix: added `_pendingChannelSyncs[channelId]` guard (set at entry, deleted at all exit paths and in `handleChannelHistoryResponse()`). Added `checkChannelSyncTimeouts()` with 30s timeout. See section 11.25. |
| Q | `handleChannelSubscriberAdded/Removed` called but not defined | `main.js` dispatched `channel_subscriber_added/removed` messages to these handlers, but they were never implemented. Rhino threw `ReferenceError`, silently dropping all subscriber add/remove events. Fix: added both stubs to `channel.handler.js` and `service.js`. They upsert/delete from `CHANNEL_SUBSCRIBERS` and fire `CHANNEL_UPDATE` via `MDS.comms.solo`. See section 11.26. |
| R | Channel startup sync sends duplicate history requests to same peer | `requestChannelHistoryFromSW()` self-filter used `subPk === myPubkey` (strict equality). `myPubkey` from `maxima action:info` is lowercase (`0x...`) but `CHANNEL_SUBSCRIBERS` rows inserted in prior sessions were uppercase (`0X...`). Both passed the filter, causing two history requests to the same admin peer per startup. Fix: `subPk.toUpperCase() === myPubkey.toUpperCase()`. See section 11.27. |
| S | `CHANNEL_MSG_COUNTERS` upsert silently failed with H2 | Counter update used PostgreSQL `ON CONFLICT(channel_id, sender_publickey) DO UPDATE SET last_seen_seq = N` syntax. H2 throws `JdbcSQLSyntaxErrorException [42000-214]` and the counter stays at 0. Result: every message after seq=1 triggers a false `[CHANNEL-GAP]` detection, which requests a history sync unnecessarily. Fix: replaced with H2 `MERGE INTO CHANNEL_MSG_COUNTERS ... KEY (channel_id, sender_publickey) VALUES (...)`. See section 11.28. |
| T | New subscriber cannot request channel history after joining | `handleChannelInvite` only inserted the invitee (self) into `CHANNEL_SUBSCRIBERS`. `requestChannelHistoryFromSW` queries that table and, finding only self (filtered out), returned `No remote subscribers` immediately — so new subscribers never received messages sent before they joined. First fix attempt failed: `MERGE INTO` omitted `joined_date` which is `NOT NULL`, causing H2 to silently reject the insert. Full fix: `MERGE INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) KEY (channel_id, publickey) VALUES (..., Date.now(), 'admin')`, then call `requestChannelHistoryFromSW` in callback. Verified in logs13: startup sync now correctly sends history requests for all subscribed channels. See section 11.29. |
| U | `handleChannelHistoryRequest` never sent the response | `responsePayload` was built but never serialized — `smartSend` was called with `hexData` which was undefined in that scope (copy-paste omission). The response was silently sent as empty/undefined data, causing every `channel_history_request` to time out after 30s on the requester side. Also, an unnecessary `MDS.cmd("maxima action:info")` wrapper added latency with no benefit (`myPubkey` was unused). Fix: added `var hexData = "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase()` before `smartSend`; removed the `maxima action:info` wrapper. |
| V | `handleChannelJoinRequest` never delivered acceptance to requester | Same `hexData` undefined pattern: `invitePayload` was built correctly but `smartSend(..., hexData, ...)` was called before serializing it. The requester (user who joined via community) never received the `channel_invite` response, so their local DB never inserted the channel — the channel appeared for other subscribers but not for the joiner themselves. Fix: added `var hexData = "0x" + utf8ToHex(JSON.stringify(invitePayload)).toUpperCase()` before `smartSend`. |
| W | `GroupList.tsx` showed undefined name/avatar/description for all groups | `GroupList.tsx` fetched groups via `groupService.getMyGroups()` which returns objects with camelCase/lowercase keys (`group_id`, `name`, `avatar`, etc.), but the map callback accessed them with uppercase keys (`group.GROUP_ID`, `group.NAME`, `group.AVATAR`, etc. — all `undefined`). The return object was rebuilt with these undefined values, so the entire group list rendered as blank. Fix: replaced the explicit field-by-field return with `...group` spread, preserving all keys from `getMyGroups()`. Also added `|| "G"` guard on `group.name.charAt(0)` to prevent crashes on empty name. `ChatsAndGroups.tsx` already used lowercase keys and was unaffected. |
| X | `group_invite` sent without `groupName` — receiver inserts group with empty name | `group.service.ts` methods `addMember`, `removeMember`, `leaveGroup`, `unbanMember`, and `sendGroupMessage` all called `getGroupInfo()` and then accessed the result with uppercase keys `(group as any).NAME`, `.DESCRIPTION`, `.CREATED_DATE`. `getGroupInfo()` returns an object with lowercase TypeScript keys (`group.name`, `group.description`, `group.created_date`). Result: `groupName` was `undefined` → `JSON.stringify` omitted the field → receiver's `handleGroupInvite` got `maxjson.groupName = undefined` → group inserted into GROUPS with `name=''`. Fix: replaced all 7 occurrences of `(group as any).NAME/DESCRIPTION/CREATED_DATE` with `group.name`, `group.description`, `group.created_date`. Root cause is the same pattern as bugs W (uppercase vs lowercase DB row keys) but in the service layer rather than the component. |
| Y | Group photo update not synced to other members | Two bugs combined prevented group avatar updates: (1) **SW security check case-sensitive**: `handleGroupUpdateDetails()` in `group.handler.js` line 1311 checked `publickey='${pubkey}'` (exact match). Maxima delivers pubkey as `0x...` (lowercase) but `GROUP_MEMBERS` stores it as `0X...` (uppercase), causing all authorization checks to fail with "Group not found locally or sender is not a member" — the avatar was never written to the DB. (2) **Frontend not refreshing on SW notification**: `ChatsAndGroups.tsx` calls `groupService.onGroupUpdate(fetchGroups)` to reload the group list when the group changes, but `GroupService.constructor` was empty (unlike `ChannelService` which had a listener). When the SW updated the BD and sent `MDS.comms.solo({ type: "group_update" })`, the frontend received the window event but `GroupService` never fired the callbacks, so `fetchGroups` never ran. Fix: (1) Changed line 1311 to `UPPER(publickey)=UPPER('${pubkey}')` (consistent with other SW security checks). (2) Added window event listener in `GroupService.constructor` (lines 131–139): `if (typeof window !== 'undefined') { window.addEventListener("GROUP_UPDATE", (e) => { if (e.detail?.type === "group_update") { this.notifyGroupUpdate(e.detail?.groupId, e.detail, true); } }); }`. This mirrors `ChannelService` pattern and ensures callbacks fire when the SW notifies. |
| Y | Invite-link joiner's group/channel does not appear in chat list | After joining via `mcgrp://` or `mcch://` invite link: the admin received the join request, processed it, and sent back a `group_invite`/`channel_invite`. The joiner's SW correctly inserted the group/channel into the DB and fired `MDS.comms.solo({ type: "group_list_updated" })`. However, `minima.service.ts` MDSCOMMS handler only handled `group_update`, `group_join_requests_update`, `GROUP_SYNC_START`, and `GROUP_SYNC_END` — `group_list_updated` and `group_sync_start` (lowercase) were silently ignored. No `GROUP_UPDATE` CustomEvent was dispatched → `ChatsAndGroups` never re-fetched → group invisible to joiner. Separately, for channels, `handleChannelInvite` exited silently (no `CHANNEL_UPDATE` fired) if the channel already existed in the DB. Fix: added `group_list_updated` and `group_sync_start` to the MDSCOMMS condition in `minima.service.ts`; added `CHANNEL_UPDATE` + `requestChannelHistoryFromSW` to the early-exit path in `channel.handler.js`. See sections 11.33–34. |

## 19) Reply-to-Message Feature

### 19.1 Overview
Users can reply to any message in DMs, groups, and channels. A reply carries a `replyTo` object in the Maxima payload referencing the original message.

### 19.2 Protocol
`replyTo` is an optional field in ALL outbound message payloads:
```json
{
  "replyTo": {
    "customid": "0x...",
    "text": "Original message preview (max 500 chars)",
    "senderName": "Joan",
    "type": "text"
  }
}
```
If no reply, the field is absent (`undefined`/`null`).

### 19.3 DB Schema
Four new columns added to all 3 message tables via `ADD COLUMN IF NOT EXISTS`:
- `reply_to_customid VARCHAR(512) DEFAULT NULL` — references original message `customid`
- `reply_to_text VARCHAR(512) DEFAULT NULL` — preview of original message text
- `reply_to_sender VARCHAR(160) DEFAULT NULL` — original sender's display name
- `reply_to_type VARCHAR(64) DEFAULT NULL` — original message type (text/image/etc.)

### 19.4 SW Handlers
All 3 SW handlers (`chat.handler.js`, `group.handler.js`, `channel.handler.js`) parse `replyTo` from inbound payload and persist all 4 columns. History request/response flows also include `replyTo` so replies survive history sync.

### 19.5 FE Services
- `messaging.service.ts`: `sendMessage(... replyTo?)` — new last param
- `group.service.ts`: `sendGroupMessage(... replyTo?)` — new last param
- `channel.service.ts`: `publishMessage(... replyTo?)` — new last param

### 19.6 UI
- **MessageBubble**: new `replyTo` prop renders a quote block above the message text. New `onReply` callback prop shows a "Reply" button at top of action menu.
- **Reply banner**: shown above the input bar when `replyingTo` state is set. Shows sender name + text preview. An ✕ button clears it.
- **Channels**: uses custom rendering (no MessageBubble); quote block and "Reply" button rendered inline. Reply available only to admin.

### 19.7 Important Notes
- `replyTo` carries a **snapshot** of the original message text and sender name at send time — it does NOT resolve dynamically from the DB. This is intentional for simplicity and to avoid broken references.
- Channels only allow admin to reply (consistent with the publish-only model).
- The `customid` in `replyTo` is stored for future scroll-to-original functionality but not yet implemented.
- **`CHANNEL_MESSAGES` has no `customid` column**: channel `reply_to_customid` is always NULL. The display guard must check `reply_to_text || reply_to_sender`, NOT `reply_to_customid`. See fragility point #36.
- **`loadMessagesFromDB` Phase 2 must include `replyTo`**: Phase 2 of `loadMessagesFromDB` in `$address.tsx` rebuilds the message object for token/charm status checks. It must explicitly include `replyTo: msg.replyTo` or the field is silently dropped. See fragility point #35.

### 19.8 Bugs Fixed (post-initial implementation)
| ID | Context | Root Cause | Fix |
|---|---|---|---|
| Z1 | Group messages not arriving | `processGroupMessage()` referenced `grpReplyToCustomid/Text/Sender/Type` as free variables from the outer `handleGroupMessage()` scope. On the receiver's node these variables don't exist → ReferenceError crash on every incoming group message. | Passed all 4 as explicit parameters to `processGroupMessage()`. See fragility point #37. |
| Z2 | DM reply disappeared after send | Phase 2 of `loadMessagesFromDB` (`Promise.all` token status map) rebuilt the message object but omitted `replyTo`. Optimistic message showed reply, then DB reload silently dropped it. | Added `replyTo: msg.replyTo` to Phase 2 return object. See fragility point #35. |
| Z3 | Channel reply never showed | `CHANNEL_MESSAGES` has no `customid` column → `replyTo.customid = ""` → falsy → stored as NULL → display guard `(REPLY_TO_CUSTOMID) ? ...` always null. `reply_to_text`/`reply_to_sender` were correctly stored. | Changed guard from `reply_to_customid` to `reply_to_text \|\| reply_to_sender` in both `loadMessages` (FE) and channel history row mapping (SW). See fragility point #36. |
| Z4 | DM optimistic message missing quote block | `newMsg` was created before `currentReplyTo` was captured (after `setMessages`). So optimistic message had `replyTo: undefined`. | Moved `const currentReplyTo = replyingTo` capture BEFORE `newMsg` construction; added `replyTo: currentReplyTo` to optimistic message. |
| Z5 | DM reply not persisted from sender side | `chatService.insertMessage()` INSERT SQL was missing all 4 `reply_to_*` columns — they were not being written to the DB by the sender. | Added `reply_to_customid/text/sender/type` to the destructure and INSERT in `chatService.insertMessage()`. |

## 18) UI and UX Defaults

1. **Discovery View Mode**: The default view mode in `/discovery` is set to `"all"`. This ensures that users, groups, and channels are all visible by default to new users, encouraging broader exploration of available content. The "All" tab is also positioned first in the filter bar for consistency with its default status.

## 18) Log Optimization and Debugging Defaults

As of version 3.0 (April 2026), the application has a strictly pruned logging strategy to prevent production consoles from being saturated by Minima MDS dumps.

### 18.1 Frontend Build Stripping (Vite)
- **Currently Disabled**: `vite.config.ts` includes the `terser` config to strip `console.log` in production, but it is commented out for active Alpha/Beta debugging.
- Once the app is stable, uncomment the `minify: 'terser'` config blocks.
- **Rule for UI development**: Use `console.warn` or `console.error` for errors that absolutely must remain visible in production, to prepare for when the final stripping is reactivated.

### 18.2 Service Worker Debugging (SW_DEBUG)
- The Rhino/Nashorn engine logs directly to the Minima Java console via `MDS.log()`. To keep this trace clean for node operators, all high-frequency payloads (like chat payload parsing, raw string dumps, and polling latency events) must be gated.
- A global `var SW_DEBUG = false;` flag is located at the top of `public/service-workers/main.js`.
- If an agent or developer needs to debug the raw inbound payload of `MAXIMA` messages or deduplication SQL, they must manually set this flag to `true`, build the SW, and revert it immediately after.
- **`logToUI` removed**: The legacy `logToUI` utility (which spammed the bridge with `UI_LOG:` payloads so the frontend would print them) was removed due to bridge saturation. Use `MDS.log` for backend debugging.
