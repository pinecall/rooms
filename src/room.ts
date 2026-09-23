/** One conversation, as the page sees it: the phases, the verbs, and the seat and the log joined in one store. */
//
// Two things happen at once and they are not the same thing. LiveKit carries the audio and the
// typed lines — the room the visitor joins with a ticket the tenant's own server minted, so the
// org's key never reaches a browser. The call's LOG, relayed by that same server, carries what the
// agent is actually doing: the turns, every tool it called and what came back, its declared state.
// The log is folded by the protocol's own reducer, so what the page draws is what the console
// draws, from the same bytes. A phone call has no seat at all: the log is the whole of it.

import { initialState, type Entry, type State } from "@pinecall/protocol";

import { LogFold } from "./log/fold.js";
import { followLog, type Connection, type Ending } from "./log/follow.js";
import type { SseMessage } from "./log/sse.js";
import { joinSeat, type Seat, type Speaking } from "./seat/join.js";
import { loadLivekit, type LivekitModule } from "./seat/livekit.js";
import { hiddenSink } from "./seat/sink.js";
import type { Minted } from "./server/index.js";
import { cell, type Store } from "./store.js";

export type { Minted };

/** Where the conversation is. `ringing` is a phone call nobody has answered yet. */
export type Phase = "idle" | "opening" | "ringing" | "live" | "ended" | "failed";

/** Spoken, written, or on the visitor's own phone. The same agent every way. */
export type Mode = "talk" | "chat" | "phone";

/** Everything the page draws from. Every field is the truth at the moment it was published. */
export interface RoomState {
  phase: Phase;
  mode: Mode | null;
  call: string;
  /** The sentence to show when phase is "failed". */
  error: string;
  /** The call as the protocol folds it: turns, tools, the agent's state, the cost once it is known. */
  log: State;
  entries: Entry[];
  connection: Connection;
  /** True when the browser has not been told it may make a sound: ask for a click. */
  wantsSound: boolean;
  speaking: Speaking;
}

export interface RoomOptions {
  /** A ticket for a seat, from the tenant's own server. The page never holds a key. */
  tokens: (scope: "talk" | "chat") => Promise<Minted>;
  /** The URL the call's log is relayed at by the tenant's server. */
  log: (call: string, minted?: Minted) => string;
  /** Ask the tenant's server to have the agent call `to`. */
  callMe?: ((to: string) => Promise<{ call: string }>) | undefined;
  /** How long the log is read after the seat closes, waiting for the score. Default 20 000 ms. */
  linger?: number | undefined;
  fetch?: typeof fetch | undefined;
  livekit?: (() => Promise<LivekitModule>) | undefined;
  /** An entry of the log this copy of the wire could not read. The rest of the call still draws. */
  onSkipped?: ((why: string) => void) | undefined;
}

export interface RoomStore extends Store<RoomState> {
  start(mode: "talk" | "chat"): Promise<void>;
  send(text: string): Promise<void>;
  callMe(to: string): Promise<void>;
  leave(): Promise<void>;
  playSound(): void;
}

const LINGER_MS = 20_000;
// A seat asked to close is given this long. A network that has gone does not hold the page up.
const PARTING_MS = 3_000;
const QUIET: Speaking = { agent: false, user: false, level: 0 };
const NO_MICROPHONE = "I could not get to your microphone. Check the browser's permission, or write instead.";
const NO_CALL_ME = "room() was given no callMe: the call is placed by your server";

/** One conversation's resources. A new start is a new one; the old one is shut first. */
interface Conversation {
  mode: Mode;
  fold: LogFold;
  seat: Seat | null;
  stopFollow: (() => void) | null;
  linger: ReturnType<typeof setTimeout> | null;
}

