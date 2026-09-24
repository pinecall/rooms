/** Follow a call's log over fetch: from where it was, through a dropped stream, to the score. */

import { TERMINAL_EVENT } from "@pinecall/protocol";

import { SseParser, type SseMessage } from "./sse.js";

/** What the page can honestly say about its stream. Nothing here is a guess. */
export type Connection = "connecting" | "live" | "reconnecting" | "ended";

/** Why a follow stopped by itself: the score arrived, the call was sealed, or the gateway said no. */
export type Ending = { kind: "scored" } | { kind: "sealed" } | { kind: "refused"; status: number };

/** What the room wants of its stream: every message in order, and how the connection is going. */
export interface LogReader {
  /** Every message, in seq order, the moment it is framed. The cursor has already moved past it. */
  onMessage: (message: SseMessage) => void;
  onConnection: (connection: Exclude<Connection, "ended">) => void;
  /** Called once, and nothing is said after it. Never called when the room stopped the follow. */
  onEnded: (ending: Ending) => void;
}

// A dropped stream is opened again after this, doubling to the ceiling: a gateway restarting is
// seconds, and a page hammering it every 100 ms would only make those seconds longer. A 5xx is the
// same thing seen from a proxy — the gateway behind it is restarting — and is asked again too.
const RECONNECT_MS = 500;
const RECONNECT_CEILING_MS = 8_000;

// The relay answers 204 to a sealed call whose cursor is at the end: nothing more will be said.
const NOTHING_MORE = 204;
// From here up the gateway, or the proxy in front of it, is away rather than saying no.
const AWAY = 500;

/** Open the log at `url`. Returns the call that stops it; stopping twice is stopping once. */
export function followLog(url: string, reader: LogReader, fetcher: typeof fetch): () => void {
  const controller = new AbortController();
  let lastId: string | null = null;
  let backoff = RECONNECT_MS;
  let ours = true;

  const stop = (): void => {
    ours = false;
    controller.abort();
  };

  const end = (ending: Ending): void => {
    stop();
    reader.onEnded(ending);
  };

  const again = async (): Promise<void> => {
    reader.onConnection("reconnecting");
    await slept(backoff, controller.signal);
    backoff = Math.min(backoff * 2, RECONNECT_CEILING_MS);
  };

  const read = async (body: ReadableStream<Uint8Array>): Promise<void> => {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const chunks = body.getReader();
    for (;;) {
      const { value, done } = await chunks.read();
      if (done) return;
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) {
        if (message.id !== null) lastId = message.id;
        reader.onMessage(message);
        if (!ours) return;
        if (message.event === TERMINAL_EVENT) return end({ kind: "scored" });
      }
    }
  };

  const connect = async (): Promise<void> => {
    while (ours) {
      let answer: Response;
      try {
        answer = await fetcher(url, {
          headers: { accept: "text/event-stream", ...(lastId === null ? {} : { "last-event-id": lastId }) },
          signal: controller.signal,
        });
      } catch {
        if (!ours) return;
        await again();
        continue;
      }
      if (!ours) return;
      if (answer.status === NOTHING_MORE) return end({ kind: "sealed" });
      if (answer.status >= AWAY) {
        await answer.body?.cancel().catch(() => undefined);
        await again();
        continue;
      }
      if (!answer.ok || answer.body === null) return end({ kind: "refused", status: answer.status });
      reader.onConnection("live");
      backoff = RECONNECT_MS;
      try {
        await read(answer.body);
      } catch {
        // The body broke mid-stream: the same as it ending early, below.
      }
      if (!ours) return;
      // The body ended without the score: the relay went away mid-call. Resume where we were.
      await again();
    }
  };

  reader.onConnection("connecting");
  void connect();
  return stop;
}

function slept(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((wake) => {
    const timer = setTimeout(wake, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        wake();
      },
      { once: true },
    );
  });
}
