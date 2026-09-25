# Changelog

All notable changes to `@pinecall/room`. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers and tags are the
maintainer's call.

## Unreleased

## 0.1.3 — the visitor calls, and the page follows

### Added
- **The visitor calls the agent, and the page follows that call.** `expect(key, {url, agent,
  ttl_s?, log?})` in `@pinecall/room/server` asks `POST /v1/codes` for a four-digit code, the
  agent's number and a token that reads that code. `room({expect})` and `byPhone()` show them
  (`phase: "expecting"`, `state.code: {code, number, expiresAt}`), ask the gateway until a call
  claims the code, and follow the claimed call live from its log. An expired code fails with
  "the code expired: ask for another"; a `5xx` is asked again; `leave()` stops the asking.
  `useRoom` hands back `byPhone`.
- Needs a gateway that answers `/v1/codes` and `@pinecall/protocol` 0.6.9.

## 0.1.2 — the log without a relay

### Added
- **The page reads its call straight from the gateway.** `mint()` and `dial()` answer a
  `log_token` — one call's log, state and recording, for four hours, opening nothing else — and
  take `log: "public" | "tenant"`, the projection it reads through. `room()` follows
  `GET /v1/calls/{call}/events` with it (`gateway`, `https://box.pinecall.io` unless said), and
  `state.recording` is where the recording plays from. Your server keeps no list of the calls it
  opened, so restarting it touches no call.

### Changed
- **A `5xx` is asked again, not the end.** A proxy answering 502 while the gateway behind it
  restarts was read as a refusal and the page stopped following the call — every deploy froze
  the transcript while the call went on. A `5xx` now backs off and resumes from the last entry
  read, like a dropped stream; a `4xx` still ends it.
- **`log` is optional**: the relay is for a page that must not reach the gateway itself.
- Needs a gateway that answers `log_token` (the runtime of 2026-09-24) and `@pinecall/protocol` 0.6.6.

## 0.1.1 — karaoke

### Added
- **What is being said right now.** `useKaraoke(state.entries)` in `@pinecall/room/react` splits
  the agent's reply in progress into what has sounded and what is still to come, by the second each
  word is spoken at; `sayingOf`, `soundedBy`, `litAt` and `joined` do the same without React. The
  visitor's words as they are heard were already `state.log.live.user`; the README now says so.

## 0.1.0 — the room (2026-09-23)

### Added
- **`room(options)`**: one store for one conversation — talk, chat, or "call me" — with the seat
  and the call's log joined. The log is followed from its first entry, before the seat is joined;
  a dropped stream resumes from the last entry read; the log is read after the seat closes until
  the score, or `linger`.
- **`@pinecall/room/react`**: `useRoom` (one room per mount, the latest options, closed on
  unmount, StrictMode included) and `useStore`.
- **`@pinecall/room/server`**: `mint`, `dial` and `GatewayRefused`, for the tenant's server.
- **`rowsOf`, `knownBy`, `brief`**, moved from bc-v3; a tool row carries `raw`, its arguments and
  output as they are.

### Fixed, against the hook this replaces
- A room that closes from the other side ends the call and no longer leaves the log open forever.
- A mint that fails no longer leaves an earlier call's log open.
- `start` reads the phase the store has now, not the one it closed over.
