# AGENTS.md - MetaChain Engineering Guide

Last reviewed against codebase: 2026-04-12 (branch `v0.9` · standardized Elite Input Hub chat sizing to 64px)
Scope: `/home/joanramon/Minima/metachain`

## 0) Mandatory Update Mandate (Required)

**ANY AGENT (AI) making modifications to this repository IS REQUIRED to update this file (`AGENTS.md`) before finishing its task.** 

The goal is that any learning, architectural change, new "fragility point" or design decision is recorded here for future agents. Do not use this file only for reading; it is your shared memory.

**Latest Update (2026-06-19 — Route-Restricted MinimaAds Banner)**:
- Restricted the MinimaAds banner to only display on specific routes: Home (`/`), Contacts (`/contacts`), and Discovery (`/discovery`).
- Added diagnostic logs `MA-DEBUG:` to monitor banner visibility per route.
- Updated files: `src/components/layout/AppLayout.tsx`.

**Previous Update (2026-05-18 — MDS.cmd TypeError Fix)**:
- Fixed a `TypeError: I.cmd is not a function` crash that occurred when opening a chat or syncing groups.
- The root cause was that `(window as any).MDS?.cmd(...)` was being used to send `service:` commands to the Service Worker from the React frontend. In the `@minima-global/mds` package, `MDS.cmd` is a namespace object, not a function, causing minified builds to crash when attempting to call it.
- Replaced all instances of `(window as any).MDS?.cmd("service:...")` with the correctly typed `MDS.executeRaw("service:...")` in `src/routes/chat/$address.tsx` and `src/services/group.service.ts`.

**Previous Update (2026-05-10 — Ads-Aware Fixed Positioning)**:
- Fixed overlap between the MinimaAds advertising banner and three fixed/positioned UI elements: the FAB `+` button (Chats tab), the Users/People FAB (Contacts tab), and the BottomNav pill (mobile only).
- **Solution (CSS Variable — Option A)**: `AppLayout.tsx` now attaches a `ResizeObserver` to the `#minimaads-slot` `<div>`. On any size change it writes `--ads-banner-height` (in px) to `document.documentElement.style`. All three affected elements consume this variable via `calc()` in `src/index.css`.
- New CSS utility classes in `src/index.css`: `.bottom-nav-mobile` (BottomNav pill), `.fab-main` (FAB button), `.fab-menu` (FAB expanded action list). Each class has a responsive `@media (min-width: 768px)` override to preserve the existing desktop `bottom-10` / `bottom-30` positions.
- Tailwind hardcoded `bottom-6 / bottom-32 md:bottom-10 / bottom-52 md:bottom-30` classes removed from `BottomNav.tsx` and `ChatsAndGroups.tsx` in favour of the new CSS classes.
- When no banner is present, `--ads-banner-height` defaults to `0px` — zero visual change.
- Updated files: `src/components/layout/AppLayout.tsx`, `src/components/layout/BottomNav.tsx`, `src/components/chat/ChatsAndGroups.tsx`, `src/index.css`.

**Previous Update (2026-04-15 — Normalized Chat Exits)**:
- Standardized Chat Exit Terminology: Replaced the overly technical "Expunge Registry" and "Expunge Connection" labels with clearer, standard terms across the application. 
- DM Chat: "Expunge Registry" → **"Delete Chat"**.
- Group Chat/Info: "Expunge Registry (Connection)" → **"Leave Group"**.
- Channel Info: "Expunge Registry Connection" → **"Leave Channel"**.
- Confirmation Dialogs: Normalized titles to "Delete Chat?", "Leave Group?", or "Leave Channel?" and button labels to "Delete" or "Leave". 
- This change improves user intuition while maintaining the "Elite" (cyberpunk) system aesthetic in secondary labels (e.g., "Session Management").
- Updated files: `src/routes/chat/$address.tsx`, `src/routes/groups.$groupId.lazy.tsx`, `src/routes/group-info.$groupId.lazy.tsx`, and `src/routes/channel-info.$channelId.lazy.tsx`.

**Previous Update (2026-04-14 — UI Mobilization & Flash Fix)**: 
- Standardized UI Action Visibility (Mobile-First): Removed `opacity-0 group-hover:opacity-100` patterns from all critical administrative and profile actions in Group and Channel settings. 
- Fixed Channel UI Flash: Gated the "Read-Only" policy banner in `src/routes/channels.$channelId.lazy.tsx` with `isInitialized` to prevent it from flashing for administrators during the asynchronous admin-check phase on channel entry.
- Fixed Build Errors: Resolved `TS2304` (scope issue with `finalMessages` in `$address.tsx`) and `TS6133` (unused `Globe` import in `discovery.lazy.tsx`) to restore production build capability.
- Actions such as "Promote", "Demote", "Expel", "Edit Name/Description", and "Copy ID/Manifest" are now always visible, ensuring full accessibility on touch devices where hover interactions are unavailable.
- Optimized Community Discovery: Changed the default view mode in `src/routes/discovery.lazy.tsx` from "Users" to "All" to provide a more comprehensive overview of the network (peers, groups, and channels) upon entry.
- Standardized Action Ledger Layout: Converted the "Restriction List" and "Inbound Terminal" (Join Requests) grid in `src/routes/group-info.$groupId.lazy.tsx` from a 2-column grid to a single vertical column stack. This provides more horizontal space for subscriber/banned rows, preventing UI overlap between user addresses and administrative action buttons on both desktop and mobile views.
- **New UI Standard (Avatar Interaction)**: Implemented click-to-profile functionality on user avatars across all chat interfaces (DM, Groups, and Channels). This provides a consistent navigation path to peer profiles directly from the message timeline. Standardized across `src/routes/chat/$address.tsx`, `src/routes/groups.$groupId.lazy.tsx`, and `src/routes/channels.$channelId.lazy.tsx`.

**Previous Update (2026-04-14 — Bug 8 fix)**: 
- Fixed Community "Join" button doing nothing for channels: `buildPublicListings` in `beacon.handler.js` was using `myPubkey`/`myAddress` as `admin_publickey`/`admin_address` for all channels, regardless of whether the local node is actually the channel admin. Subscribers advertising public channels in their beacons would point join requests to themselves instead of the real admin, which was then silently ignored in `handleChannelJoinRequest` (not admin/creator → early return). Fixed by doing a LEFT JOIN with DISCOVERED_PEERS in both the group and channel SQL queries: if the local node IS the admin, `myAddress` is used (most current); if it's a subscriber, the real admin's address is taken from `DISCOVERED_PEERS`. The same fix applies to groups (`creator_publickey`).

**Previous Update (2026-04-14)**: 
- Standardized channel subscriber roles: changed "Staff" badge to "Administrator" in the `ChannelInfo` registry for better clarity.
- Enhanced role management UI in channels by adding explicit "Promote" and "Demote" labels and tooltips to the admin action buttons.
- Fixed security bug: admin users could remove the channel creator from Channel Subscribers. Fixed in two layers: (1) UI guard in `channel-info.$channelId.lazy.tsx` — action buttons are now hidden for the creator row; (2) service guard in `channel.service.ts` `removeSubscriber` — throws if target subscriber has `role = 'creator'`.
- Fixed sync bug: "Global Discovery" (is_public) switch was not being synced to admin subscribers. `updateChannelPublic` now accepts `myPublicKey` and broadcasts a `channel_info_updated` Maxima message with the `isPublic` field; `handleChannelInfoUpdate` in the SW now applies the `is_public` column update when `isPublic` is present in the payload.
- Fixed join-time sync gap: `is_public` was never included in `channel_invite` payloads. Fixed in `inviteSubscriber` (service), `handleChannelJoinRequest` acceptance (SW), and `handleChannelInvite` INSERT (SW) — new subscribers and future admins now receive the correct `is_public` value from the moment they join.
- Fixed Community duplicate listings: the same channel appeared twice because `saveBeaconListings` stored the pubkey with mixed case (`0x` vs `0X`), creating two rows in `DISCOVERED_LISTINGS`. Fixed by normalizing to `pk.toUpperCase()` in the beacon handler. Also added a final deduplication by `type:id` in `getDiscoveredListings` as a safety net for multi-peer listings.
- Fixed channel removal zombie state: when a user is removed from a channel, their `CHANNELS` and `CHANNEL_MESSAGES` rows are now also purged locally (SW `handleChannelSubscriberRemoved`). A new `CHANNEL_REMOVED` event is emitted so `channels.$channelId` and `channel-info.$channelId` navigate home. Fixed `handleChannelInvite` to handle re-join after removal: if channel exists in `CHANNELS` but user is not in `CHANNEL_SUBSCRIBERS`, they are re-inserted instead of early-returning.
- Fixed subscriber list visibility: non-creator users only saw themselves + the creator. Root cause: neither the direct-invite path (`inviteSubscriber`) nor the join-request path (`handleChannelJoinRequest`) sent the existing subscriber list to the new member. Fixed by sending a `channel_subscriber_added` for each existing subscriber to the new invitee/joiner in both paths.
- Standardized Public Key/Address display: Unified the display of public keys across `ChannelInfo`, `GroupInfo`, and `Discovery` (Community) by implementing a centralized `shortenAddress` utility (`src/utils/hex.ts`). 
- **New UI Standard (Middle-Ellipsis)**: Based on the user preference (and parity with Community Discovery), addresses are now shortened to show only a 12-character middle segment (e.g., `...XXXX...`) instead of the standard start/end format. This was chosen because start/end sequences are often repetitive in this specific network environment.
- Updated DM chat header menus to support "click-outside to close" functionality.
- Fixed input field regression in group chats where uppercase styling was incorrectly applied.

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

**Wait state guard (`isActionRestricted`)**: The DM chat view uses a centralized `isActionRestricted` boolean to lock down the interface. It combines `blockReason`, `contactRequest` (incoming), `isPendingOutgoing`, `isBlocked`, and `blockedByThem`.
- **Dynamic Policy Exception**: If the peer's profile (`DISCOVERED_PEERS`) has `allow_non_contact_chats` set to `true`, `isActionRestricted` evaluates to `false` even if a handshake is pending. This allows immediate communication if the peer permits it.
- **UI States**: 
    - Full Restricted: Footer is disabled with "Handshake Required" or "Protocol Restricted" placeholder.
    - Dynamic Allowed: Footer is enabled with "Message..." placeholder, but the Handshake banner remains visible at the top.
    - `handleSendMessage` has a code-level guard to prevent accidental submissions in restricted states.
    - Handshake banners use `sticky top-6` to avoid overlapping with `top-4` date headers.

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
  - Contact-request lifecycle in SW (`contact_request`, `contact_accepted`, `contact_declined`, `contact_cancelled`, and Maxima equivalents) must emit `CHAT_LIST_UPDATE` after DB persistence so the DM inbox/community tabs refresh without depending on duplicate FE-side MAXIMA handling
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

**SMART-SYNC bidirectional requirement (Critical)**: `handleSyncStatusCheck` MUST always respond with a `sync_status_report` — even when `missing_count = 0` (i.e., the peer is NOT behind). The reason is that `handleSyncStatusReport` on the requesting side always auto-issues a `chat_history_request` upon receiving any report. If the responder only sends the report when the peer is behind, the other direction of the sync is silently skipped: the node that received the `sync_status_check` never learns whether IT is missing messages from the sender. Both sides exchange `sync_status_check` on reconnect → both must always get a `sync_status_report` back → both always auto-request history → full bidirectional recovery. Blocking the report on an "up to date" condition breaks asymmetric reconnect scenarios (bug AG). Do NOT add a guard like `if (myLastSentSeq > peerLastSeq)` around the `sync_status_report` send.

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
| `message_deleted` | FE `messaging.service.ts` → Maxima → SW `chat.handler.js` | SW | `CHAT_MESSAGES` (`deleted=1`, `deleted_at`) | `CHAT_LIST_UPDATE` via `MDS.comms.solo` |
| `group_invite` | FE `group.service.ts` → Maxima → SW `group.handler.js` | SW | `GROUPS`, `GROUP_MEMBERS`, `GROUP_BANS`, `GROUP_MESSAGES` (system) | `group_list_updated`, `group_sync_start` via `MDS.comms.solo` |
| `group_message` | FE `group.service.ts` → Maxima fanout → SW `group.handler.js` | SW | `GROUP_MESSAGES` | (polled by FE via sync) |
| `group_member_added` / `group_member_removed` | FE `group.service.ts` → Maxima fanout → SW `group.handler.js` | SW | `GROUP_MEMBERS` | `{ type: "group_update", groupId }` via `MDS.comms.solo` |
| `group_member_unbanned` | FE `group.service.ts` → Maxima fanout → SW `group.handler.js` | SW | `GROUP_BANS` | `{ type: "group_update", groupId }` via `MDS.comms.solo` |
| `group_update_details` | FE `group.service.ts` → Maxima fanout → SW `group.handler.js` | SW | `GROUPS` | `{ type: "group_update", groupId, ... }` via `MDS.comms.solo` |
| `group_role_update` | FE `group.service.ts` → Maxima fanout → SW `group.handler.js` | SW | `GROUP_MEMBERS` | `{ type: "group_update", groupId }` via `MDS.comms.solo` |
| `group_join_request` / `group_join_request_propagated` / `group_join_request_resolved` | FE `group.service.ts` → Maxima → SW `group.handler.js` | SW | `GROUP_JOIN_REQUESTS`, `GROUP_MEMBERS` | `{ type: "group_join_requests_update", groupId }` via `MDS.comms.solo` |
| `history_request` / `history_response` (groups) | SW `group.handler.js` | SW | `GROUP_MESSAGES` | `GROUP_SYNC_START`, `GROUP_SYNC_END` via `MDS.comms.solo` |
| `group_message_deleted` | FE `group.service.ts` → Maxima fanout to `GROUP_MEMBERS` → SW `group.handler.js` | SW | `GROUP_MESSAGES` (`deleted=1`, `deleted_at`) | `{ type: "GROUP_MESSAGE_DELETED", groupId, customId }` via `MDS.comms.solo` |
| `channel_invite` | FE `channel.service.ts` → Maxima → SW `channel.handler.js` | SW | `CHANNELS`, `CHANNEL_SUBSCRIBERS` | `CHANNEL_UPDATE` via `MDS.comms.solo` |
| `channel_message` | FE `channel.service.ts` → Maxima fanout → SW `channel.handler.js` | SW | `CHANNEL_MESSAGES`, `CHANNEL_MSG_COUNTERS` | `CHANNEL_NEW_MESSAGE` via `MDS.comms.solo` |
| `channel_info_updated` | FE `channel.service.ts` → Maxima fanout → SW `channel.handler.js` | SW | `CHANNELS` | `CHANNEL_UPDATE` via `MDS.comms.solo` |
| `channel_role_update` | FE `channel.service.ts` → Maxima fanout → SW `channel.handler.js` | SW | `CHANNEL_SUBSCRIBERS` | `CHANNEL_UPDATE` via `MDS.comms.solo` |
| `channel_join_request` | FE `channel.service.ts` → Maxima → SW `channel.handler.js` (admin) | SW | `CHANNEL_SUBSCRIBERS`, `CHANNEL_MESSAGES` (system) | `CHANNEL_NEW_MESSAGE` via `MDS.comms.solo` |
| `channel_subscriber_added` / `channel_subscriber_removed` | SW `channel.handler.js` | SW | `CHANNEL_SUBSCRIBERS` | `CHANNEL_UPDATE` via `MDS.comms.solo` |
| `channel_history_request` / `channel_history_response` | SW `channel.handler.js` | SW | `CHANNEL_MESSAGES` | `CHANNEL_SYNC_START`, `CHANNEL_SYNC_END` via `MDS.comms.solo` |
| `channel_message_deleted` | FE `channel.service.ts` → Maxima fanout to `CHANNEL_SUBSCRIBERS` → SW `channel.handler.js` | SW | `CHANNEL_MESSAGES` (`deleted=1`, `deleted_at`) | `{ type: "CHANNEL_MESSAGE_DELETED", channelId, senderSeq }` via `MDS.comms.solo` |
| `ping` / `pong` | FE `messaging.service.ts` → Maxima → SW `chat.handler.js` | SW (`pong`), FE (observe `pong`) | none | none (FE listens via MDSCOMMS for presence UI) |
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
- `customid` (best — UUID assigned at send time, globally unique)
- `sender_seq` — only valid as a dedup key when the message has NO `customid`
- content + timestamp window fallback

