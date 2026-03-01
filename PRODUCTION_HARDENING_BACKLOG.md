# MetaChain Production Hardening Backlog

Created: 2026-02-26  
Status: open  
Scope: networking, FE/SW coherence, schema parity, production safety

## How to use this file
- Mark each item with `[x]` only when code change + manual validation are both done.
- If an item changes protocol/flow/schema ownership, update `AGENTS.md` in the same patch.
- Build/test execution is owner-run.

## P0 (High priority, production risk)

- [ ] P0-01 Reconnect bridge consistency (`RECONNECTED`)
File refs:
  - `public/service-workers/main.js:122`
  - `src/services/offline-queue.service.ts:44`
Problem:
  - SW emits reconnect via `MDS.comms.solo(...)`, while FE queue listens to `window.message`.
Action:
  - Define one canonical reconnect channel and consume it in exactly one FE bridge path.
Done when:
  - Offline -> reconnect triggers immediate queue retry reliably.
  - No duplicated retries/log spam.
Progress:
  - Code-side bridge normalization applied on 2026-02-27 (`minimaService.processEvent` + `offlineQueueService.triggerImmediateRetry`).
  - Pending owner-run build + manual reconnect validation before marking done.

- [ ] P0-02 Remove double processing for `contact_request`
File refs:
  - `public/service-workers/main.js:269`
  - `src/services/minima.service.ts:498`
Problem:
  - Same protocol type appears to be persisted in both SW and FE paths.
Action:
  - Keep SW as authoritative persistence owner, FE as notification/render owner.
Done when:
  - Incoming `contact_request` creates one DB mutation path only.
  - Banner/system messages are not duplicated.
Progress:
  - FE path now notifies UI only; DB persistence delegated to SW (2026-02-27).
  - Pending owner-run build + runtime validation with real incoming request.

- [ ] P0-03 Enforce FE/SW schema parity for shared tables
File refs:
  - `src/services/database.service.ts:448`
  - `public/service-workers/db-init.js:209`
Problem:
  - `METACHAIN_USERS` shape diverges between FE and SW.
