# @pinecall/room

The caller's side of a Pinecall call, in a browser. A visitor talks to your agent, writes to it, or
asks it to ring their phone; the page draws what is happening from the call's own log. No
framework, no key in the page.

## One store, three imports

Everything is one store: a value you read, a function you subscribe with, and a handful of verbs
that change it. The package has three entry points, and each one is for a different place.

| import | where it runs | what it gives you |
|---|---|---|
| `@pinecall/room` | the page | `room()`, the store of one conversation, and `rowsOf`, `knownBy`, `brief` to draw it |
| `@pinecall/room/react` | the page, in React | `useRoom()` and `useStore()` |
| `@pinecall/room/server` | your server | `mint()`, `dial()` and `GatewayRefused`: the only code that touches the key |

A conversation has two parts, and they are not the same thing. **The seat** is a LiveKit room: it
carries the audio and the typed lines. **The log** is the call's record on the gateway, relayed by
your server: every turn, every tool the agent called and what came back, the agent's own state, and
at the end the cost and the score. The store joins the two. What the page draws is the log folded
by `@pinecall/protocol`, the same fold the Pinecall console draws from.

## Install

```bash
pnpm add @pinecall/room livekit-client
```

`livekit-client` is only loaded when a seat is taken, so a page that only offers "call me" never
downloads it. React is optional: `@pinecall/room/react` needs React 18 or 19, the rest needs
nothing. The server entry needs Node 24 or anything else with `fetch`.

## From a page

```ts
import { room, rowsOf } from "@pinecall/room";

const call = room({
  tokens: async (scope) => {
    const answer = await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const body = await answer.json();
    if (!answer.ok) throw new Error(body.detail ?? `the server answered ${answer.status}`);
    return body;
  },
  log: (call) => `/api/log?call=${encodeURIComponent(call)}`,
});

call.subscribe((state) => {
  status.textContent = state.phase === "failed" ? state.error : state.phase;
  lines.replaceChildren(
    ...rowsOf(state.log).map((row) => {
      const line = document.createElement("p");
      line.textContent = row.kind === "turn" ? `${row.role}: ${row.text}` : `${row.name}(${row.args})`;
      return line;
    }),
  );
});

talkButton.onclick = () => call.start("talk");
chatButton.onclick = () => call.start("chat");
form.onsubmit = (event) => {
  event.preventDefault();
  void call.send(input.value);
  input.value = "";
};
hangUp.onclick = () => call.leave();
```

`start` is safe to call from a button that gets clicked twice: while a conversation is opening or
live, it does nothing. Once one has ended or failed, it opens a new one. When the page goes away,
`call.close()` takes everything down at once.

## With React

```tsx
import { useRoom } from "@pinecall/room/react";
import { rowsOf } from "@pinecall/room";

// `tokens` is the function from the page above.
export function Visitor() {
  const call = useRoom({ tokens, log: (id) => `/api/log?call=${encodeURIComponent(id)}` });

  if (call.phase === "idle") return <button onClick={() => call.start("talk")}>Talk</button>;
  if (call.phase === "failed") return <p>{call.error}</p>;
  return (
    <>
      {call.wantsSound && <button onClick={call.playSound}>Turn the sound on</button>}
      {rowsOf(call.log).map((row) => (
        <p key={row.key}>{row.kind === "turn" ? row.text : row.name}</p>
      ))}
      {call.phase === "live" && <button onClick={() => call.leave()}>Hang up</button>}
    </>
  );
}
```

`useRoom` makes one room per mounted component and closes it when the component unmounts. The
options are read when they are used, not when the room is made, so a `tokens` written inline — a
new function every render — is fine: the one from the last render is the one that runs. It hands
back the state with the five verbs beside it.

`useStore(store)` is the plain version: any store of this package, read with React's
`useSyncExternalStore`. `useRoom` is `useStore` over a room it owns.

## Your server: the three routes