Do not simplify dedup to a single key.

**`seqKey` dedup MUST be guarded by absence of `customId` (Critical)**: The FE `deduplicateMessages` function in `src/routes/chat/$address.tsx` tracks a `seenSeqKeys` set keyed as `seq-them-${sender_seq}`. This catches legacy duplicates from before `customId` was introduced. However, if a sender's `MESSAGE_COUNTERS` seq was ever reset (e.g. after reinstall or DB wipe), different messages can share the same `sender_seq` number. If `seqKey` dedup is applied to messages that already have a valid UUID `customId`, the second message with the same seq-after-reset is falsely treated as a duplicate and silently dropped from the UI — even though both messages exist correctly in the DB. Rule: apply `seqKey` dedup **only** when `!keys.customId`. Messages with a UUID `customId` must be deduped exclusively by `customId` and never by `seqKey` (bug AH).

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
14. **Contact-request visibility depends on SW-issued `CHAT_LIST_UPDATE` after persistence**. `public/service-workers/handlers/contact.handler.js` must fire `MDS.comms.solo("CHAT_LIST_UPDATE")` after saving request rows/system messages (chat + Maxima request lifecycle). Without that signal, DM/frontend remodels can leave incoming requests invisible in inbox/community lists until a manual refresh even though the DB row exists.
15. **Dual Identity (Mx vs 0x)**: Messages arriving via Service Worker always use Hex Keys. Frontend must query using both the address from the URL (`Mx...`) and the canonical Hex Key (`0x...`) to ensure all messages are visible.
16. **SW/FE Race Condition**: Maxima events trigger reloads in both SW (persistence) and FE (UI). FE must use a small delay (e.g. 200ms) for `MAXIMA` content reloads to ensure SW has finished its DB work. `CHAT_LIST_UPDATE` signals from SW are deterministic and do not require a delay.
17. **`MDS.cmd` is NOT callable as a function from the frontend TypeScript context**. `MDS.cmd` in `@minima-global/mds` is a namespace object with typed methods (`MDS.cmd.maxima(...)` etc.), not a function. Calling `(MDS.cmd as any)(rawString, cb)` silently does nothing or ignores `poll:false`. Always use the typed `MDS.cmd.maxima(...)` API for Maxima sends; reserve `MDS.executeRaw` for SQL queries only. See section 5.5.
18. **H2 BOOLEAN columns return strings, not booleans**. `SELECT allow_non_contact_chats` returns `"true"` or `"false"` (strings), not JS `true`/`false`. All boolean DB checks must handle both: `value === 1 || value === true || value === "1" || value === "true"`. Missing this causes permission gates to always evaluate to `false`.
19. **`MDSCOMMS` not `MDS_SOLO`**: `MDS.comms.solo()` in the SW fires a **`MDSCOMMS`** event at the frontend, NOT `MDS_SOLO`. The event data structure is `{ event: "MDSCOMMS", data: { public: false, message: "<string>" } }` — the payload string is at `event.data.message`, not `event.data`. In `processEvent` (minima.service.ts), always check `event.event === "MDSCOMMS"` and extract `event.data?.message ?? event.data`. Using the wrong event name means `NEW_CHAT_MESSAGE` and `CHAT_LIST_UPDATE` signals from the SW are silently dropped, causing messages to not appear in the UI unless a MAXIMA fallback fires.
20. **Profile Request/Response Simplicity**: Profile request/response must NOT use `MDS.executeRaw` SQL lookup or add requestId tracing. The FE uses `MDS.cmd.maxima()` to send directly to `peerAddress`; the SW sends the response via `MDS.cmd()` directly to `requesterAddress` (validating the Mx prefix). Avoid complexity: keep the flow straightforward with regex address validation and fallback-to-publickey logic.
21. **Public Key Case Inconsistency (`0x` vs `0X`)**: Minima/Maxima returns public keys with lowercase `0x` prefix, but DB `UPPER()` calls and some internal flows store them with uppercase `0X`. Any code that uses `startsWith('0x')` or `Set.has(publickey)` for comparison MUST be case-insensitive (use `.toLowerCase().startsWith('0x')` or normalize both sides with `.toUpperCase()`). This caused silent Maxima send failures and contact list duplication.
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

38. **`getChannelSubscribers()` and group subscriber iterators return raw MDS SQL rows with UPPERCASE keys — `sub.publickey` is always `undefined`**: When iterating over subscriber/member lists for Maxima sends, `sub.publickey` (lowercase) is always `undefined` because MDS SQL returns columns as `PUBLICKEY` (uppercase). Calling `sendMaximaMessage(sub.publickey, payload)` silently sends to `undefined` — no error, no log, no delivery. Always use `const pk = (sub as any).PUBLICKEY || sub.publickey` to handle both casings. Use `sendChannelMessage` as the canonical reference — it already uses this pattern. Any new "send to all subscribers" loop must follow it.

39. **Channel SW operation handlers must NOT apply role-based access checks on inbound notifications**: `handleChannelMessageDeleted` (and similar channel inbound handlers) must not query `CHANNEL_SUBSCRIBERS` to check if the sender is `admin`/`creator`. The role lookup can return empty rows due to key case mismatches, freshly-joined state, or DB row absence — silently blocking all propagation. Channels are admin-broadcast: only the admin publishes/deletes, so any authenticated Maxima sender of a channel operation type is trusted. Do not add role gating to inbound channel operation handlers. If authorization is needed, validate the sender pubkey against the channel's `admin_publickey`, not a live subscriber role query.

40. **`group_id` and `channel_id` in SQL WHERE clauses must be case-insensitive**: `GROUP_MESSAGES.group_id` and `CHANNEL_MESSAGES.channel_id` are text columns that can be stored with different casing than the runtime value (especially after reinstall, DB migration, or cross-node invite). Exact-case WHERE clauses (`WHERE group_id='...'`) silently match 0 rows — no error, 0 affected rows. Deletes, read receipts, and all row-specific operations silently no-op. Always use `UPPER(group_id)=UPPER('...')` and `UPPER(channel_id)=UPPER('...')` in UPDATE and SELECT WHERE clauses. This applies in the TypeScript service layer (`group.service.ts`, `channel.service.ts`) and in all SW handlers (`group.handler.js`, `channel.handler.js`).

41. **`loadMessagesFromDB` for groups must handle both uppercase AND lowercase `deleted` field on already-mapped objects**: The group route's `loadMessagesFromDB` in `groups.$groupId.lazy.tsx` re-maps already-mapped `GroupMessage` objects (NOT raw SQL rows). The SW maps the SQL `DELETED` column → lowercase `deleted` when normalizing messages. If the route uses only `row.DELETED` (uppercase), it always gets `undefined` → coerced to `false` → deleted messages reappear on every reload. Always check both casings: `row.DELETED === 1 || row.DELETED === "1" || row.deleted === 1 || row.deleted === "1"`. This pattern generalizes: any field read from an object that may originate from either a raw SQL row OR an already-mapped service object must handle both case variants.

42. **`GROUP_MESSAGES.forwarded` is a routing-only flag — NEVER persist `maxjson.forwarded` to DB**: The `forwarded=true` field in a `group_message` Maxima payload means "this message has already been propagated — don't re-propagate." It is an internal routing hint to prevent exponential re-broadcast storms. It must NOT be written to the DB `forwarded` column. If it is, any message that arrives via the hub/relay path (e.g., after a node reconnects and the creator propagates queued messages) will be rendered with a "Forwarded" badge in the UI even though the message was never forwarded by the user. The `forwarded` column in `GROUP_MESSAGES` should always be 0 for all inserted rows. The propagation decision (`shouldPropagate && !maxjson.forwarded`) should read `maxjson.forwarded` from the payload but never persist it. Same rule applies in `handleGroupHistoryResponse`. See bugs AI and AJ.

43. **`seqKey` dedup causes false message suppression when sender seq counter has been reset**: `deduplicateMessages` in `src/routes/chat/$address.tsx` uses a `seenSeqKeys` set (`seq-them-${sender_seq}`) to identify duplicate messages. If the sender's `MESSAGE_COUNTERS` sequence was reset at any point (reinstall, DB wipe), different messages can share the same `sender_seq` value. When both old and new messages are merged in the same dedup pass, the old message registers the seqKey first; the new message (which has a distinct UUID `customId`) is then falsely flagged as a duplicate and dropped — even though it exists correctly in the DB and is missing from the UI. Guard: `seqKey` dedup must only apply when `!keys.customId`. See section 7.2 and bug AH.

44. **`propagateGroupMessage` skip comparisons must be case-insensitive**: When a group message arrives and is propagated to other members, the skip list (to avoid re-sending to the original sender and relay peer) uses `memberPubkey === pubkey` and `memberPubkey === maxjson.senderPublickey` (strict equality). `memberPubkey` comes from `GROUP_MEMBERS` (SQL uppercase `0X...`) while `pubkey` from Maxima and `maxjson.senderPublickey` are lowercase `0x...`. The strict equality always fails, causing the original sender to receive their own message back as a `forwarded=true` payload. Combined with bug #42, this produced a double failure: the original sender received their own message as "Forwarded." Fix: use `.toUpperCase()` on all three sides of the skip condition. See bug AJ.

45. **`group.service.ts` `sendMaximaMessage` must use `poll:false`**: Both the direct Mx-address send and the publickey-fallback send previously used `poll:true`. With `poll:true`, a send to an offline group member blocks the FE Promise for ~77 seconds (Maxima waits for delivery confirmation). In a group with N offline members, the sequential `for...await` loop in `sendGroupMessage` can block for N × 77s before completing. This makes the UI appear frozen and delayed sends pile up. Fix: `poll:false` on both sends. Recovery for missed delivery is handled by `requestAllGroupsHistory` on reconnect, which requests history from all group members. See AGENTS.md fragility #13 (SW rule), same principle applies to FE sequential awaits.

48. **Optimistic group message `customId` must be passed to `sendGroupMessage`**: `handleSendMessage` in `groups.$groupId.lazy.tsx` generates a `customId` for the optimistic message and adds it to state with `status: "pending"`. `sendGroupMessage` in `group.service.ts` previously generated its OWN independent `customId` for the DB INSERT — using a second `Date.now()` call at a different millisecond. Because `deduplicateMessages` uses `customid` as its primary key, the DB version and the pending version were NEVER matched → **both survived dedup indefinitely** → the user's own message appeared twice in the chat (once as "pending", once as a normal sent message). Fix: pass `customId` from the caller as the optional `externalCustomId` parameter into `sendGroupMessage`; the service uses it for the DB INSERT if provided. Now the DB row and the optimistic message share the same `customId` → dedup correctly drops the optimistic copy when the DB version loads → "pending" indicator clears after a successful send. See bugs AM and AN.

50. **Group messages that fail entirely (not just per-member Maxima send) must be queued as `group_message_full` in `OFFLINE_QUEUE`**: `sendGroupMessage` has two distinct failure modes. (a) Per-member Maxima send failure: caught inside the `for...await` loop — the DB INSERT already succeeded, so only the Maxima delivery needs retrying → stored as `group_message` type in the queue. (b) Entire-function failure: `getGroupInfo` or DB INSERT throws (e.g. SQL timeout) before any INSERT or Maxima send → the message is lost entirely unless `handleSendMessage` queues it. The `group_message_full` queue type stores all parameters required to call `sendGroupMessage` from scratch, including the original `customId` so the in-memory "failed" optimistic message deduplicates cleanly once the retry succeeds. After a successful retry, the queue handler dispatches `window.dispatchEvent(new CustomEvent("GROUP_UPDATE", { detail: { type: "GROUP_SYNC_END", groupId } }))` to trigger an immediate UI reload. See bug AO.

49. **`loadMessagesFromDB` must preserve "failed" messages (not just "pending")**: After a send fails (node unreachable, SQL timeout, network outage), `handleSendMessage` sets the optimistic message to `status: "failed"`. The previous `loadMessagesFromDB` filter `m.status === "pending"` silently excluded "failed" messages → on the next DB load, the failed message was dropped from state entirely → **the user's unsent message disappeared from the UI without any explanation**. Fix: change the filter to `m.status === "pending" || m.status === "failed"`. Failed messages now remain visible with the "failed" visual indicator until a DB row with the same `customId` arrives (successful retry) or the user explicitly removes them. The dedup order `[...parsedMessages, ...pendingOrFailed]` ensures a successful DB insert (via retry) supersedes the failed copy cleanly. See bug AN and fragility #48.