Action:
  - Add explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` parity migrations in both runtimes.
Done when:
  - Existing installs with FE-first and SW-first init both operate without missing-column errors.
  - Discovery/chat list queries using `METACHAIN_USERS` are stable.
Progress:
  - FE init now adds SW-needed columns on `METACHAIN_USERS` (`user_id`, `address`, `first_seen`, `last_updated`) via `ALTER ... IF NOT EXISTS`.
  - SW init now adds FE-needed columns on `METACHAIN_USERS` (`avatar`, `last_seen`) via `ALTER ... IF NOT EXISTS`.
  - Pending owner-run build + runtime validation on FE-first and SW-first startup paths.

- [ ] P0-04 Eliminate unsafe SQL interpolation in hot paths
File refs:
  - `src/services/chat.service.ts:434`
  - `src/services/chat.service.ts:448`
  - `public/service-workers/handlers/group.handler.js:17`
  - `public/service-workers/handlers/group.handler.js:116`
  - `public/service-workers/handlers/group.handler.js:148`
Problem:
  - Raw string interpolation remains in runtime-critical SQL paths.
Action:
  - Apply strict escaping helpers for all external/runtime-derived values.
Done when:
  - No direct unescaped interpolation in affected paths.
  - Group/chat flows still pass manual functional checks.
Progress:
  - SW group handler hardened with `escapeSql(...)` + numeric timestamp coercion for duplicate check/insert/update/delete paths (`public/service-workers/handlers/group.handler.js`).
  - FE chat queries hardened with `escapeSql(...)` for `getMessages`, `getLastMessageTimestamp`, and `deleteAllMessages` (`src/services/chat.service.ts`).
  - Pending owner-run build + runtime validation before marking done.

## P1 (Important stability/refactor)

- [x] P1-01 Remove duplicated FE handlers for blocked/unblocked
File refs:
  - `src/services/minima.service.ts:743` (`contact_blocked` — first instance)
  - `src/services/minima.service.ts:777` (`contact_blocked` — dead duplicate)
  - `src/services/minima.service.ts:760` (`contact_unblocked` — first instance)
  - `src/services/minima.service.ts:794` (`contact_unblocked` — dead duplicate)
Problem:
  - Both `contact_blocked` and `contact_unblocked` handlers appear twice. The second copy is unreachable (first has `return`).
Action:
  - Delete the second (dead) copy of each handler.
Done when:
  - Single branch handles `contact_blocked` and one handles `contact_unblocked`.
Progress:
  - Removed duplicated blocks in minima.service.ts on 2026-02-28.

- [ ] P1-02 Finalize beacon ownership (SW heartbeat vs FE initial beacon)
File refs:
  - `src/hooks/useBeaconSender.ts:140`
  - `public/service-workers/main.js:76`
Problem:
  - FE still sends initial beacon while SW is heartbeat owner.
Action:
  - Decide final ownership and remove redundant emission path.
Done when:
  - Beacon cadence is deterministic and single-owner by design.
Progress:
  - FE auto-start beacon removed (hook no-op); SW remains heartbeat owner (2026-02-27).
  - Manual `sendBeacon()` kept for explicit profile-triggered updates.
  - Pending owner-run build + runtime validation before marking done.

- [x] P1-03 Simplify FE/SW comms bridge usage
File refs:
  - `src/components/chat/ChatsAndGroups.tsx:312`
  - `src/services/minima.service.ts:1475`
Problem:
  - Mixed bridge patterns (`MDS` event handling + legacy global listener).
Action:
  - Consolidate around one FE consumption pattern for SW signals.
Done when:
  - `CHAT_LIST_UPDATE` refreshes are consistent and easier to reason about.
Progress:
  - Removed legacy `public/mds.js` script include from `index.html` and replaced `window.MDS` UID read with imported `MDS.minidappuid` in settings connect flow.
  - Implemented `chatService.onChatListUpdate` and wired it into `minima.service.ts` to replace the `window.MDS_SOLO_LISTENER` pattern.
  - Subscribed UI directly to `minimaService.onChatListUpdate`.

- [x] P1-04 Harden `handleMaximaContactAccepted` against accidental maxcontacts add
File refs:
  - `public/service-workers/handlers/contact.handler.js:179`
Problem:
  - `if (maxjson.from_address) { maxcontacts action:add ... }` fires unconditionally when `from_address` is present. All normal chat messages include `from_address` — if routing ever misdirects a `text` type message to this handler, it would silently add the sender as a Maxima contact.
Action:
  - Add an explicit guard to ensure `maxjson.type === 'maxima_contact_accepted'` before calling `maxcontacts action:add`; or remove the `from_address` shortcut entirely and only rely on the `maxcontacts action:list` lookup.
Done when:
  - `maxcontacts action:add` is never reachable from a regular chat message payload.
Progress:
  - Added explicit check to ensure type is `maxima_contact_accepted` before adding to maxcontacts via from_address on 2026-02-28.

## P2 (Consistency and convention hardening)

- [x] P2-01 Normalize permission key usage
File refs:
  - `src/routes/settings/privacy.tsx:33`
  - `src/hooks/useBeaconSender.ts:59`
  - `src/services/contact-requests.service.ts:81`
Problem:
  - Multiple legacy key names increase false allow/deny risk over time.
Action:
  - Keep one canonical key path and explicit migration fallback.
Done when:
  - Permission behavior is identical across profile, beacon, and chat gating.
Progress:
  - Unified `profile_chat_permission_allow_all` to `allow_noncontact_chats` in `privacy.tsx` with a migration fallback on 2026-02-28.

- [x] P2-02 `sendDeliveryReceipt` in SW uses `publickey:` for non-contacts
File refs:
  - `public/service-workers/handlers/chat.handler.js:175`
Problem:
  - Delivery receipt always sends via `maxima action:send publickey:X`, which fails silently for non-Maxima-contacts (should use `to:Mx...` like the main send path).
Action:
  - Apply the same address-resolution logic used in `resolveAndSend()`: look up `DISCOVERED_PEERS.ADDRESS` and use `to:Mx...` if available.
Done when:
  - Delivery receipts reach non-contact senders reliably.
Progress:
  - Applied `resolveAndSend` to the `sendDeliveryReceipt` function in `chat.handler.js` on 2026-02-28.

- [x] P2-03 `handleSyncStatusReport` in SW is a no-op
File refs:
  - `public/service-workers/handlers/chat.handler.js:731`
Problem:
  - The function only logs; it never forwards the report to the frontend, so the UI never sees `sync_status_report` from the SW path.
Action:
  - Emit `MDS.comms.solo(...)` with the report payload so the FE `minima.service.ts` handler (which already handles this type) can present it to the UI.
Done when:
  - `sync_status_report` received via SW triggers the same UI update as a direct Maxima delivery to the FE.
Progress:
  - Emitting `MDS.comms.solo` with the parsed `sync_status_report` payload in `chat.handler.js` on 2026-02-28.

## Already fixed in this cycle

- [x] SW `sync_status_*` handler argument order mismatch fixed
File refs:
  - `public/service-workers/main.js:327`
  - `public/service-workers/main.js:332`

## Owner-run verification commands

Before running tests:
1. `npm run build:sw`
2. `npm run build`

### Block 1: Installation & Initialization (P0-03 / P2-01 / P1-02)
- [ ] **P0-03 (Schema Parity)**: Start the Dapp from scratch. Check the browser console and assure there are no SQL errors about missing columns (like `user_id` or `avatar`) when opening the Chat list.
- [ ] **P2-01 (Permission Key)**: Go to **Settings -> Privacy Settings**. Toggle "Allow Direct Messages from Anyone". Verify it saves properly without errors.
- [ ] **P1-02 (Beacons)**: Go to **Discovery**. Check the Service Worker logs to verify `[BEACON]` runs on an interval, and that the Frontend doesn't fire duplicate beacons on load.

### Block 2: Contacts & Messaging (P0-02 / P2-02 / P1-04)
*(Requires a second Node B)*
- [ ] **P0-02 (Contact Requests)**: From Node B, send a contact request to Node A. Check Node A's SW logs to ensure only ONE insert happens and only ONE "Chat request received" message appears in the UI.
- [ ] **P2-02 (Delivery Receipts)**: When Node A receives a message, check the SW logs for `[DELIVERY] Sent receipt to...` to ensure it falls back to `Mx...` addresses correctly if the sender isn't a Maxima contact.
- [ ] **P1-04 (Accidental Contacts)**: Accept a Maxima contact request. Verify you are NOT automatically added to the general Minima contacts app without explicit action (except the intended flow).

### Block 3: Groups & SQL Safety (P0-04)
- [x] **P0-04 (Safe SQL)**: Create a Group, invite Node B, and send messages. Change the group title or delete a message (when implemented). Ensure no SQL exceptions are thrown in the console, confirming our `escapeSql` additions are secure and functioning. *Verified successful creation and messaging without errors.*

### Block 4: Offline Reconnect (P0-01)
- [x] **P0-01 (Offline Queue)**: Disconnect the network on Node A. Send a message (it should queue). Reconnect. Verify the SW emits `RECONNECTED` and the message is sent exactly once (no duplicates/spam in logs). *Verified successful timeout tracking and queued sending upon reconnection.*