/** A room for one visitor. Nothing opens until a verb is called. */
export function room(options: RoomOptions): RoomStore {
  const store = cell<RoomState>(idle());
  const { publish } = store;
  const parting = new Set<() => void>();
  let now: Conversation | null = null;
  let closed = false;

  const busy = (): boolean => ["opening", "ringing", "live"].includes(store.state.phase);
  const current = (c: Conversation): boolean => now === c;

  // The follow and the seat down, now. Returns the seat's leaving, for a caller that waits on it.
  const shut = (c: Conversation): Promise<void> => {
    c.stopFollow?.();
    c.stopFollow = null;
    if (c.linger !== null) clearTimeout(c.linger);
    c.linger = null;
    const seat = c.seat;
    c.seat = null;
    return seat === null ? Promise.resolve() : seat.leave().catch(() => undefined);
  };

  // A verb's first move, read from the store and never from a closure: a second click while the
  // first is still opening is nothing, and an old conversation is shut before a new one opens.
  const begin = (mode: Mode): Conversation | null => {
    if (closed || busy()) return null;
    if (now !== null) void shut(now);
    const fold = new LogFold((why) => options.onSkipped?.(why));
    const c: Conversation = { mode, fold, seat: null, stopFollow: null, linger: null };
    now = c;
    publish({ ...idle(), phase: "opening", mode, connection: "connecting" });
    return c;
  };

  const fail = (c: Conversation, error: string): void => {
    if (!current(c)) return;
    void shut(c);
    publish({ phase: "failed", error, connection: "ended", wantsSound: false, speaking: QUIET });
  };

  // The call is over for the visitor. The seat goes now; the log is read a while longer, because
  // the agent's last words, the cost and the score are entries that arrive after the room closed.
  const end = (c: Conversation): Promise<void> => {
    publish({ phase: "ended", wantsSound: false, speaking: QUIET });
    const seat = c.seat;
    c.seat = null;
    if (c.stopFollow !== null && c.linger === null) {
      c.linger = setTimeout(() => {
        c.linger = null;
        c.stopFollow?.();
        c.stopFollow = null;
        publish({ connection: "ended" });
      }, options.linger ?? LINGER_MS);
    }
    return seat === null ? Promise.resolve() : seat.leave().catch(() => undefined);
  };

  const heard = (c: Conversation, message: SseMessage): void => {
    if (c.fold.take(message) === null) return;
    store.paint(() => c.fold.snapshot());
    const { status, room: seats } = c.fold.now;
    const phase = store.state.phase;
    if (status === "ended" && (phase === "opening" || phase === "ringing" || phase === "live")) void end(c);
    // A phone call has no seat to say it was answered: the log does. A seat decides for itself.
    if (c.mode === "phone" && status === "active" && phase === "ringing") publish({ phase: "live" });
    if (c.mode === "phone" && store.state.phase === "live") {
      const speaking = (kinds: string[]): boolean =>
        seats?.participants.some((one) => kinds.includes(one.kind) && one.speaking) ?? false;
      say({ agent: speaking(["agent"]), user: speaking(["caller", "sip"]), level: 0 });
    }
  };

  const ended = (c: Conversation, ending: Ending): void => {
    c.stopFollow = null;
    if (c.linger !== null) clearTimeout(c.linger);
    c.linger = null;
    const phase = store.state.phase;
    const waiting = c.mode === "phone" && (phase === "ringing" || phase === "live");
    if (ending.kind === "refused" && waiting) {
      publish({ connection: "ended", phase: "failed", error: `the log answered ${ending.status}`, speaking: QUIET });
    } else if (ending.kind === "sealed" && c.mode === "phone" && phase === "ringing") {
      publish({ connection: "ended", phase: "ended" });
    } else {
      publish({ connection: "ended" });
    }
  };

  const follow = (c: Conversation, url: string): void => {
    c.stopFollow = followLog(
      url,
      {
        onMessage: (message) => {
          if (current(c)) heard(c, message);
        },
        onConnection: (connection) => {
          if (current(c)) publish({ connection });
        },
        onEnded: (ending) => {
          if (current(c)) ended(c, ending);
        },
      },
      options.fetch ?? fetch,
    );
  };

  const say = (speaking: Speaking): void => {
    const was = store.state.speaking;
    if (was.agent === speaking.agent && was.user === speaking.user && was.level === speaking.level) return;
    publish({ speaking });
  };

  const seated = async (c: Conversation, mode: "talk" | "chat", minted: Minted): Promise<void> => {
    let livekit: LivekitModule;
    try {
      livekit = await (options.livekit ?? loadLivekit)();
    } catch (refused) {
      return fail(c, messageOf(refused));
    }
    if (!current(c) || store.state.phase !== "opening") return;
    let seat: Seat;
    try {
      seat = await joinSeat({
        livekit,
        mode,
        server_url: minted.server_url,
        participant_token: minted.participant_token,
        sink: hiddenSink(),
        on: {
          disconnected: () => {
            if (!current(c)) return;
            c.seat = null;
            if (busy()) void end(c);
          },
          speaking: (speaking) => {
            if (current(c)) say(speaking);
          },
          wantsSound: (wantsSound) => {
            if (current(c)) publish({ wantsSound });
          },
        },
      });
    } catch (refused) {
      return fail(c, mode === "talk" ? NO_MICROPHONE : messageOf(refused));
    }
    // Left, closed or ended by the log while the room was joining: the seat is not wanted.
    if (!current(c) || store.state.phase !== "opening") {
      void seat.leave().catch(() => undefined);
      return;
    }
    c.seat = seat;
    publish({ phase: "live", wantsSound: !seat.canPlaybackAudio() });
  };

  return {
    get state() {
      return store.state;
    },
    subscribe: store.subscribe,

    async start(mode) {
      const c = begin(mode);
      if (c === null) return;
      let minted: Minted;
      try {
        minted = await options.tokens(mode);
      } catch (refused) {
        return fail(c, messageOf(refused));
      }
      if (!current(c) || store.state.phase !== "opening") return;
      publish({ call: minted.call });
      // The call id exists before the room is joined, so the log is followed from its first entry
      // rather than from wherever the room happened to open.
      follow(c, options.log(minted.call, minted));
      await seated(c, mode, minted);
    },

    async callMe(to) {
      const c = begin("phone");
      if (c === null) return;
      const dial = options.callMe;
      if (dial === undefined) return fail(c, NO_CALL_ME);
      let placed: { call: string };
      try {
        placed = await dial(to);
      } catch (refused) {
        return fail(c, messageOf(refused));
      }
      if (!current(c) || store.state.phase !== "opening") return;
      publish({ call: placed.call, phase: "ringing" });
      follow(c, options.log(placed.call));
    },

    async send(text) {
      if (text.trim() === "") return;
      const seat = now?.seat ?? null;
      if (store.state.phase !== "live" || seat === null) throw new Error("not in a call");
      await seat.send(text);
    },

    async leave() {
      const c = now;
      if (c === null || !busy()) return;
      const leaving = end(c);
      let wake = (): void => {};
      const waited = new Promise<void>((done) => {
        const timer = setTimeout(done, PARTING_MS);
        wake = () => {
          clearTimeout(timer);
          done();
        };
      });
      parting.add(wake);
      await Promise.race([leaving, waited]);
      wake();
      parting.delete(wake);
    },

    playSound() {
      now?.seat?.playSound();
      publish({ wantsSound: false });
    },

    close() {
      if (closed) return;
      closed = true;
      if (now !== null) void shut(now);
      now = null;
      for (const wake of parting) wake();
      parting.clear();
      store.close();
    },
  };
}

function idle(): RoomState {
  return {
    phase: "idle",
    mode: null,
    call: "",
    error: "",
    log: initialState(),
    entries: [],
    connection: "ended",
    wantsSound: false,
    speaking: QUIET,
  };
}

function messageOf(refused: unknown): string {
  return refused instanceof Error ? refused.message : String(refused);
}
