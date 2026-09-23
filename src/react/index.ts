/** @pinecall/room/react: a store read the way React reads one, and one room per mounted component. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { room, type RoomOptions, type RoomState, type RoomStore, type Store } from "../index.js";

/** The store's state, re-rendering when it changes. Any store of this package. */
export function useStore<T>(store: Store<T>): T {
  const subscribe = useCallback((changed: () => void) => store.subscribe(changed), [store]);
  const read = (): T => store.state;
  return useSyncExternalStore(subscribe, read, read);
}

/** What `useRoom` hands a component: the state, and the verbs to change it. */
export type RoomHandle = RoomState & Pick<RoomStore, "start" | "send" | "callMe" | "leave" | "playSound">;

/**
 * One room for as long as the component is mounted, closed when it unmounts. The options are read
 * when they are used, never when the room was made: a `tokens` written inline, new every render,
 * is the one that runs.
 */
export function useRoom(options: RoomOptions): RoomHandle {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [store, setStore] = useState(() => room(readingLatest(latest)));
  const open = useRef(true);
  useEffect(() => {
    // StrictMode unmounts and mounts again with the same state: the room the first mount closed
    // is replaced once, rather than handed back closed.
    if (!open.current) {
      open.current = true;
      setStore(room(readingLatest(latest)));
      return;
    }
    return () => {
      open.current = false;
      store.close();
    };
  }, [store]);
  const state = useStore(store);
  const { start, send, callMe, leave, playSound } = store;
  return { ...state, start, send, callMe, leave, playSound };
}

/** Options whose every field is the one the component rendered last. */
function readingLatest(latest: { readonly current: RoomOptions }): RoomOptions {
  return {
    get tokens() {
      return latest.current.tokens;
    },
    get log() {
      return latest.current.log;
    },
    get callMe() {
      return latest.current.callMe;
    },
    get linger() {
      return latest.current.linger;
    },
    get fetch() {
      return latest.current.fetch;
    },
    get livekit() {
      return latest.current.livekit;
    },
    get onSkipped() {
      return latest.current.onSkipped;
    },
  };
}
