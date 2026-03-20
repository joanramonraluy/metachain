# AGENTS.md - MetaChain Engineering Guide

Last reviewed against codebase: 2026-03-20 (commit `09cd1d26` + MLS beacon hub response routing + SW static MLS auto-config + Chat Sync Optimizations)
Scope: `/home/joanramon/Minima/metachain`

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
- persistence into `DISCOVERED_PEERS` with `allow_non_contact_chats` and `extra_data`
- promotion into stable `METACHAIN_USERS`
- reactive relay: when source is `P2P` or `MAXIMA`, calls `sendWelcomePackage` + `askPeers`

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
- If absent, Service Worker auto-attempts default static MLS assignment
- Settings UI supports manual server entry and "use my node as server" mode
- Settings UI no longer auto-sets static MLS on load
- Self-MLS detection uses `p2pidentity` to avoid loops when contact address differs
- `staticmls` persists across normal restarts and is lost only on clean reset or data wipe (e.g. `-clean`, `reset`, basefolder change, or restoring an old backup)

MLS is used for **Maxima routing** (unicast). With the MLS beacon hub behavior, nodes also unicast their own beacons to the MLS server so it can answer `get_peers` even when P2P MetaChain neighbors are sparse. Two nodes sharing an MLS server can exchange Maxima messages and discover peers via MLS without direct P2P MetaChain neighbors, assuming the MLS runs MetaChain and receives those beacons. `get_peers` now includes the requester `address` so the MLS can respond via `to:` even when the requester is not a Maxima contact. Prefer `mls` (stable `Mx@ip:port`) over `contact` (often transient) when populating this field. MLS responses are sent to both `to:<address>` and `publickey` to handle stale/ephemeral addresses.

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

Never remove fallback-to-address logic unless replacing it with an equivalent robust path.

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

## 6) FE <-> SW Coherence Contract

### 6.1 Events/signals in use
- SW -> FE:
  - `MDS.comms.solo("CHAT_LIST_UPDATE")`
  - reconnect signal via `MDS.comms.solo(JSON.stringify({ type: 'RECONNECTED', ... }))`
- FE internal browser events:
  - `peer_updated`
  - `DISCOVERY_UPDATE`
  - `minima_balance_update`

Bridge caveat:
- `CHAT_LIST_UPDATE` is consumed through `MDS.init` event handling (`minimaService.processEvent`) and also legacy `window.MDS_SOLO_LISTENER` usage in `ChatsAndGroups`.
- Reconnect handling is normalized in `minimaService.processEvent` (parses `RECONNECTED` from MDS event payloads) and calls `offlineQueueService.triggerImmediateRetry(...)`.
- `offline-queue.service.ts` still keeps a `window.message` fallback listener for compatibility, but MDS event handling is canonical.
- If you change SW comms payload shape, update all FE listeners in the same patch.

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

FE handles:
- triggering sync requests from open chats
- showing syncing UI and refresh requests

Do not create independent history merge algorithms in FE.

### 6.4 Protocol Matrix (Ingress -> Persistence -> UI)
| Protocol / Type | Ingress Owner | Persistence Owner | Primary Tables | FE Refresh Signal |
| --- | --- | --- | --- | --- |
| `BEACON`, `register` | SW `main.js` -> `beacon.handler.js` | SW | `DISCOVERED_PEERS`, `METACHAIN_USERS` | no direct SW signal; FE refreshes via DB reads / discovery events |
| `get_peers`, `peers_response` | SW `gossip.handler.js` | SW | `DISCOVERED_PEERS` | `DISCOVERY_UPDATE` |
| `text`, `token`, `charm` chat payloads | SW `chat.handler.js` | SW | `CHAT_MESSAGES`, `TRANSACTIONS` (tx flows) | `CHAT_LIST_UPDATE`, `onNewMessage` |
| `delivery_receipt`, `read` | SW `chat.handler.js` | SW | `CHAT_MESSAGES` | `onNewMessage` |
| `contact_request` domain | SW `contact.handler.js` | SW | `CONTACT_REQUESTS`, `CHAT_MESSAGES` | `onNewMessage` |
| `maxima_contact_*` domain | SW `contact.handler.js` | SW | `MAXIMA_CONTACT_REQUESTS`, `CHAT_MESSAGES` | `onNewMessage` |
| `profile_request`, `profile_response` | SW `profile.handler.js` | SW (authoritative), FE may cache | `DISCOVERED_PEERS`, `MY_PROFILE` | `peer_updated` |
| `chat_history_*`, `sync_status_*` | SW `chat.handler.js` | SW | `CHAT_MESSAGES`, `MESSAGE_COUNTERS` | `CHAT_LIST_UPDATE`, `history_sync` |
| reconnect signal (`RECONNECTED`) | SW `main.js` | FE queue state | local queue/cache | offline queue + chat refresh |

### 6.5 Single Owner Per Flow (Do Not Duplicate)
1. Beacon ingestion and peer persistence: SW only.
2. Gossip request/response protocol: SW only.
3. Contact-request protocol state transitions: SW only.
4. History merge, sequence gap recovery and sync reports: SW only.
5. UI presentation, optimistic rendering and route-level UX: FE only.
6. FE can trigger sends; SW owns canonical inbound persistence and reconciliation.

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
- `DISCOVERED_PEERS`: `publickey`, `address`, `alias`, `last_seen`, `source`, `allow_non_contact_chats`
- `METACHAIN_USERS`: `publickey`, `alias` (plus SW registry fields used by discovery merge)
- `MESSAGE_COUNTERS`: `publickey`, `next_seq`

If one runtime extends a shared table, add backward-compatible `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` in both runtimes.

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
10. **`discovery_interval` / `discovery_limit` UI controls are disconnected from the SW** (`src/routes/settings/discovery.tsx` saves to keypair but SW uses hardcoded `GOSSIP_INTERVAL`/`BEACON_INTERVAL` in `utils.js`). These settings have zero effect until the SW is updated to read them. See section 4.4.
11. **Beacon transport is P2P-only (`MSG_GENMESSAGE`), not Maxima**. Two MetaChain nodes with no shared MetaChain-running P2P neighbor cannot discover each other via beacon. Do not assume discovery will work on sparse mainnet deployments without a common MetaChain relay node or shared MLS for Maxima fallback. See section 4.3.

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
| 1 | `src/routes/settings/discovery.tsx` + `public/service-workers/utils.js` | `discovery_interval` and `discovery_limit` keypair values saved by UI are never read by SW. SW uses hardcoded `GOSSIP_INTERVAL=30000` and `BEACON_INTERVAL=60000`. Fix: SW must read keypair values at init (and on NEWBLOCK) and apply them dynamically. | Medium |
| 2 | Discovery / mainnet | Two MetaChain nodes with no shared MetaChain P2P neighbor cannot discover each other via beacon relay. No fix possible at SW level without a common MetaChain intermediary or MLS-based Maxima contact exchange. | By design / known limitation |
