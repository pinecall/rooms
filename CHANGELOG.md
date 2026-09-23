# Changelog

All notable changes to `@pinecall/room`. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers and tags are the
maintainer's call.

## 0.1.0 — the room (unreleased)

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
