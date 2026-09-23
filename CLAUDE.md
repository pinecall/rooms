# pinecall/client

`@pinecall/room`: the caller's side of a Pinecall call in a browser — one store joining the seat
(LiveKit) and the call's log (relayed by the tenant's server, folded by `@pinecall/protocol`), with
a React entry and a server entry. Reply to the human in Spanish; code, comments, commit messages and
this file in English. What it is and how a page uses it: [README.md](README.md), which is also its
docs page.

## Workflow

```bash
pnpm install          # the workspace, and the wire from ../protocol/typescript, linked
pnpm test             # the suite, from the sources: node, and happy-dom for test/seat and test/react
pnpm lint             # tsc over src and test
scripts/build         # what is published: src/ into dist/
scripts/check         # build → lint → test, in that order — what CI runs
scripts/the-version   # the version a tag must match; refuses a workspace:/file:/link: dependency
```

Nothing has to be built to lint or test: `package.json` exports point at `src/`, and
`publishConfig` swaps in `dist/` for `pnpm pack`. `npm pack` does not apply `publishConfig`:
package with pnpm.

## Structure

- `src/store.ts` the primitive: `{state, subscribe, close}`, a paint every 100 ms for the log
- `src/room.ts` one conversation: the phases, the verbs, the seat and the log joined
- `src/log/` the SSE parser, the follow (fetch, resume, backoff, the score), the fold
- `src/seat/` the LiveKit loader and its minimal type, the seat, the hidden audio sink.
  `seat/join.ts` is the only file naming LiveKit's events; `seat/livekit.ts` the only one naming
  the package
- `src/rows.ts` the log as one column of rows · `src/karaoke.ts` the reply being said, word by word
- `src/react/` the hooks · `src/server/` mint and dial
- `test/` one file per sentence it proves; `test/seat` and `test/react` mirror their `src/`
  directories and run on happy-dom. `the-tree`, `the-imports` and `index` are the repo's rules

## Rules the tests enforce

- No file over 400 lines, the pages at the root included. Every `.ts` opens with a line saying what
  it is. A directory of tests is named for the directory of `src/` it tests.
- The import table in `test/the-imports.test.ts` is the architecture: `log/` and `rows.ts` know
  only the wire; `server/` knows nothing of the rest; `react/` knows React and the surface.
- `test/index.test.ts` pins the three public surfaces by name.

## What a review comes back to

A change lands with the README section that describes it, and a line in `CHANGELOG.md`, in the same
commit. No casts, no module-level mutable state, one definition per thing. The page never holds a
key: anything that needs one is `src/server/`, and runs on the tenant's server.