54. **Channel optimistic dedup uses `timestamp` match, not `customId` — `publishMessage` MUST use `overrideDate`**: `CHANNEL_MESSAGES` has no `customid` column (see fragility #36), so channel `loadMessages` cannot use `customId` to identify when a DB row supersedes an optimistic `pending` message. Instead, the dedup uses `timestamp`: `survivingPending = prev.filter(m => m.status === "pending" && !dbTimestamps.has(m.timestamp))`. This works correctly ONLY if `publishMessage` inserts the row with the exact same `timestamp` that `handleSend` used for the optimistic message. `handleSend` passes `sendTimestamp` as `overrideDate`; `publishMessage` uses `overrideDate || Date.now()`. If `overrideDate` is omitted, `publishMessage` generates a new `Date.now()` a few milliseconds later — the timestamps never match → the pending message is never cleared → the user sees both. This pattern also applies to the offline queue retry: `queueChannelMessageFull` stores `timestamp` and `processItem` passes it as `overrideDate` so retried messages sort correctly and their pending copies are cleared on success. See bug AU.

51. **`getGroupMessages()` must `throw` on SQL error — NEVER return `[]`**: `getGroupMessages()` in `group.service.ts` was originally written to catch errors and return `[]`. This is catastrophic: `loadMessagesFromDB` treats the return value as "the current state of the group" and calls `setMessages(deduplicateMessages([...parsedMessages, ...inMemoryOnly]))` where `parsedMessages = []`. Any DB-confirmed message NOT in `inMemoryOnly` (i.e., every message previously loaded from DB that has no `status` override) is silently wiped from the UI. The fix requires two complementary changes: (1) `getGroupMessages()` catch block must `throw err` instead of `return []`. (2) Callers that don't care about errors (sidebar counts, info pages) must add their own `.catch(() => [])`. The component's `loadMessagesFromDB` catch block must NOT call `setMessages` on error — log only. The DM equivalent (`messagingService.getMessages()`) already returns `null` on error; callers check `Array.isArray()` before using. Same defensive pattern required for groups. See bug AP.

52. **Group chat render filter must NOT exclude `"pending"` messages**: `groups.$groupId.lazy.tsx` had `.filter((m) => m.status !== "pending" && m.status !== "zombie")` before rendering messages. This silently hid ALL optimistic outgoing messages while the user was offline (or before the DB confirmed them). DM chat never had this problem because DM uses `status: "sent"` (not filtered). The correct filter is `.filter((m) => m.status !== "zombie")` — `"pending"` messages must be rendered to give the user immediate visual feedback (WhatsApp/Telegram UX). `"failed"` messages must also be rendered (visible with error indicator). Only `"zombie"` (orphaned dedup artifacts) should be hidden. See bug AQ.

53. **`loadMessagesFromDB` useCallback must NOT capture `myPublicKey` from closure — use a ref instead**: `myPublicKey` from `AppContext` is populated asynchronously (after profile fetch from Maxima). If `myPublicKey` is listed in `useCallback([address, myPublicKey])`, the callback is first created with `myPublicKey = ""`. However, the `useEffect([address])` that registers event listeners and triggers initial load does NOT re-run when `myPublicKey` later changes — because `myPublicKey` is not in the effect's deps. All `loadMessagesFromDB` calls in that effect's lifetime therefore use the stale `myPublicKey = ""`, making every `fromMe` check return `false` → all messages appear on the left side. Fix pattern: `const myPublicKeyRef = useRef(myPublicKey); useEffect(() => { myPublicKeyRef.current = myPublicKey; }, [myPublicKey]);` — then use `myPublicKeyRef.current` inside `loadMessagesFromDB` and remove `myPublicKey` from `useCallback` deps. This pattern should be applied to ANY value that changes asynchronously after mount but is used inside a long-lived callback registered in a shallow-dep effect. See bug AR.

47. **`runSQL` in `group.service.ts` must have a timeout — `MDS.sql` callback is silently dropped on network outage**: When the Minima node is unreachable (`ERR_ADDRESS_UNREACHABLE`), the HTTP response body is empty. The MDS library calls `JSON.parse("")` which throws, logs the error (`Failed to parse response as JSON`), and exits — WITHOUT calling the user-provided `MDS.sql` callback. Any `Promise` wrapping `MDS.sql` with no timeout hangs forever. In practice, `group.service.ts` `runSQL()` is called by `getGroupMessages()`, which is awaited in `loadMessagesFromDB` (in `groups.$groupId.lazy.tsx`) inside a `isLoadingMessages.current = true` mutex guard. If the Promise never resolves/rejects, the `finally` block never runs, `isLoadingMessages.current` stays `true`, and every subsequent `loadMessagesFromDB` call is skipped with "Skipping load (active)" — messages sent/received while offline don't appear until page refresh. Fix: add a `setTimeout` (6000ms) inside `runSQL` that rejects the Promise if the callback hasn't fired. This ensures the mutex is always released. Same risk exists in any other service that wraps `MDS.sql` in a bare `Promise`. See bug AL.

46. **SMART-SYNC `handleSyncStatusCheck` must ALWAYS send `sync_status_report` — even when peer is up-to-date**: If `handleSyncStatusCheck` only responds when `myLastSentSeq > peerLastSeq`, the other direction of the exchange is broken. The sender of the `sync_status_check` never receives a report → never auto-issues `chat_history_request` for the responder's messages → cannot recover messages it is missing. Corrupted historical `last_received_seq` values (e.g. from prior outgoing contamination) can artificially inflate the peer's reported seq, causing the responder to evaluate "peer is up to date" and stay silent, while the requesting node is actually missing recent messages. Always send `sync_status_report` unconditionally; set `missing_count = max(0, myLastSentSeq - peerLastSeq)` for informational purposes only. See section 6.3 and bug AG.

44. **`sender_seq` contamination from outgoing messages**: `CHAT_MESSAGES.sender_seq` on the local node stores the seq assigned by the REMOTE PEER to their outgoing messages (not the local node's own outgoing seq). Outgoing messages sent by the local node must NOT write to `sender_seq` in the peer's direction — they use `MESSAGE_COUNTERS.next_seq` for their own seq tracking. If outgoing messages accidentally populate `sender_seq` in a direction-agnostic way, the peer's last-received-seq tracking becomes inflated, causing `handleSyncStatusCheck` to see a falsely high `peerLastSeq` and believe no sync is needed. Always confirm that `sender_seq` is only written when processing INBOUND messages from a given peer.

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
| AA | Groups: deleted messages reappear after reload | `loadMessagesFromDB` in `groups.$groupId.lazy.tsx` re-mapped already-mapped `GroupMessage` objects using only `row.DELETED` (uppercase). The SW normalizes the column to lowercase `deleted`, so `row.DELETED` was always `undefined` → coerced to `false` → deleted messages reappeared on every DB reload. Fix: added `|| row.deleted === 1 || row.deleted === "1"` to the deleted guard. See fragility point #41. |
| AB | Groups/Channels: SW delete silently matched 0 rows | `deleteGroupMessage` in `group.service.ts`, `handleGroupMessageDeleted` in `group.handler.js`, and `deleteChannelMessage` in `channel.service.ts` all used exact-case WHERE clauses (`WHERE group_id='...'` / `WHERE channel_id='...'`). On casing mismatch (common after cross-node invites or reinstalls), 0 rows were updated and no error was thrown — the delete appeared to succeed locally but was never written to the DB. Fix: `UPPER(group_id)=UPPER('...')` and `UPPER(channel_id)=UPPER('...')` in all UPDATE/SELECT operations. See fragility point #40. |
| AC | Channels: delete notification never sent to subscribers | `sendChannelDeleteMessage` in `channel.service.ts` iterated over `getChannelSubscribers()` results and used `sub.publickey` (lowercase) as the Maxima destination. MDS SQL returns `PUBLICKEY` (uppercase), so `sub.publickey` was always `undefined`. `sendMaximaMessage(undefined, payload)` silently no-ops — no error, no delivery. Diagnosed via logs: the `[CHANNEL-MAXIMA]` send log that appears in `sendChannelMessage` was entirely absent for delete operations. Fix: `const pk = (sub as any).PUBLICKEY || sub.publickey`. See fragility point #38. |
| AD | Channel SW handler blocked all incoming delete notifications | `handleChannelMessageDeleted` in `channel.handler.js` queried `CHANNEL_SUBSCRIBERS` to verify the sender had role `admin`/`creator` before proceeding. This lookup returned empty rows due to key case mismatches — causing all incoming deletes to be silently blocked. Only User1 (who initiated the delete) saw the message as deleted; User2 never received the update. Channels are admin-broadcast: no role check is needed on the receiver side. Fix: removed role check and fanout entirely; handler now directly issues the UPDATE and fires `MDS.comms.solo`. See fragility point #39. |
| Y | Invite-link joiner's group/channel does not appear in chat list | After joining via `mcgrp://` or `mcch://` invite link: the admin received the join request, processed it, and sent back a `group_invite`/`channel_invite`. The joiner's SW correctly inserted the group/channel into the DB and fired `MDS.comms.solo({ type: "group_list_updated" })`. However, `minima.service.ts` MDSCOMMS handler only handled `group_update`, `group_join_requests_update`, `GROUP_SYNC_START`, and `GROUP_SYNC_END` — `group_list_updated` and `group_sync_start` (lowercase) were silently ignored. No `GROUP_UPDATE` CustomEvent was dispatched → `ChatsAndGroups` never re-fetched → group invisible to joiner. Separately, for channels, `handleChannelInvite` exited silently (no `CHANNEL_UPDATE` fired) if the channel already existed in the DB. Fix: added `group_list_updated` and `group_sync_start` to the MDSCOMMS condition in `minima.service.ts`; added `CHANNEL_UPDATE` + `requestChannelHistoryFromSW` to the early-exit path in `channel.handler.js`. See sections 11.33–34. |
| AE | `requestStatus` reset to 'none' after Maxima contact decline | `checkStatus()` in `contact-info.$address.lazy.tsx` previously queried `CONTACT_REQUESTS` table to determine `requestStatus`. That table is reliable for the receiver side but silently empty on the sender side (because `sendChatRequest` used a `MERGE INTO ... KEY(...)` statement that fails silently in H2 — see AF). When a Maxima contact request was declined, `MAXIMA_CONTACT_REQUESTS` was updated but `CONTACT_REQUESTS` stayed empty, so `requestStatus` fell to `'none'` even though the chat request had already been accepted. Fix: reverted `checkStatus()` to the SYNCGIT reference pattern — queries `CHAT_MESSAGES` for the most-recent system message matching exact texts: `'Chat request sent'`, `'Chat request accepted'`, `'Chat request declined'`, `'Chat request cancelled'` (including legacy `'Contact request …'` variants). This is robust because each state transition always inserts an exact-text system message, and Maxima messages (`'Maxima contact declined'`, `'Maxima contact request sent'`, etc.) use different text and are never matched. Critical: do NOT revert to `CONTACT_REQUESTS`-based checks for `requestStatus` — that table is unreliable on the sender side. |
| AF | `sendChatRequest` outgoing record silently not inserted into `CONTACT_REQUESTS` | `sendChatRequest()` in `contact-requests.service.ts` used `MERGE INTO CONTACT_REQUESTS ... KEY(from_publickey, to_publickey) VALUES (UPPER('...'), UPPER('...'), ...)`. H2 `MERGE` with `KEY` requires an exact match on the key column values; when the columns already contain UPPER-normalized values but the MERGE expression also applies UPPER(), H2 evaluates the merge condition incorrectly and may silently no-op the insert. Result: the sender's `CONTACT_REQUESTS` row was never created. Fix: replaced MERGE with explicit `DELETE FROM CONTACT_REQUESTS WHERE UPPER(from)=UPPER(...) AND UPPER(to)=UPPER(...)` followed by `INSERT INTO CONTACT_REQUESTS ... VALUES (UPPER('...'), UPPER('...'), ...)`. This matches the proven pattern used in `contact.handler.js` (SW). **Rule**: prefer `DELETE + INSERT` over `MERGE INTO ... KEY(...)` for H2 upserts in this codebase — MERGE is fragile with computed key expressions. |
| AG | SMART-SYNC unidirectional: node2 missing messages from node1 after reconnect | `handleSyncStatusCheck` in `chat.handler.js` only sent `sync_status_report` when `myLastSentSeq > peerLastSeqNum`. User2's `last_received_seq` was historically contaminated (inflated to 10) from earlier outgoing messages mistakenly written to `sender_seq`. When user1's SW evaluated the check (`my_last_sent=8`, `peer_reported=10`), it concluded the peer was ahead and sent nothing. User2 never received a `sync_status_report` → never auto-issued `chat_history_request` → never received user1's messages. Fix: removed the conditional gate; `sync_status_report` is now always sent. `missing_count = max(0, myLastSentSeq - peerLastSeqNum)` is computed for informational logging only. See sections 6.3 and fragility points #43–44. |
| AI | Group messages arriving via propagation rendered as "Forwarded" in UI | `processGroupMessage` in `group.handler.js` stored `maxjson.forwarded ? 1 : 0` in the DB `forwarded` column. When a node reconnects and the group creator propagates queued messages to all members (with `forwarded=true` in the payload), any member that had NOT yet received the message got it for the first time via the propagation path — and their DB stored `forwarded=1`. The UI rendered a "Forwarded" badge even though the message was never forwarded by the user. Same bug existed in `handleGroupHistoryResponse` (line `msg.forwarded ? 1 : 0`). Fix: always store `forwarded=0` in both insert paths. The `forwarded` field in the payload is a routing-only hint to prevent re-propagation storms; it must never be persisted. See fragility point #42. |
| AJ | Group propagation sends message back to original sender (case sensitivity) | `propagateGroupMessage` skipped the relay peer and original sender with `memberPubkey === pubkey` and `memberPubkey === maxjson.senderPublickey` (strict equality). `memberPubkey` from `GROUP_MEMBERS` is `0X...` (SQL uppercase); `pubkey` from Maxima is `0x...` (lowercase). The skip never matched, so the original sender received their own message back as a `forwarded=true` payload — which, combined with bug AI, caused it to render as "Forwarded." Fix: added `.toUpperCase()` to all three sides of the skip condition. See fragility point #44. |
| AK | Group `sendMaximaMessage` blocks FE for 77s per offline member (`poll:true`) | `sendMaximaMessage` in `group.service.ts` used `poll:true` for both the direct Mx-address send and the publickey-fallback send. When any group member is offline, each send blocks the FE Promise for ~77 seconds waiting for Maxima delivery confirmation. In a sequential `for...await` loop, this means N × 77s freeze for a group with N offline members — appearing as "messages couldn't be sent" while user1 was offline. Fix: changed both sends to `poll:false`. Gap recovery is handled by `requestAllGroupsHistory` on reconnect, which requests group history from all members. See fragility point #45. |
| AH | seqKey false deduplication: messages 68–69 visible in DB but not rendered in UI | `deduplicateMessages` in `src/routes/chat/$address.tsx` used `seqKey = seq-them-${sender_seq}` for all messages regardless of whether they had a UUID `customId`. User1's `MESSAGE_COUNTERS` sequence had been reset at some earlier point. Older messages already in the `seenSeqKeys` set shared the same `sender_seq` numbers as new messages 68–69. When the merged array `[...finalMessages, ...prev]` was deduped, 68–69 arrived after the old messages in the iteration order and were falsely marked as duplicates and dropped from rendering. The DB had 75 messages; the UI showed only 73. Fix: added `!keys.customId` guard so `seqKey` dedup is applied **only** to messages without a valid UUID — all modern messages have UUIDs and are deduped exclusively by `customId`. See section 7.2 and fragility point #42. |
| AM | Sent group message appears doubled in sender's own chat | `handleSendMessage` generated a `customId` at `Date.now()` for the optimistic message. `sendGroupMessage` internally generated a second, independent `customId` for the DB INSERT using its own `Date.now()` call (a few milliseconds later). `deduplicateMessages` uses `customid` as the primary dedup key — since the two IDs were different, BOTH the DB version and the pending optimistic version survived every `loadMessagesFromDB` call. The optimistic message (`status: "pending"`) never resolved — it stayed in state permanently, showing the message twice. Fix: added `externalCustomId?: string` parameter to `sendGroupMessage`; the caller (`handleSendMessage`) passes its own `customId` so both the optimistic message and the DB row use the same ID. After the next `loadMessagesFromDB`, the DB version is encountered first in dedup → the pending copy is dropped. See fragility #48. |
| AN | Sent group message disappears from UI when send fails (node offline) | When the Minima node is unreachable, `sendGroupMessage` → `getGroupInfo` → `runSQL` throws `SQL timeout — node unreachable`. The tsx catch block set the message to `status: "failed"`. `loadMessagesFromDB` filtered `m.status === "pending"` only — "failed" messages were excluded from the preserved list and dropped from state on the next DB load (since the INSERT never happened either). The user's typed message silently vanished. Fix: changed filter to `m.status === "pending" || m.status === "failed"`. Failed messages now remain in state with the error indicator. When the node recovers and the user retries, the DB INSERT succeeds with the same `customId` (fragility #48) → dedup drops the failed copy cleanly. See fragility #49. |
| AO | Group message sent while offline permanently lost after navigation | When `sendGroupMessage` fails entirely (e.g. `getGroupInfo` → `runSQL` timeout), the message was never inserted into DB and no `OFFLINE_QUEUE` entry was created. The optimistic message stayed as `"failed"` in React state (fixed by Bug AN), but navigating away destroyed the state — the message was irrecoverably lost. Fix: `handleSendMessage` catch block now calls `offlineQueueService.queueGroupMessageFull(...)` with the full send parameters (groupId, message, myPublicKey, myUsername, customId, replyTo). `offline-queue.service.ts` handles type `group_message_full` by re-calling `sendGroupMessage` with the same `customId`; on success, dispatches `GROUP_UPDATE / GROUP_SYNC_END` so the group chat reloads and dedup replaces the in-memory "failed" entry with the DB version. See fragility #50. |
| AW | Channel empty state flashes briefly on load even when messages exist | `channels.$channelId.lazy.tsx` rendered `{messages.length === 0 && <EmptyGrid>}` immediately on mount, before the first `loadMessages` call completed. The component starts with `messages = []`, so the empty state appeared for ~500ms while DB was loading. Fix: added `isInitialized` state (default `false`), set to `true` in `loadMessages` `finally` block. Empty state condition changed to `isInitialized && messages.length === 0` — hidden until the first load completes regardless of result (success or SQL error). |
| AX | Channel message flashes appear/disappear/reappear on send | The React `key` for message divs was `msg.id \|\| \`${msg.timestamp}-${msg.senderPublicKey}-${i}\``. The optimistic message has `id: undefined` → falls back to the timestamp string. The DB version has `id: 5` → key becomes `"5"`. React sees a different key and unmounts+remounts the DOM node, re-triggering the `animate-in zoom-in-95` entry animation. Fix: changed key to `\`${msg.timestamp}-${(msg.senderPublicKey \|\| "").toLowerCase()}\`` for all messages. `toLowerCase()` is critical because the optimistic has `0x...` (from `myPublicKey`) but the DB returns `0X...` (from `UPPER(sender_publickey)` in the INSERT). Both now produce the same key → React reuses the DOM node → no animation re-trigger. |
| AY | Channel input textarea forces uppercase text display | The `<textarea>` had `uppercase tracking-widest` in its Tailwind className. CSS `text-transform: uppercase` applies visually but the underlying `value` remains in the original case — however it makes the input visually confusing (user types lowercase, sees uppercase). Removed both classes from the textarea. The placeholder "ENCRYPTED SIGNAL..." retains its stylized look but the user's typed text now displays normally. |
| AS | Channel `runSQL` / `sendMaximaMessage` blocking issues (same as AL/AK for groups) | `channel.service.ts` had the same two bugs as the group service: (1) `runSQL` wrapped `MDS.sql` in a bare `Promise` with no timeout — during a network outage the callback was never called, leaving `loadMessages` mutex stuck forever. (2) `sendMaximaMessage` used `poll:true` on both the Mx-address and pubkey-fallback sends, blocking the FE for ~77s per offline subscriber. Fix: added 6000ms `setTimeout` to `channel.service.ts` `runSQL`; changed both sends to `poll:false`. See fragility #47 and #45 (same rules apply to all services that wrap `MDS.sql`). |
| AT | Channel messages wiped on SQL timeout / `getChannelMessages` returned `[]` on error | `getChannelMessages()` in `channel.service.ts` caught all errors and returned `[]`. `loadMessages` in `channels.$channelId.lazy.tsx` called `setMessages(parsed)` with the empty array → all messages disappeared from the UI during a network outage. Same root cause as bug AP for groups. Fix: `getChannelMessages()` catch now does `throw err`; callers that don't need full error handling use `.catch(() => [])` locally. `loadMessages` catch path never calls `setMessages` — existing state is preserved on SQL error. See fragility #51. |
| AU | Channel message appears doubled immediately after send (online) | `handleSend` added an optimistic `{status:"pending"}` message to state, then called `publishMessage` (which saves to DB) and `loadMessages`. `loadMessages` returned `[...parsed, ...survivingPending]` — but the survivingPending filter only excluded pending messages whose timestamp matched a DB row. Because `publishMessage` originally used `Date.now()` internally (a few ms after `sendTimestamp`), the timestamps did NOT match → the optimistic copy survived alongside the DB version → double message. Fix: (1) `publishMessage` accepts `overrideDate?` and uses it for the DB INSERT timestamp. (2) `handleSend` passes `sendTimestamp` as `overrideDate`. (3) `loadMessages` filters `survivingPending` by checking `!dbTimestamps.has(m.timestamp)` — exact timestamp match discards the optimistic once DB confirms it. See fragility #54. |
| AV | `getChannelInfo` swallowed SQL timeout, causing misleading "Channel not found" error | `getChannelInfo()` caught all errors and returned `null`. `publishMessage` checks `if (!channel) throw new Error("Channel not found")`. During a network outage, `getChannelInfo` returned `null` (timeout swallowed) → `publishMessage` threw `"Channel not found"` instead of the real `"SQL timeout"`. The `handleSend` catch still queued the message correctly, but the error label was misleading for debugging. Fix: `getChannelInfo` catch now re-throws if `err.message.includes("SQL timeout")`, returning `null` only for genuine row-not-found cases (empty rows, handled before the catch). |
| AL | Group messages 9 and 10 sent while offline not shown until page refresh | During a network outage, `group.service.ts` `runSQL()` wrapped `MDS.sql` in a bare `Promise` with no timeout. When the Minima node was unreachable, the MDS library received an empty HTTP body, `JSON.parse("")` threw, and the callback was never called. `getGroupMessages()` awaited this Promise, which hung forever. `loadMessagesFromDB` in `groups.$groupId.lazy.tsx` held `isLoadingMessages.current = true` for the duration; every subsequent `loadMessagesFromDB` call was skipped ("Skipping load (active)"). Messages received after reconnection (or sent optimistically) never triggered a fresh DB read — they appeared only after a full page reload. Evidence in logs: repeated "Skipping load (active)" entries and `mdscommand_/sql ERR_ADDRESS_UNREACHABLE`. Fix: added a 6000ms `setTimeout` inside `runSQL` that calls `reject(new Error("SQL timeout — node unreachable"))` if the MDS callback hasn't fired. The `finally` block in `loadMessagesFromDB` now always runs, releasing the mutex. See fragility point #47. |
| AP | All group messages wiped from UI on SQL timeout during offline | `getGroupMessages()` in `group.service.ts` caught every SQL error and returned `[]`. `loadMessagesFromDB` in `groups.$groupId.lazy.tsx` treated this `[]` as authoritative — it set `parsedMessages = []` and computed `inMemoryOnly` from state, but called `setMessages(deduplicateMessages([...parsedMessages, ...inMemoryOnly]))` where `parsedMessages` was empty. Since pending/failed/received messages DO appear in `inMemoryOnly`, those survived; but the critical path was: `inMemoryOnly` only preserved messages with `status === "pending" || "failed" || "received"`. Any message already loaded from a PREVIOUS successful DB read had `status: undefined` (normal message from DB) — those were NOT in `inMemoryOnly`. The net result: every DB-confirmed message disappeared on the first SQL timeout, leaving only the last few optimistic ones. Fix: changed `getGroupMessages()` catch from `return []` to `throw err`. Callers that don't need a full error (e.g. `ChatsAndGroups.tsx`, `GroupList.tsx`, `group-info`) now use `.catch(() => [])` locally. `loadMessagesFromDB` propagates the throw to its own catch, which logs but does NOT call `setMessages` — preserving the full existing state. See fragility #51. |
| AQ | User1's sent messages not visible in group chat while offline | `groups.$groupId.lazy.tsx` rendered messages with `.filter((m) => m.status !== "pending" && m.status !== "zombie")`. This explicitly excluded every optimistic message with `status: "pending"`. When user1 sent a message offline, it was added to state as `{ status: "pending" }` and immediately hidden by the render filter — the user saw nothing. DM chat (`$address.tsx`) never had this filter for "pending" because DM uses `status: "sent"` (never filtered). Fix: removed `"pending"` from the render filter so it reads `.filter((m) => m.status !== "zombie")` only. Pending messages now display immediately, matching WhatsApp/Telegram behaviour. See fragility #52. |
| AR | All messages jump to left side after node reconnects and syncs | After node reconnect, `loadMessagesFromDB` reloaded and re-mapped all DB rows. The `fromMe` check inside the `useCallback` was `(senderPk).toLowerCase() === (myPublicKey).toLowerCase()`, where `myPublicKey` was captured from the closure at `useCallback([address, myPublicKey])` creation time. When `myPublicKey` loaded asynchronously (after profile fetch), the initial callback was created with `myPublicKey = ""`. The `useEffect([address])` that wired `handleNewMessage` and set the reload listener did NOT re-run when `myPublicKey` later became available (because `myPublicKey` was not in its dep array). All subsequent `loadMessagesFromDB` calls used the stale closure with `myPublicKey = ""` → `fromMe` was always `false` for all messages → everything rendered on the left. The bug was triggered after sync (a `loadMessagesFromDB` call) because initial render used optimistic messages (with `fromMe` computed at send time), which masked the stale closure. Fix: added `myPublicKeyRef = useRef(myPublicKey)` + `useEffect(() => { myPublicKeyRef.current = myPublicKey; }, [myPublicKey])` to keep the ref current. Changed `fromMe` inside `loadMessagesFromDB` to use `myPublicKeyRef.current`. Removed `myPublicKey` from `useCallback` deps (`[address]` only). See fragility #53. |
| AS | Cancelled request unread badge persists | When a contact/Maxima request was cancelled by the sender, the recipient's SW deleted the record but inserted a "System" message. Because it was inserted with `state='received'`, it kept the global unread badge at `COUNT > 0`, and because it was newer than `last_opened`, the chat list bubble also lingered. Fix: SW handlers now use `UPDATE CHAT_MESSAGES SET state='read', read=1` for all old system messages, insert the new system message as `state='read'`, and `MERGE INTO CHAT_STATUS` to update `last_opened = now`. This clears both bubbles instantly. |
| AT | DM read receipt checkmarks not updating until other user sends a message | `handleReadReceipt` and `handleDeliveryReceipt` in `chat.handler.js` ran the SQL UPDATE but never notified the FE. The FE only refreshed when a new message event arrived (which carried an implicit `CHAT_LIST_UPDATE`). Fix: wrapped both SQL calls in a callback and fire `MDS.comms.solo("CHAT_LIST_UPDATE")` when `rowsAffected > 0`. |
| AU | Expelled user appearing duplicated in Expelled Users list | `getGroupBans()` in `group.service.ts` used a `LEFT JOIN DISCOVERED_PEERS` which can produce multiple rows for the same publickey if `DISCOVERED_PEERS` has duplicates. Fix: added JS deduplication by `publickey.toUpperCase()` after the SQL result. |
| AV | `⚠️ [GROUP-MSG] Unknown type: message_deleted` warning | The SW sends `messageType: "message_deleted"` for group message deletions but the FE `handleIncomingGroupMessage` switch had no case for it → fell through to `default: console.warn(...)`. The deletion itself is handled correctly by the SW. Fix: added `case "message_deleted": break;` to the switch. |
| AW | Expelled user still able to enter group after expulsion (case-sensitivity) | `handleGroupMemberUpdate` in `group.handler.js` compared `myPubkey === safeMemberPublickey` (strict equality). Maxima returns `myPubkey` as lowercase `0x...` but the DB stores `safeMemberPublickey` as uppercase `0X...` → condition always false → expelled user's group data was never deleted. Fix: changed to `myPubkey.toUpperCase() === safeMemberPublickey.toUpperCase()`. |
| AX | Unbanned user unable to re-enter group after being removed from restriction list | When an admin unbans a user, the `group_member_unbanned` notification is only sent to current members (the banned user is not a member). After being unbanned, the user must manually re-request to join and the admin must manually approve — creating a hidden second approval step the admin may not be aware of. Diagnosis: confirmed via targeted `[GROUP-JOIN-UNBAN]` / `[GROUP-INVITE-UNBAN]` logs that the second join request was saved as pending but never approved. Fix: `unbanMember()` in `group.service.ts` now checks for a pending `GROUP_JOIN_REQUESTS` entry for the unbanned user. If found, calls `addMember()` (sends group invite) + `resolveJoinRequest()` (cleans up request and notifies other admins) automatically. The unban and re-invite are now a single action. |
| AY | Group-info (Registry Settings) not refreshing when a join request arrives | The `GROUP_UPDATE` window event listener in `group-info.$groupId.lazy.tsx` had a type guard `e.detail.type === "group_update"` that excluded `"group_join_requests_update"` events. The SW fires `group_join_requests_update` when a new join request arrives; this event is forwarded to `GROUP_UPDATE` by `minima.service.ts` but then silently ignored by the page handler. Fix: added `|| e.detail.type === "group_join_requests_update"` to the condition. Since the event has no direct field updates, `hasDirectFieldUpdate` stays false and `fetchGroupDetails()` is called, reloading the pending requests list. |

## 18) Reply-to-Message Feature

### 18.1 Overview
Users can reply to any message in DMs, groups, and channels. A reply carries a `replyTo` object in the Maxima payload referencing the original message.

### 18.2 Protocol
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

### 18.3 DB Schema
Four new columns added to all 3 message tables via `ADD COLUMN IF NOT EXISTS`:
- `reply_to_customid VARCHAR(512) DEFAULT NULL` — references original message `customid`
- `reply_to_text VARCHAR(512) DEFAULT NULL` — preview of original message text
- `reply_to_sender VARCHAR(160) DEFAULT NULL` — original sender's display name
- `reply_to_type VARCHAR(64) DEFAULT NULL` — original message type (text/image/etc.)

### 18.4 SW Handlers
All 3 SW handlers (`chat.handler.js`, `group.handler.js`, `channel.handler.js`) parse `replyTo` from inbound payload and persist all 4 columns. History request/response flows also include `replyTo` so replies survive history sync.

### 18.5 FE Services
- `messaging.service.ts`: `sendMessage(... replyTo?)` — new last param
- `group.service.ts`: `sendGroupMessage(... replyTo?)` — new last param
- `channel.service.ts`: `publishMessage(... replyTo?)` — new last param

### 18.6 UI
- **MessageBubble**: new `replyTo` prop renders a quote block above the message text. New `onReply` callback prop shows a "Reply" button at top of action menu.
- **Reply banner**: shown above the input bar when `replyingTo` state is set. Shows sender name + text preview. An ✕ button clears it.
- **Channels**: uses custom rendering (no MessageBubble); quote block and "Reply" button rendered inline. Reply available only to admin.

### 18.7 Important Notes
- `replyTo` carries a **snapshot** of the original message text and sender name at send time — it does NOT resolve dynamically from the DB. This is intentional for simplicity and to avoid broken references.
- Channels only allow admin to reply (consistent with the publish-only model).
- The `customid` in `replyTo` is stored for future scroll-to-original functionality but not yet implemented.
- **`CHANNEL_MESSAGES` has no `customid` column**: channel `reply_to_customid` is always NULL. The display guard must check `reply_to_text || reply_to_sender`, NOT `reply_to_customid`. See fragility point #36.
- **`loadMessagesFromDB` Phase 2 must include `replyTo`**: Phase 2 of `loadMessagesFromDB` in `$address.tsx` rebuilds the message object for token/charm status checks. It must explicitly include `replyTo: msg.replyTo` or the field is silently dropped. See fragility point #35.

### 18.8 Bugs Fixed (post-initial implementation)
| ID | Context | Root Cause | Fix |
|---|---|---|---|
| Z1 | Group messages not arriving | `processGroupMessage()` referenced `grpReplyToCustomid/Text/Sender/Type` as free variables from the outer `handleGroupMessage()` scope. On the receiver's node these variables don't exist → ReferenceError crash on every incoming group message. | Passed all 4 as explicit parameters to `processGroupMessage()`. See fragility point #37. |
| Z2 | DM reply disappeared after send | Phase 2 of `loadMessagesFromDB` (`Promise.all` token status map) rebuilt the message object but omitted `replyTo`. Optimistic message showed reply, then DB reload silently dropped it. | Added `replyTo: msg.replyTo` to Phase 2 return object. See fragility point #35. |
| Z3 | Channel reply never showed | `CHANNEL_MESSAGES` has no `customid` column → `replyTo.customid = ""` → falsy → stored as NULL → display guard `(REPLY_TO_CUSTOMID) ? ...` always null. `reply_to_text`/`reply_to_sender` were correctly stored. | Changed guard from `reply_to_customid` to `reply_to_text \|\| reply_to_sender` in both `loadMessages` (FE) and channel history row mapping (SW). See fragility point #36. |
| Z4 | DM optimistic message missing quote block | `newMsg` was created before `currentReplyTo` was captured (after `setMessages`). So optimistic message had `replyTo: undefined`. | Moved `const currentReplyTo = replyingTo` capture BEFORE `newMsg` construction; added `replyTo: currentReplyTo` to optimistic message. |
| Z5 | DM reply not persisted from sender side | `chatService.insertMessage()` INSERT SQL was missing all 4 `reply_to_*` columns — they were not being written to the DB by the sender. | Added `reply_to_customid/text/sender/type` to the destructure and INSERT in `chatService.insertMessage()`. |

## 19) UI and UX Defaults

1. **Discovery View Mode**: The default view mode in `/discovery` is set to `"all"`. This ensures that users, groups, and channels are all visible by default to new users, encouraging broader exploration of available content. The "All" tab is also positioned first in the filter bar for consistency with its default status.

## 20) Log Optimization and Debugging Defaults

As of version 3.0 (April 2026), the application has a strictly pruned logging strategy to prevent production consoles from being saturated by Minima MDS dumps.

### 20.1 Frontend Build Stripping (Vite)
- **Currently Disabled**: `vite.config.ts` includes the `terser` config to strip `console.log` in production, but it is commented out for active Alpha/Beta debugging.
- Once the app is stable, uncomment the `minify: 'terser'` config blocks.
- **Rule for UI development**: Use `console.warn` or `console.error` for errors that absolutely must remain visible in production, to prepare for when the final stripping is reactivated.

### 20.2 Service Worker Debugging (SW_DEBUG)
- The Rhino/Nashorn engine logs directly to the Minima Java console via `MDS.log()`. To keep this trace clean for node operators, all high-frequency payloads (like chat payload parsing, raw string dumps, and polling latency events) must be gated.
- A global `var SW_DEBUG = false;` flag is located at the top of `public/service-workers/main.js`.
- If an agent or developer needs to debug the raw inbound payload of `MAXIMA` messages or deduplication SQL, they must manually set this flag to `true`, build the SW, and revert it immediately after.
- **`logToUI` removed**: The legacy `logToUI` utility (which spammed the bridge with `UI_LOG:` payloads so the frontend would print them) was removed due to bridge saturation. Use `MDS.log` for backend debugging.

## 21) Avatar and UI Hydration Patterns

1. **DM header avatars must read Discovery cache, not only Maxima contact `extradata.icon`**. In `src/routes/chat/$address.tsx`, the one-to-one chat header can load a peer through `DISCOVERED_PEERS` even when `maxcontacts` has no avatar. The avatar may be stored in either `DISCOVERED_PEERS.avatar` or `DISCOVERED_PEERS.extra_data.avatar` (sometimes URL-encoded). If the chat page only reads `peer.ICON` or `contact.extradata.icon`, it falls back to the generic avatar even though the real photo is already cached locally.
2. **Group chat headers must hydrate `contact.extradata.icon` from `GROUPS.avatar`**. In `src/routes/groups.$groupId.lazy.tsx`, the route reuses the DM-style `contact` shape for header rendering. If the initial group load copies only the group name and not the `avatar`, the UI always shows the letter badge even when `groupService.getGroupInfo()` already returned a valid group photo. `GROUP_UPDATE` refreshes should also propagate `avatar` into that same `contact.extradata.icon` field.
3. **Channel chat headers must hydrate local avatar state from `CHANNELS.avatar`**. In `src/routes/channels.$channelId.lazy.tsx`, the channel header has its own `channelName` / `channelAvatar` state instead of the DM/group contact shape. If `init()` copies only the name and flags, the header always renders the fallback `Radio` icon even though `channelService.getChannelInfo()` already returned `avatar`. `CHANNEL_UPDATE` refreshes should update that local avatar state directly.
4. **DM rows in `ChatsAndGroups` must fall back to `chat.avatar`, not only `maxcontacts`**. `minimaService.getRecentChats()` / `chat.service.ts` already expose `DISCOVERED_PEERS.avatar` as `chat.avatar` for one-to-one rows. If `src/components/chat/ChatsAndGroups.tsx` resolves row avatars only through the in-memory `contacts` map (`contact.extradata.icon`), non-contact peers render with the generic image even though the discovery-backed avatar is already present on the chat item.
5. **`getRecentChats()` must extract avatars from both `DISCOVERED_PEERS.avatar` and `DISCOVERED_PEERS.extra_data`**. In `src/services/chat.service.ts`, some peers have no direct `avatar` column value even though `extra_data.avatar` is populated from profile sync. The recent-chat SQL must select `extra_data`, and the row mapping must parse it; otherwise DM list rows still surface an empty `chat.avatar` even after the UI fallback to `chat.avatar` is implemented.
6. **Group creation must persist the avatar at creation time, not only allow editing later**. `src/routes/create-group.tsx` now lets the creator pick an image before submit, and `groupService.createGroup(...)` must accept that avatar, store it in `GROUPS.avatar`, and include it in the first `group_invite` fanout. If the service keeps creating groups with `avatar=''`, invitees and the creator's own chat list/header fall back to initials until a later manual edit.
7. **Channel creation should expose the same pre-submit avatar flow as groups**. `channelService.createChannel(...)` already supports an `avatar` parameter and persists it to `CHANNELS.avatar`, but `src/routes/create-channel.tsx` must actually collect and pass that image. Without the creation-form picker, channels start with the generic radio badge until an admin edits the avatar later.
8. **Group add-member `community` entries should carry the same avatar data as other recent-chat derived pickers**. In `src/routes/group-info.$groupId.lazy.tsx`, the add-member modal pulls non-contact users from `chatService.getRecentChats()`. Those rows already expose `chat.avatar`; if the modal keeps only `name/currentaddress/type`, community users render as initials while the equivalent pickers in create-group/create-channel/channel-invite show their photos.
9. **Group `Members` list must hydrate per-member avatars from `DISCOVERED_PEERS`**. In `src/routes/group-info.$groupId.lazy.tsx`, the main members list is fed by `groupService.getGroupMembers()`, not by `recent chats`. If that query only resolves `alias` and the route maps only `name/role`, the list always shows initials. `getGroupMembers()` must surface `DISCOVERED_PEERS.avatar` and parse `DISCOVERED_PEERS.extra_data.avatar`, and the route must render that avatar for each member row.
10. **Channel `Subscribers` list has the same avatar dependency as group `Members`**. `channelService.getChannelSubscribers()` must return subscriber avatar data from `DISCOVERED_PEERS.avatar` and `DISCOVERED_PEERS.extra_data.avatar`, and `src/routes/channel-info.$channelId.lazy.tsx` must render it. Otherwise the channel subscriber list always falls back to initials even when the peer photo is already cached locally.
11. **Channel chat menu `Actions` must deep-link to the settings tab**. In `src/routes/channels.$channelId.lazy.tsx`, the second menu entry should navigate to `/channel-info/$channelId` with `search.tab = "settings"` (and preserve `returnTo`). If it omits the tab, the user lands on the default `Info/Profile` tab and the menu action feels broken.
12. **Keep shared avatar helpers out of single-query scope in `chat.service.ts`**. `getRecentChats()` has both optimized and legacy row-mapping paths. If `extractDiscoveryAvatar` is declared inside only one callback path, the other path compiles against an out-of-scope symbol and breaks `tsc`. Shared row mappers should stay on the class (or module) so both query paths use the same implementation.

## 22) Delete Message Feature

### 22.1 Overview
Any user can delete their own messages in DMs, groups, and channels. The deletion propagates to all other participants via Maxima so every node marks the message as deleted locally. The deleted state is permanent and not reversible from the UI.

### 22.2 Protocol Types
| Context | Maxima type sent by FE | Handled by SW |
|---|---|---|
| DM | `message_deleted` | `chat.handler.js` → `handleMessageDeleted()` |
| Group | `group_message_deleted` | `group.handler.js` → `handleGroupMessageDeleted()` |
| Channel | `channel_message_deleted` | `channel.handler.js` → `handleChannelMessageDeleted()` |

### 22.3 Fanout — Who Sends to Whom
- **DM**: FE sends one Maxima message to the peer's public key.
- **Group**: FE iterates `GROUP_MEMBERS` (via `groupService.getGroupSubscribers()`) and sends one Maxima message per member, skipping self. Uses `(member as any).PUBLICKEY || member.publickey` pattern.
- **Channel**: FE iterates `CHANNEL_SUBSCRIBERS` (via `channelService.getChannelSubscribers()`) and sends one Maxima message per subscriber, skipping self. Uses `(sub as any).PUBLICKEY || sub.publickey` pattern. **The SW handler does NOT re-fanout** — the FE already covers all subscribers.

### 22.4 Payload Shape
```json
{
  "type": "group_message_deleted",
  "groupId": "0x...",
  "customId": "0x...",
  "senderPublicKey": "0x..."
}
```
```json
{
  "type": "channel_message_deleted",
  "channelId": "0x...",
  "senderSeq": 42
}
```
DM uses `customId` only (no group/channel ID).

### 22.5 DB Columns Affected
All three message tables share the same pattern:
```sql
UPDATE <TABLE> SET deleted=1, deleted_at=<timestamp_ms>
WHERE <id_col>=<value> AND <msg_key>=<value>
```
- `CHAT_MESSAGES`: `WHERE customid='...'`
- `GROUP_MESSAGES`: `WHERE UPPER(group_id)=UPPER('...') AND customid='...'`
- `CHANNEL_MESSAGES`: `WHERE UPPER(channel_id)=UPPER('...') AND sender_seq=<n>`

`deleted` is an INTEGER column (0/1). `deleted_at` is a BIGINT timestamp in ms.

### 22.6 SW Handler Behavior
1. Parse `groupId`/`channelId`/`customId`/`senderSeq` from payload.
2. Run UPDATE with case-insensitive ID comparison.
3. Fire `MDS.comms.solo(JSON.stringify({ type: "GROUP_MESSAGE_DELETED"|"CHANNEL_MESSAGE_DELETED", ... }))` so the FE reacts.
4. **No role/authorization check on the receiver side.** DMs are peer-to-peer (sender is implicit). Groups/Channels: trust any authenticated Maxima sender of this type — do not query `GROUP_MEMBERS` or `CHANNEL_SUBSCRIBERS` for role validation (lookup can return empty due to key-case mismatch and blocks all propagation).

### 22.7 FE Reaction
- FE listens for `GROUP_MESSAGE_DELETED` / `CHANNEL_MESSAGE_DELETED` via MDSCOMMS handler in `minima.service.ts`.
- On receipt, dispatches `GROUP_MESSAGE_DELETED` / `CHANNEL_MESSAGE_DELETED` CustomEvent.
- Route (`groups.$groupId.lazy.tsx`, `channels.$channelId.lazy.tsx`) listens and updates local message state to mark the message deleted without a full DB reload.

### 22.8 Rendering
Deleted messages render as a grey "This message was deleted" placeholder. The `deleted` boolean comes from:
- SW-persisted rows: `row.DELETED` (uppercase, raw SQL) or `row.deleted` (lowercase, already-mapped object).
- **Always check both**: `row.DELETED === 1 || row.DELETED === "1" || row.deleted === 1 || row.deleted === "1"`.

### 22.9 Critical Patterns (see also Fragility Points #38–41)
- Subscriber/member lists from MDS SQL have UPPERCASE keys (`PUBLICKEY`). Always use `(sub as any).PUBLICKEY || sub.publickey`.
- `group_id` and `channel_id` WHERE clauses must use `UPPER()` to avoid silent 0-row updates.
- Channel SW handler must NOT apply role checks — channels are admin-broadcast.
- Group route `loadMessagesFromDB` re-maps already-mapped objects (lowercase `deleted`), not raw SQL rows — use both case variants.

### 22.10 Bugs Fixed
See Closed/Fixed table entries AA–AD in section 17.

## 23) Groups Feature

### 23.1 Overview
Groups are multi-participant chat rooms. Any user can create a group and invite others. Groups support roles, moderation, paginated history sync, auto-approval of join requests, and invite-link-based joining.

### 23.2 Roles and Permissions
| Role | Immutable | Can send messages | Can invite/remove | Can update settings | Can promote |
|---|---|---|---|---|---|
| `creator` | Yes (cannot be changed or removed) | Yes | Yes | Yes | Yes |
| `admin` | No | Yes | Yes | Yes | No (only creator can) |
| `member` | No | Yes | No | No | No |

Banned users are **not** a role in `GROUP_MEMBERS` — they are stored separately in `GROUP_BANS` with `(group_id, publickey)`. Ban check precedes every add-member and message-receive operation.

### 23.3 DB Tables
| Table | Purpose | Key Columns |
|---|---|---|
| `GROUPS` | Group metadata | `group_id`, `name`, `creator_publickey`, `description`, `avatar`, `is_public`, `auto_approve` |
| `GROUP_MEMBERS` | Membership and roles | `group_id`, `publickey`, `username`, `role`, `joined_date` |
| `GROUP_MESSAGES` | Chat messages | `group_id`, `sender_publickey`, `sender_username`, `type`, `message`, `filedata`, `date`, `sender_seq`, `customid`, `propagated`, `forwarded`, `reply_to_*`, `deleted`, `deleted_at` |
| `GROUP_BANS` | Ban list (persisted across re-joins) | `group_id`, `publickey`, `username`, `banned_by`, `banned_at` |
| `GROUP_JOIN_REQUESTS` | Pending join requests (auto_approve=false) | `group_id`, `publickey`, `username`, `requester_address`, `status` |

`GROUP_MESSAGES.propagated` = 1 means the SW has already processed and accepted this message. Duplicate arrives are silently skipped if `propagated=1`.

### 23.4 Protocol Types
| Maxima Type | Direction | DB Impact | SW Signal |
|---|---|---|---|
| `group_invite` | Admin → new member | INSERT GROUPS, GROUP_MEMBERS, GROUP_BANS | `group_list_updated`, `group_sync_start` |
| `group_message` | Member → all members (fanout) | INSERT GROUP_MESSAGES | (FE polls via sync) |
| `group_member_added` | Admin → all members | INSERT GROUP_MEMBERS | `group_update` |
| `group_member_removed` | Admin → all members | DELETE GROUP_MEMBERS; if self-remove → wipe all local group data | `group_update` |
| `group_member_unbanned` | Admin → all members | DELETE GROUP_BANS | `group_update` |
| `group_update_details` | Admin → all members | UPDATE GROUPS | `group_update` (with new name/avatar/auto_approve) |
| `group_role_update` | Creator/admin → all | UPDATE GROUP_MEMBERS SET role | `group_update` |
| `group_join_request` | User → admin's Mx address | INSERT GROUP_JOIN_REQUESTS (if manual) or auto-approve flow | `group_join_requests_update` |
| `group_join_request_propagated` | Admin → other admins | UPSERT GROUP_JOIN_REQUESTS | `group_join_requests_update` |
| `group_join_request_resolved` | Admin → other admins | DELETE GROUP_JOIN_REQUESTS | `group_join_requests_update` |
| `history_request` / `history_response` | SW ↔ peers | INSERT GROUP_MESSAGES (on response) | `GROUP_SYNC_START`, `GROUP_SYNC_END` |
| `group_address_beacon` | Any member → all | DELETE+INSERT DISCOVERED_PEERS | none |
| `group_message_deleted` | Member → all members | UPDATE GROUP_MESSAGES deleted=1 | `GROUP_MESSAGE_DELETED` |

### 23.5 Direct Invite vs Invite-Link Join

**Direct Invite** (`group_invite`):
1. Admin calls `addMember(groupId, [pubkeys])`.
2. SW sends `group_invite` payload (includes full member list, ban list, metadata) directly to new member.
3. Recipient SW: INSERT GROUPS + GROUP_MEMBERS + GROUP_BANS, fires `group_list_updated` + `group_sync_start`.
4. No approval needed — member is instantly in the group.

**Invite-Link Join** (`group_join_request` → `group_invite`):
1. User decodes `mcgrp://` link → extracts `groupId`, admin's Mx address.
2. FE sends `group_join_request` to admin's Mx address.
3. Admin SW: checks `auto_approve` in GROUPS.
   - `auto_approve=true` → auto-adds member, sends `group_member_added` to all, sends `group_invite` to joiner.
   - `auto_approve=false` → inserts into `GROUP_JOIN_REQUESTS`, broadcasts `group_join_request_propagated` to all admins for review.
4. Manual approval: Admin calls `resolveJoinRequest(groupId, pubkey, "approved")` → triggers `addMember()` flow.

Invite link format: `mcgrp://[base64({ g: groupId, n: groupName, p: adminPubkey, a: adminAddress })]`

### 23.6 Auto-Approve
- Stored as `GROUPS.auto_approve` (INT 0/1; coerced from string "TRUE"/"1"/boolean true in SW).
- When `true`: join requests are immediately processed without admin intervention.
- When `false`: request stored in `GROUP_JOIN_REQUESTS` (status=`pending`) and propagated to all admins.
- Synced via `group_update_details` when changed. When a member is promoted to admin, they receive a settings snapshot (including current `auto_approve`) from the promoter's SW.

### 23.7 Sync Protocol (Paginated)
History sync is **per-peer, paginated in 50-message pages**.

State object per active sync:
```javascript
_pendingSyncs[groupId] = {
  expected:   number,           // peers requested
  pending:    { pubkey: true }, // awaiting first response (keys UPPERCASE)
  paginating: { pubkey: true }, // received full page, requesting next
  retryCount: number,           // 0–2
  startedAt:  Date.now()
}
```

Flow:
1. `requestGroupHistoryFromSW(groupId)`: fires `GROUP_SYNC_START`, finds last local timestamp, sends `history_request` to all `GROUP_MEMBERS` via `DISCOVERED_PEERS` addresses.
2. Each peer responds with up to 50 messages.
3. If response.length >= 50 → peer moves to `paginating`, next page requested with `sinceTimestamp = latestInPage`.
4. If response.length < 50 → peer marked done.
5. When all peers done → `GROUP_SYNC_END`.
6. Timeout: 30s via `checkSyncTimeouts()` (called from `MDS_TIMER_10SECONDS`). Up to 2 retries if zero responses received.

**Critical**: peer keys in `pending`/`paginating` must be `.toUpperCase()` at both read and write (SQL returns `0X...`, Maxima delivers `0x...`). See fragility point #22.

### 23.8 SW Signals
| Signal | Payload | Purpose |
|---|---|---|
| `group_list_updated` | `{ type }` | New group joined — refresh group list in UI |
| `group_sync_start` | `{ type, groupId }` | Lowercase — fired after invite-link join; triggers sync |
| `GROUP_SYNC_START` | `{ type, groupId }` | Uppercase — fired by `requestGroupHistoryFromSW` |
| `GROUP_SYNC_END` | `{ type, groupId }` | Sync complete |
| `group_update` | `{ type, groupId, [name, description, avatar, auto_approve] }` | Member list, settings, or role changed |
| `group_join_requests_update` | `{ type, groupId }` | Pending join request inserted or resolved |
| `GROUP_MESSAGE_DELETED` | `{ type, groupId, customId }` | Message marked deleted |

**Important**: `minima.service.ts` MDSCOMMS handler must handle BOTH `group_list_updated` (lowercase) and `GROUP_SYNC_START` (uppercase). Missing either causes the UI to not refresh. See fragility point #33.

### 23.9 Authorization (SW-enforced)
- `group_update_details`: SW checks sender's role in `GROUP_MEMBERS` — must be `creator` or `admin`.
- `group_role_update`: same check + cannot change `creator` role.
- `group_message`: SW checks `GROUP_BANS` — discards if sender is banned.
- `group_invite`: SW checks `GROUP_BANS` — ignores if WE are banned in that group.
- `group_join_request`: SW checks receiver must be `creator` or `admin`.
- `group_member_added`/`removed`: trusted from sender (no additional SW check beyond ban list).

## 24) Channels Feature

### 24.1 Overview
Channels are broadcast-style one-to-many feeds. Unlike groups, channels follow an **admin-broadcast model**: only the admin publishes messages (UI-enforced; protocol does not reject other senders). Subscribers receive messages and can reply (admin-only in UI). Channel history is synced from the admin.

### 24.2 Roles and Permissions
Valid roles in `CHANNEL_SUBSCRIBERS`: `creator`, `admin`, `subscriber`.

| Operation | Enforced By | Who Can |
|---|---|---|
| Publish message | UI only | Admin |
| Delete message | UI + SW trust (no role check) | Admin |
| Invite subscriber | FE service (no SW check) | Admin |
| Remove subscriber | FE service (no SW check) | Admin |
| Update channel info | FE service; SW: no explicit check | Admin |
| Update subscriber role | SW: checks sender is `admin` | Admin |
| Join via invite link | Any user | Any user |

**Important**: The SW handler for `channel_message` does NOT check the sender's role. Authorization for publishing is UI-level only. Do not add role checks to the SW message handler — it would break history sync (messages replayed from non-admin history responses would be rejected).

### 24.3 DB Tables
| Table | Purpose | Key Columns |
|---|---|---|
| `CHANNELS` | Channel metadata | `channel_id`, `name`, `description`, `admin_publickey`, `created_date`, `avatar`, `is_public`, `archived`, `favorite` |
| `CHANNEL_SUBSCRIBERS` | Subscriber list | `channel_id`, `publickey`, `username`, `joined_date`, `role` |
| `CHANNEL_MESSAGES` | Messages | `channel_id`, `sender_publickey`, `sender_username`, `type`, `message`, `filedata`, `date`, `sender_seq`, `forwarded`, `reply_to_*`, `deleted`, `deleted_at` |
| `CHANNEL_MSG_COUNTERS` | Per-sender sequence tracking | `channel_id`, `sender_publickey`, `last_seen_seq`, `my_next_seq` |

`CHANNEL_MESSAGES` has **no `customid` column**. Dedup is by `(channel_id, UPPER(sender_publickey), date)`. Reply-to display must use `reply_to_text || reply_to_sender` as guard. See fragility points #36.

`CHANNEL_MSG_COUNTERS` uses H2 `MERGE INTO ... KEY(channel_id, sender_publickey)` — NOT PostgreSQL `ON CONFLICT`. See fragility point #28.

### 24.4 Protocol Types
| Maxima Type | Direction | DB Impact | SW Signal |
|---|---|---|---|
| `channel_invite` | Admin → new subscriber | INSERT CHANNELS, CHANNEL_SUBSCRIBERS (self + admin) | `CHANNEL_UPDATE` |
| `channel_message` | Admin → all subscribers | INSERT CHANNEL_MESSAGES, MERGE CHANNEL_MSG_COUNTERS | `CHANNEL_NEW_MESSAGE` |
| `channel_info_updated` | Admin → all | UPDATE CHANNELS | `CHANNEL_UPDATE` |
| `channel_role_update` | Admin → all | UPDATE CHANNEL_SUBSCRIBERS | `CHANNEL_UPDATE` |
| `channel_join_request` | User → admin's Mx | INSERT CHANNEL_SUBSCRIBERS + CHANNEL_MESSAGES (system) | `CHANNEL_NEW_MESSAGE` |
| `channel_subscriber_added` | Admin → all | MERGE CHANNEL_SUBSCRIBERS | `CHANNEL_UPDATE` |
| `channel_subscriber_removed` | Admin → all + removed user | DELETE CHANNEL_SUBSCRIBERS | `CHANNEL_UPDATE` |
| `channel_history_request` | Subscriber → admin | SELECT CHANNEL_MESSAGES (up to 50) | (sends `channel_history_response`) |
| `channel_history_response` | Admin → subscriber | INSERT CHANNEL_MESSAGES (via handleChannelMessage) | `CHANNEL_NEW_MESSAGE`, `CHANNEL_SYNC_END` |
| `message_deleted` | Admin → all subscribers | UPDATE CHANNEL_MESSAGES deleted=1 | `CHANNEL_MESSAGE_DELETED` |

### 24.5 Direct Invite vs Join Request

**Direct Invite** (`channel_invite`):
1. Admin calls `inviteSubscriber(channelId, pubkey)`.
2. FE sends `channel_invite` to invitee + `channel_subscriber_added` to all current subscribers.
3. Invitee SW: INSERT CHANNELS + INSERT CHANNEL_SUBSCRIBERS (self as `subscriber`, admin as `admin`), then calls `requestChannelHistoryFromSW`.
4. **Critical**: admin entry MUST be inserted (`role='admin'`) with `joined_date` (NOT NULL). Without it, the history request finds only self (filtered out) and exits with "No remote subscribers". See fragility point #29 and bug T.

**Join Request** (`channel_join_request` → `channel_invite`):
1. User decodes `mcch://` link → extracts `channelId`, admin's Mx address.
2. FE sends `channel_join_request` to admin's Mx address.
3. Admin SW: auto-accepts (no approval gate exists for channels), INSERT CHANNEL_SUBSCRIBERS, inserts system message, sends `channel_invite` back to requester.

Invite link format: `mcch://[base64({ c: channelId, n: channelName, p: adminPubkey, a: adminAddress })]`

### 24.6 Sync Protocol
Channel history requests go to the **admin only** (unlike groups which fanout to all members).

```
_pendingChannelSyncs[channelId] = Date.now()   // guard set on request
```

Flow:
1. `requestChannelHistoryFromSW(channelId)`: checks guard (skip if in-flight), sets guard, fires `CHANNEL_SYNC_START`.
2. Finds last local message timestamp, sends `channel_history_request` to all `CHANNEL_SUBSCRIBERS` except self (case-insensitive self-filter).
3. Admin responds with `channel_history_response` (up to 50 messages).
4. SW calls `handleChannelMessage(msg, skipNotify=true)` for each message (dedup + insert).
5. After all messages processed: fires `CHANNEL_SYNC_END`, clears guard.
6. Timeout: 30s via `checkChannelSyncTimeouts()` (`MDS_TIMER_10SECONDS`).

Gap detection: if `senderSeq > lastSeen + 1` in `CHANNEL_MSG_COUNTERS` → automatically triggers history request.

### 24.7 SW Signals
| Signal | Payload | Purpose |
|---|---|---|
| `CHANNEL_UPDATE` | `{ type, channelId }` | Subscriber list or channel info changed |
| `CHANNEL_NEW_MESSAGE` | `{ type, channelId }` | New message arrived |
| `CHANNEL_MESSAGE_DELETED` | `{ type, channelId, senderSeq }` | Message marked deleted |
| `CHANNEL_SYNC_START` | `{ type, channelId }` | Sync started |
| `CHANNEL_SYNC_END` | `{ type, channelId }` | Sync complete |

### 24.8 Groups vs Channels — Key Differences
| Aspect | Groups | Channels |
|---|---|---|
| **Who publishes** | Any member | Admin only (UI-enforced) |
| **Who can reply** | Any member | Admin only (UI-enforced) |
| **Approval gate** | `auto_approve` toggle | None (admin auto-accepts all join requests) |
| **Sync fanout** | All GROUP_MEMBERS | Admin only |
| **Dedup key** | `customid` (UUID) | `(channel_id, sender_publickey, date)` |
| **Role check in SW** | Yes (update_details, role_update, join_request) | Only for `channel_role_update` (sender must be admin) |
| **Message ID for delete** | `customid` | `sender_seq` |
| **Re-join behavior** | Blocked if banned | No ban mechanism |

## 25) Token and Charm Transfers

### 25.1 Overview
Token and charm messages combine a Minima blockchain transaction with a chat message. The message is saved immediately as `pending`; it transitions to `confirmed` when the blockchain includes the transaction. Both `CHAT_MESSAGES` and `TRANSACTIONS` are updated in sync via `txpowid`.

- **Token**: transfer of a named Minima token (ERC-20 style). Includes `tokenid` in sender's payload.
- **Charm**: transfer of native Minima currency. Identified by `type="charm"` and `amount > 0`.

### 25.2 Message State Machine

**Sender side** (`CHAT_MESSAGES.state`):
```
pending → sent → delivered → confirmed
                           ↘ failed
```
- `pending`: saved optimistically; Minima in READ mode queues the send as pending approval
- `sent`: Maxima notification sent after `MDS_PENDING` approval
- `delivered`: receipt received from peer
- `confirmed`: `transactionPollingService` detects txpowid in a confirmed block (3+ blocks)
- `failed`: transaction rejected by consensus

**Recipient side** (`CHAT_MESSAGES.state`):
```
unverified → received → confirmed
```
- `unverified`: Maxima message arrived with type `token`/`charm`; saved by `chat.handler.js` with `state='unverified'`. **Hidden from UI** (`loadMessagesFromDB` has `AND state != 'unverified'`).
- `received`: promoted by SW after blockchain verification confirms the coin actually landed. Three verification paths (tried in order):
  1. **NEWCOIN fast path** (`promoteUnverifiedByCoin` in `transaction.handler.js`): when NEWCOIN fires, the coin's state vars (`state['0']=timestamp`, `state['1']='204'`) are matched against `original_timestamp` of unverified messages. Fastest and most reliable.
  2. **txpow scan** (`verifyIncomingTransaction` in `tx-checker.js`): scans `txpow address:<myAddr> max:50` for matching state vars. May fail if txpow is not yet indexed.
  3. **coins fallback** (in `checkUnverifiedIncomingMessages`): scans all unspent coins via `coins` command for MetaChain state vars matching the timestamp.
- `confirmed`: SW `checkIncomingTransactions()` promotes after message age exceeds ~150s (3 Minima blocks).

Token/charm messages **never reach `read` state** — `handleReadReceipt` skips `type='token'` and `type='charm'`.

**Known fragility**: the `txpow address:` scan may not find recently arrived transactions. Always prefer the NEWCOIN coin-data path or the `coins` command fallback. The `state[3]` (sender key) check was removed from verification because key format mismatches between DB (UPPER) and blockchain caused false negatives; timestamp + MetaChain marker (`state[1]='204'`) is sufficient for uniqueness.

### 25.3 TRANSACTIONS Table Schema
```sql
CREATE TABLE TRANSACTIONS (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  txpowid      VARCHAR(512) NOT NULL UNIQUE,
  type         VARCHAR(32),          -- "token", "charm"
  publickey    VARCHAR(512),         -- recipient's public key
  message_timestamp BIGINT,
  status       VARCHAR(32) DEFAULT 'pending',  -- "pending", "sent", "confirmed", "rejected"
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  metadata     CLOB,                 -- extra data
  pendinguid   VARCHAR(512),
  date         BIGINT,
  amount       VARCHAR(64),
  tokenid      VARCHAR(512),
  message      VARCHAR(255)
)
```

`CHAT_MESSAGES.txpowid` links to `TRANSACTIONS.txpowid`. Both must stay in sync — never update one without the other.

### 25.4 Maxima Payload
```json
{
  "type": "token",
  "message": "optional text",
  "txpowid": "0x...",
  "amount": 10,
  "customid": "0x...",
  "seq": 42
}
```
The receiver's payload omits `tokenid` (added only by sender). Dedup strategy for token/charm uses `txpowid` as an additional key alongside `customid`. See section 7.4.

### 25.5 Pre-PoW txpowid Problem
When Minima is in **READ mode**, `send` commands go through a pending approval queue. `MDS_PENDING` fires once approved and provides a `txpowid` in its event payload — but this is a **pre-PoW txpowid** (e.g. `0x43F3F0...`). The **real** blockchain txpowid (e.g. `0x00001B...`) is assigned only after Proof-of-Work and differs completely.

Consequences:
- `txpow txpowid:<pre-pow-id>` returns `not_found` — useless for confirmation
- The Maxima notification message sent to the recipient also carries the pre-PoW txpowid
- The real txpowid must be discovered via `txpow address:<myAddr> max:50` searching for `state[0]=<timestamp>` and `state[1]="204"` (MetaChain chain ID)

The coin-discovery service (`coin-discovery.js`) performs this search and updates `CHAT_MESSAGES.txpowid` with the real blockchain txpowid. Once the DB has the real id, confirmation polling can succeed.

### 25.6 Sender Confirmation Polling
`transactionPollingService` (FE) polls on NEWBLOCK events:
1. Calls `txpow txpowid:<id>` for each `TRANSACTIONS` row in `sent` state.
2. If not found (pre-PoW id): falls back to `txpow address:<myAddr> max:50` searching by `state[0]=<timestamp>`.
3. If found in confirmed block with 3+ confirmations: updates `TRANSACTIONS.status='confirmed'` + `CHAT_MESSAGES.state='confirmed'`.
4. If rejected: updates both to `failed`.

### 25.7 Recipient Confirmation — SW `checkIncomingTransactions()`
Runs in `transaction.handler.js` on every `NEWBALANCE` event and at every `GOSSIP_INTERVAL`.

**Why coin-based and not txpow-based:**
Minima generates a fresh address per transaction. `MDS.cmd("getaddress")` returns the node's current default address, which is typically different from the address the incoming coin actually arrived at. Therefore `txpow address:<defaultAddr>` will not find incoming transactions that went to a different (older) address. The `coins relevant:true` command returns all unspent coins owned by the node regardless of which address they arrived at, and the `coin.created` field gives the exact block the coin was mined in — no txpowid needed.

**Flow:**
1. Queries `CHAT_MESSAGES WHERE state IN ('received','read') AND type IN ('token','charm') AND username != 'Me'`
2. Calls `MDS.cmd("status")` to get current block once.
3. Calls `MDS.cmd("coins relevant:true")` to get all owned unspent coins.
4. For each message: matches a coin by `state['0'].data === original_timestamp` AND `state['1'].data === '204'`.
5. Computes `confirmations = currentBlock - coin.created`. If `>= 3`: updates DB to `state='confirmed'`, fires `MDS.comms.solo({ type: "TOKEN_INCOMING_CONFIRMED", msgId })`.
6. Frontend receives `MDSCOMMS` event → `TOKEN_INCOMING_CONFIRMED` handler → reloads chat.

**Timing:** Synchronized with the sender sidebar — both depend on 3 Minima blocks (~50s each). The receiver message confirms at essentially the same moment the sender's balance stops blinking.

**Do NOT use `txpow address:` for incoming confirmation.** It will fail silently when the coin arrived at a non-default address, causing messages to stay stuck in `received` forever.

### 25.8 UI Status Badge (MessageBubble)
`MessageBubble.tsx` shows status badges in the token/charm card header:
- **Sender** (`fromMe=true`): `PROCESSING` (pending/sent/delivered) → `CONFIRMED` (confirmed) → `FAILED`
- **Recipient** (`fromMe=false`): `RECEIVING` (received) → `CONFIRMED` (confirmed)

Both sides use the same emerald-green `CONFIRMED` badge once the blockchain confirms.

### 25.9 Important Notes
- Token messages look different on sender vs receiver side (sender has `tokenid`, receiver does not). The dedup strategy intentionally matches on type+timestamp, NOT content. See section 7.4.
- Charm and token messages share the same `MessageBubble` card component in the UI with status badge and pending animation.
- The `amount` field in `CHAT_MESSAGES` is INT; in `TRANSACTIONS` it is VARCHAR(64) to support decimal precision.
- In frontend React code (`$address.tsx`), always use `MDS.cmd(...)` directly — **never** `(window as any).MDS.cmd(...)`. The `MDS` object is imported at module scope; `window.MDS` may be undefined and causes a TypeError crash.
- `markChatAsOpened` SQL must exclude `state != 'received'` to avoid bypassing the confirmation flow for incoming tokens. See `messaging.service.ts`.
- **`unverified` state**: Incoming token/charm messages are initially saved by `chat.handler.js` as `state='unverified'` and are filtered out from `loadMessagesFromDB` (excluded via `AND state != 'unverified'`). They are promoted to `'received'` via two paths: (1) fast path — `promoteUnverifiedByCoin(coinData)` triggered by `NEWCOIN` event matches `coin.state['0'].data === original_timestamp`; (2) slow path — `checkUnverifiedIncomingMessages()` scans `txpow address:` then falls back to `coins` scan. Once `'received'`, `checkIncomingTransactions()` handles the 3-block confirmation.
- **`NEWBALANCE` in SW**: `msg.data` is always `{}` (empty). Do not attempt to read balance from it — use `MDS.cmd("balance")` explicitly if needed. Currently NEWBALANCE simply triggers `checkIncomingTransactions()` on every balance change.
- **Race condition fix** (`$address.tsx`): The `UPDATE state='confirmed'` callback must call `loadMessagesFromDB()` inside the callback, not after it. Not doing so causes the UI to reload before the DB write completes.

## 26) Offline Queue

### 26.1 Overview
When a Maxima send fails (peer offline, network error), the message is already saved to `CHAT_MESSAGES` as `state='pending'`. `OfflineQueueService` queues it for retry without losing the message. This is a **FE-only** service — the SW does not know about the offline queue.

### 26.2 OFFLINE_QUEUE Table (FE only)
```sql
CREATE TABLE OFFLINE_QUEUE (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  type        VARCHAR(32),    -- "chat_message", "group_message", "group_message_full"
  data        CLOB,           -- JSON-serialized message data
  created_at  BIGINT,
  retry_count INT DEFAULT 0,
  state       VARCHAR(16) DEFAULT 'pending'  -- "pending", "sent"
)
```

### 26.3 Queue and Retry Flow
1. `messagingService.sendMessage()` fails → calls `offlineQueueService.queueChatMessage()`.
2. Message already in `CHAT_MESSAGES` as `state='pending'`.
3. Polling loop (every 30 seconds, batch of 5): calls `messagingService.retryMessage()` per queued item.
4. On success: deletes from `OFFLINE_QUEUE`, updates `CHAT_MESSAGES.state='sent'`.
5. On failure: keeps in queue (does NOT re-queue, just leaves for next poll cycle).

### 26.4 Immediate Retry on Reconnect
`offlineQueueService.triggerImmediateRetry(source)` is called when:
- FE receives `RECONNECTED` event from SW (node came back online).
- Debounced to 1.5 seconds to prevent retry storms.

**Do not call `retryMessage()` directly** from outside this service — it is not idempotent and does not handle queue cleanup.

### 26.5 `group_message_full` Queue Type
Group messages have two failure modes that require different queue types:
- **`group_message`**: DB INSERT succeeded but Maxima sends to some members failed. Only Maxima delivery needs retrying.
- **`group_message_full`**: The entire `sendGroupMessage` call failed before any INSERT (e.g. `getGroupInfo` SQL timeout). All parameters needed to reconstruct the send from scratch are stored, including the original `customId` and `timestamp`.

The `group_message_full` handler in `offline-queue.service.ts` calls `sendGroupMessage` with:
- The original `customId` (so the optimistic "pending" message deduplicates correctly when the retry succeeds)
- The original `timestamp` via the `overrideDate` parameter (so retried messages sort at their original send time, not the retry time)

After a successful retry, the handler dispatches `GROUP_UPDATE / GROUP_SYNC_END` to trigger an immediate UI reload. See fragility #50 and bug AO.

### 26.6 `overrideDate` in `sendGroupMessage`
`sendGroupMessage(groupId, message, ..., externalCustomId?, overrideDate?)` in `group.service.ts` accepts an optional `overrideDate` timestamp (milliseconds). When provided, it replaces the internal `Date.now()` call for the message's `DATE` column and Maxima payload. This ensures retried messages sort at their original send time in the chat, not the retry time. Always pass the original `sendTimestamp` from `handleSendMessage` when queuing for retry.

## 27) DM Protocol Details

### 27.1 Message State Flow (DMs)
```
pending → sent → delivered → read
                ↘ confirmed  (token/charm only)
                ↘ failed     (token/charm only)
```

### 27.2 Delivery Receipts
- **Triggered by**: SW `handleChatMessage()` immediately after inserting a received message.
- **Sent to**: the sender of the received message.
- **Payload**: `{ type: "delivery_receipt", message: "", username: "Me", filedata: "" }`.
- **Effect on sender's DB**: `UPDATE CHAT_MESSAGES SET state='delivered' WHERE publickey=sender AND username='Me' AND state='sent'`.
- **Do not send manually from FE** — the SW handles this automatically on every inbound message.

### 27.3 Read Receipts
- **Triggered by**: FE when user opens a chat and views unread messages.
- **Sent to**: the peer whose messages are being read.
- **Payload**: `{ type: "read", message: "", username: "Me", filedata: "" }`.
- **Effect on sender's DB**: `UPDATE CHAT_MESSAGES SET state='read' WHERE publickey=peer AND username='Me' AND type='text' AND state NOT IN ('pending','failed','confirmed')`.
- **Never sent for token/charm** — token/charm state is managed by blockchain confirmation, not reads.

### 27.4 Ping/Pong (Presence)
- **Purpose**: check if a peer is online without sending a real message.
- **FE sends**: `sendPing(toPublicKey)` → Maxima message `{ type: "ping" }`.
- **SW receives ping**: `handlePing(pubkey)` → sends `{ type: "pong" }` back, throttled to 1 per 30 seconds per peer (`PONG_THROTTLE_MS = 30000`).
- **FE observes pong**: via MDSCOMMS handler → updates presence/online indicator.
- **Not persisted**: ping and pong are never written to `CHAT_MESSAGES`.
- **SW owns pong response** — FE must not send pong directly.

### 27.5 Forwarded Messages
- **What it is**: a boolean flag (`forwarded=true`) on an outbound message indicating it was not originally composed by the sender.
- **Set by**: FE when user taps "Forward" on a message and sends it to another chat.
- **Persisted in**: `CHAT_MESSAGES.forwarded` (INT 0/1) and in the Maxima payload (`forwarded: true`).
- **Display**: UI shows a "Forwarded" label above the message bubble.
- **No protocol impact**: forwarding follows the exact same send path as a normal message; `forwarded` is purely informational.
- **`replyTo` is independent**: forwarding can optionally preserve `replyTo` context but this is a UI decision.

## 28) UI Patterns and Empty States

### 28.1 Standardization: `EmptyState` Component
A reusable `EmptyState` component (`src/components/common/EmptyState.tsx`) is used to unify all non-data views (empty chats, contacts, or search results).
- **Mandatory Usage**: Do not implement inline empty state JSX. Use `<EmptyState />` for consistent UX.
- **Contextual Actions**: Every empty state should offer a clear path forward (e.g., "Add Contact", "Go to Community", "Clear Filters").
- **Aesthetics**: Uses premium backdrop filters, glassmorphism, and primary gradients to align with the "MetaChain Elite" design system.

### 28.2 Animations and Transitions
Premium entry animations are powered by custom Tailwind utility classes defined in `src/index.css` under `@layer utilities`:
- `.animate-in`: Base animation container.
- `.fade-in`: Opacity transition.
- `.zoom-in-95`: Scale entry from 95% to 100%.
- `.slide-in-from-bottom-4`: Vertical entry from below.

Any new "premium" component should leverage these classes for a consistent, fluid feel.

### 28.3 Balanced Elite Restoration (Post-Corruption)
The Group Info page (`group-info.$groupId.lazy.tsx`) was restored using "Repair Writes" to fix structural JSX imbalances caused by accidental reverts.
- **Structural Integrity**: Maintains a multi-layered glassmorphism system. Use extreme caution when using `multi_replace` to avoid breaking `div` nesting.
- **Administrative Dialogs**: Follow a standardized "Elite" model: `fixed inset-0`, `bg-black/40`, `backdrop-blur-sm`, with large `rounded-[3.5rem]` containers and high-contrast `uppercase` actions.
- **Registry & Ledgers**: Always use the grid-based Elite card system for member lists, banned ledgers, and join queues to ensure layout consistency across administrative tabs.

---

## 29) Maxima Contact Removal — Known Gotchas (Critical)

### 29.1 `maxcontacts action:remove publickey:` Does Not Work (Case-Sensitivity Bug)

Minima's internal Java implementation of `maxcontacts action:remove` does a **case-sensitive** `String.equals()` comparison when searching by `publickey`. MetaChain stores publickeys starting with uppercase `0X...`, but Minima's internal maxcontacts list stores them lowercase `0x...`. This mismatch causes the remove to silently fail (returns `status: false`).

**NEVER use `publickey` to remove a maxcontact from the frontend.** Always use the numeric `id`:

```typescript
// WRONG — fails silently due to case-sensitivity
await MDS.cmd.maxcontacts({ action: 'remove', publickey: toPublicKey } as any);

// CORRECT — find id first, then remove by id
const listRes: any = await MDS.cmd.maxcontacts();
const contacts: any[] = listRes?.response?.contacts || [];
const toRemove = contacts.find((c: any) =>
    c.publickey?.toUpperCase() === toPublicKey.toUpperCase()
);
if (toRemove?.id !== undefined) {
    await MDS.cmd.maxcontacts({ action: 'remove', id: toRemove.id } as any);
}
```

This pattern is implemented in `removeMaximaContact` in `src/services/contact-requests.service.ts`.

### 29.2 `isMaximaContact` Source of Truth: DB, Not Live `maxcontacts` List

The contact-info page (`contact-info.$address.lazy.tsx`) determines `isMaximaContact` state. Two traps to avoid:

1. **Never set `setIsMaximaContact(true)` without also being able to set `false`**: The old code only set `true` inside an `if` block with no `else`, meaning once set, it could never revert during `checkStatus` re-runs.

2. **Never cross-check `isMaximaContact` against the live `MDS.cmd.maxcontacts()` list immediately after deletion**: The `maxcontacts action:remove` is processed asynchronously by Minima. If you await `fetchContact()` right after deletion, `MDS.cmd.maxcontacts()` will still return the contact (Minima hasn't processed the remove yet), causing `setIsMaximaContact(true)` to override the deletion.

**Rule**: Use `MAXIMA_CONTACT_REQUESTS` DB table as the **sole source of truth** for `isMaximaContact` in the UI. The DB deletion is synchronous (SQL); the Minima `maxcontacts` list is eventually consistent.

```typescript
// In checkStatus and fetchContact — always set both true AND false:
const dbRes = await runSQL(`SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE ... AND status='accepted' LIMIT 1`);
setIsMaximaContact(dbRes?.rows?.length > 0); // always set, never guard with if-only
```

### 29.3 `removeMaximaContact` Full Protocol Sequence

The full correct sequence for removing a Maxima contact (implemented in `contact-requests.service.ts`):

1. **Delete from `MAXIMA_CONTACT_REQUESTS`** (and `CONTACT_REQUESTS`) for both directions.
2. **Remove from Minima's internal maxcontacts** using id-based removal (see 29.1).
3. **Resolve peer address** from `DISCOVERED_PEERS` and **send `maxima_contact_removed` message** via Maxima so the peer also cleans up their state.
4. **Insert local system message** `'Contact removed'` with `state='read'` directly (no unread badge).
5. **Update `CHAT_STATUS.last_opened`** so unread count resets.
6. **Call `chatService.notifyChatListUpdate()`** to trigger UI refresh.

The SW handler `handleMaximaContactRemoved` in `contact.handler.js` mirrors steps 1, 4, and 5 on the recipient side.

## 30) Elite Input Hub Design Standard

### 30.1 Specification
All chat views (DMs, Groups, Channels) must share the same "Elite Input Hub" dimensions for visual parity and balance:
- **Total Height**: Standardized to **64px** (compact standard).
- **Input Wrapper**: Must have `min-h-[64px]` and `rounded-[2.5rem]`.
- **Send Button (Zap)**: Must have `w-[64px] h-[64px]` and `rounded-[2rem]`.
- **Parent Alignment**: The container holding both must use `flex items-end` to ensure they bottom-align when the input grows (multi-line).

### 30.2 Consistency Rule
Never use `68px`, `72px` or other ad-hoc sizes for the Zap button in chat views. If you modify a chat's footer, verify it matches the **64px** standard across all three view types.

### 30.3 File References
- DM Chat: `src/routes/chat/$address.tsx`
- Group Chat: `src/routes/groups.$groupId.lazy.tsx`
- Channel Chat: `src/routes/channels.$channelId.lazy.tsx`

## 31) Global Discovery Listings — H2 Boolean Query Regression (Critical)

### 31.1 Symptom
The "Global Discovery" switch appeared to do nothing and beacons were emitted with `listings: []`.

SW logs showed SQL errors:
- `Values of types "BOOLEAN" and "CHARACTER VARYING(1)" are not comparable`
- Failing queries were in `buildPublicListings` for both `GROUPS` and `CHANNELS`.

### 31.2 Root Cause
`public/service-workers/handlers/beacon.handler.js` (and compiled `public/service.js`) used mixed-type predicates:
- `is_public=TRUE OR is_public='1' OR is_public='true'`
- `archived ... OR archived='0' OR archived='false'`

On current H2 behavior, comparing BOOLEAN columns to string literals causes query failure, so listing extraction fails and beacon payloads carry no public listings.

### 31.3 Required Query Pattern
For BOOLEAN columns, use boolean-safe predicates only:
- `COALESCE(is_public, FALSE)=TRUE`
- `COALESCE(archived, FALSE)=FALSE`

Do not reintroduce string comparisons for boolean columns in SW SQL.

### 31.4 Additional FE Observability
`updateGroupPublic` / `updateChannelPublic` now log successful local state changes:
- `✅ [GROUP-MGMT] Updated group ... is_public ...`
- `✅ [CHANNEL] Updated channel ... is_public ...`

This helps separate "switch click works" from downstream beacon/discovery propagation issues.

## 32) Group Role Update Case-Sensitivity (Critical)

### 32.1 Symptom
In restricted groups, creators receive join requests, but promoted admins do not.
SW logs on affected admin nodes show:
- `My role in <groupId> is member`
- `Ignored. We are not an admin/creator ...`

### 32.2 Root Cause
`handleGroupRoleUpdate` in SW used case-sensitive `publickey='...'` matching for:
- sender authorization check
- target lookup
- target update

Because public keys can differ as `0x...` vs `0X...` between payloads and DB rows, role propagation may fail silently on some nodes, leaving members as `member` instead of `admin`.

### 32.3 Required Rule
All role-update SQL in SW must use case-insensitive matching:
- `UPPER(publickey)=UPPER('<pk>')`

Applied to:
- `public/service-workers/handlers/group.handler.js`
- `public/service.js` (compiled runtime copy)

### 32.4 Additional Guard: Creator Fallback Authorization
Some nodes may temporarily miss the creator row in `GROUP_MEMBERS` (stale/incomplete member replication). In that state, valid `group_role_update` messages from the creator can be rejected with:
- `Unauthorized role update. Sender not in group.`

`handleGroupRoleUpdate` must therefore allow sender authorization when either:
1. Sender role in `GROUP_MEMBERS` is `creator` or `admin`, OR
2. Sender pubkey matches `GROUPS.creator_publickey` for the same `group_id` (case-insensitive).

This preserves security while preventing false rejections that block admin promotion and downstream restricted-join propagation.

### 32.5 Rhino Parse Safety for SW Hotfixes
When patching SW JS manually, avoid trailing commas in function call argument lists (e.g. `MDS.log("x",)`), and verify SQL string concatenations close all parentheses/quotes (e.g. `UPPER(...)=UPPER('...')`).
Either issue can crash SW startup with Rhino errors like `missing ) after argument list`.

### 32.6 Callback-Balance Guard (Critical)
In `handleGroupRoleUpdate`, nested `MDS.sql(..., function(){...})` blocks must keep all callback closings balanced.
One missing `});` before `handleGroupJoinRequestEvent` causes Rhino startup crash reported near line `#3474` with:
- `EvaluatorException: missing ) after argument list`

When editing nested SW callbacks, always re-check closure count locally in both:
- `public/service-workers/handlers/group.handler.js`
- `public/service.js`

## 33) Group Info Permission Visibility

### 33.1 Settings Access Boundaries
In `src/routes/group-info.$groupId.lazy.tsx`, the `ACTION LEDGER` block (`Restriction List` + `Inbound Terminal`) must be visible only to group operators:
- `creator`
- `admin`

Regular members must not see these panels in the Settings tab.

## 34) Fast Role Reconciliation for Restricted Join Requests

### 34.1 Purpose
Quick mitigation for stale role replication: admin nodes that still show local role `member` were ignoring `group_join_request_propagated`.

### 34.2 Behavior
In SW `executeJoinRequestAuth` path:
- If local role is not `creator/admin` **and** message type is `group_join_request_propagated`,
- and sender matches `GROUPS.creator_publickey`,
- then SW reconciles local membership role to `admin` (`UPDATE`, fallback `INSERT`) and immediately re-runs join-request auth once.

Files:
- `public/service-workers/handlers/group.handler.js`
- `public/service.js`

### 34.3 Scope
This is an operational quick fix (not a full role-version protocol). It should be treated as interim hardening to keep restricted-join moderation functional under temporary role-state drift.

## 35) Channel Admin Authorization Hardening

### 35.1 `channel_role_update` Validation
SW `handleChannelRoleUpdate` must not trust case-sensitive sender matching.
Required checks:
- Sender role in `CHANNEL_SUBSCRIBERS` using case-insensitive pubkey (`UPPER(...)`), OR
- Sender equals `CHANNELS.admin_publickey` (case-insensitive fallback).

Updates to target subscriber role must also use case-insensitive pubkey matching.

### 35.2 `channel_join_request` Guard
SW `handleChannelJoinRequest` must authorize local processing before adding subscribers.
Only proceed if local node is:
- `admin` or `creator` in `CHANNEL_SUBSCRIBERS`, OR
- equals `CHANNELS.admin_publickey`.

If not authorized, request must be ignored (`CHANNEL` warning log) and no DB mutation should occur.

### 35.3 Files
- `public/service-workers/handlers/channel.handler.js`
- `public/service.js`