The page never holds a key. Every question it asks goes to your own server, which asks the
gateway with the org's key and hands back only what that one visitor needs. The key needs two
scopes: `talk` (a ticket, a dial) and `calls` (reading a call's log). It never reaches the page.

| route | the page sends | your server does | it answers |
|---|---|---|---|
| `POST /api/token` | `{scope}`, `talk` or `chat` | `mint(key, {url, agent, scope})` | `{server_url, participant_token, call}` |
| `GET /api/log?call=` | the call id, and `last-event-id` on a resume | streams `GET /v1/calls/{call}/events` with the key | the gateway's stream, its status passed through: `204` when the call is sealed |
| `POST /api/call-me` | `{to}`, a number in E.164 | `dial(key, {url, agent, to})` | `{call}` |

The names of the routes are yours; the page only knows the functions you give `room()`. With
Hono:

```ts
import { Hono } from "hono";
import { dial, GatewayRefused, mint } from "@pinecall/room/server";

const KEY = process.env.PINECALL_KEY!;
const url = "https://box.pinecall.io";
const agent = "clinica-norte";
const app = new Hono();

// A refusal keeps the gateway's own sentence and status: it names the fix.
const refused = (error: unknown) => {
  if (error instanceof GatewayRefused) return Response.json({ detail: error.message }, { status: error.status });
  throw error;
};

app.post("/api/token", async (c) => {
  const { scope } = await c.req.json();
  return mint(KEY, { url, agent, scope }).then((minted) => c.json(minted), refused);
});

app.post("/api/call-me", async (c) => {
  const { to } = await c.req.json();
  return dial(KEY, { url, agent, to }).then(({ call }) => c.json({ call }), refused);
});

app.get("/api/log", async (c) => {
  const call = c.req.query("call") ?? "";
  if (!mine(c, call)) return c.body(null, 404);
  const resume = c.req.header("last-event-id");
  const answer = await fetch(`${url}/v1/calls/${encodeURIComponent(call)}/events`, {
    headers: { authorization: `Bearer ${KEY}`, accept: "text/event-stream", ...(resume ? { "last-event-id": resume } : {}) },
    signal: c.req.raw.signal,
  });
  return new Response(answer.body, { status: answer.status, headers: { "content-type": "text/event-stream" } });
});
```

The relay is four lines that matter: the call, the resume cursor, the key on the header, and the
gateway's status and body passed through as they came. It forwards `last-event-id`, so a page
whose stream dropped picks up where it was; and it passes a `204` through, so a sealed call is
known to be over rather than retried.

`mine(c, call)` is yours to write, and it is not optional: a relay that streams any call id it is
handed is a window onto every call of the org. Keep the call ids a visitor's session minted or
dialled, and relay only those.

## Have the agent call me

Give `room()` a `callMe`, and the page can ask for a phone call instead of a seat:

```ts
const call = room({
  tokens,
  log: (id) => `/api/log?call=${encodeURIComponent(id)}`,
  callMe: async (to) => {
    const answer = await fetch("/api/call-me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const body = await answer.json();
    if (!answer.ok) throw new Error(body.detail ?? `the server answered ${answer.status}`);
    return body;
  },
});

await call.callMe("+34600000001");
```

There is no seat on a phone call: the conversation happens on the phone, and the page only
watches. Everything it says comes from the log. The phase is `ringing` while the call is being
placed, `live` once the log says it was answered, and `ended` when the log says it is over — or
straight from `ringing` when nobody picked up. `speaking` comes from the log too.

The gateway refuses a dial to a number that has never called or written to the org, and counts
dials per minute and per day. Those refusals reach the page as a failed call with the gateway's
sentence.

## What `state` says

Every field is the truth at the moment it was published. A new state is a new object; one you were
handed is never changed afterwards, so it can be compared by reference and kept.

| field | what it is |
|---|---|
| `phase` | `idle` · `opening` (minting, joining) · `ringing` (a phone call not yet answered) · `live` · `ended` · `failed` |
| `mode` | `talk`, `chat`, `phone`, or `null` before anything started |
| `call` | the call id, once the tokens or the dial answered it; `""` before |
| `error` | the sentence to show when `phase` is `failed`; `""` otherwise |
| `log` | the call as `@pinecall/protocol` folds it: `turns`, `tools`, `app_state`, `status`, `live` (the words being said right now), `cost` |
| `entries` | every entry of the log read so far, in order |
| `connection` | the log's stream: `connecting` · `live` · `reconnecting` · `ended` (also before anything opened) |
| `wantsSound` | `true` when the browser has not let the page play sound yet: show a button that calls `playSound()` |
| `speaking` | `{agent, user, level}`: who is making a sound right now, and how loud the agent is, 0 to 1 |

The phase and everything around it — `error`, `connection`, `wantsSound`, `speaking` — are
published the moment they change. The log is painted at most ten times a second: a burst of
entries inside one turn is one repaint, not forty.

The log is read for a while after the seat closes. The agent's last words, the call's cost and its
score are entries that arrive after the visitor has gone, so `cost` is `null` until `call.summary`,
which comes after `call.ended`. The stream is followed until `call.score`, the last thing a log ever
says, or for `linger` milliseconds after the call ended (20 000 by default), whichever is first.

A stream that drops is opened again from the last entry read, after half a second, doubling to
eight seconds while the relay does not answer.

## Drawing the conversation

```ts
import { brief, knownBy, rowsOf } from "@pinecall/room";
```

`rowsOf(state.log)` is the conversation as one column, in the order things happened: every turn,
and every tool run above the reply it was called for. A turn row has `role`, `text`, and for the
agent `ms` (how long the reply took, end to end), `ttft` (the model's time to its first token —
what a written call has, since nobody spoke) and `interrupted`. A tool row has `name`, `args` and `output`
as one short line each, `status` (`running`, `done`, `failed`) and `error` — and `raw`, the
`arguments` and `output` as they are, for a page that draws more than one line.

`knownBy(state.log)` is the agent's own declared fields, in the order its class writes them, as
`[name, value]` pairs with the empty ones left out. `brief(value, max)` is a value as one line of
JSON, cut at `max` characters.

## Sound and the browser's permission

In `talk`, the microphone is turned on once the room is joined, and the agent's voice plays through
a hidden audio element at the end of the page. `chat` joins the same room — the typed lines ride it
on LiveKit's `lk.chat` topic — and never asks for the microphone and never plays a sound.

A browser plays sound only after the visitor has done something on the page. When it has not let
the page yet, `wantsSound` is `true`: show a button, and call `playSound()` from its click. It is
asked for once, not on every event the browser fires about it, and after the click it is `false`
until the browser changes its mind.

The microphone is the browser's to give. When the visitor says no, or the device is missing, the
call fails with a sentence meant for them (below), and the page can offer to write instead.

## When something is refused

Nothing fails silently. Every refusal is a phase and a sentence, or a rejected promise.

| what happened | the state |
|---|---|
| `tokens` threw (your server, or the gateway behind it, said no) | `failed`, `error` is its message; nothing was opened |
| the microphone was refused in `talk` | `failed`, `error` is "I could not get to your microphone. Check the browser's permission, or write instead." |
| the room could not be joined in `chat` | `failed`, `error` is LiveKit's message |
| `livekit-client` could not be loaded | `failed`, `error` is the loader's message |
| `callMe` threw | `failed`, `error` is its message |
| `callMe()` on a room given no `callMe` | `failed`, `error` says so |
| the log relay answered something other than 2xx or 204 | on the phone: `failed`, "the log answered 401". In a room: `connection` is `ended` and the phase is left to the seat, which is the call |
| the room closed from the other side | `ended`; the log is read on until the score |
| an entry of the log this version cannot read | skipped; `onSkipped(why)` is called, and the rest of the call still draws |
| `send()` outside a live seat | the promise rejects with "not in a call"; an empty line is nothing |

On the server, `mint` and `dial` throw `GatewayRefused` for a refusal: `status` is the gateway's,
and `detail` its sentence when it sent one (`null` when the body was not the gateway's JSON). The
sentence names the fix — a quota, a scope the key does not hold, a number the org cannot call —
so pass it on rather than rewording it.
