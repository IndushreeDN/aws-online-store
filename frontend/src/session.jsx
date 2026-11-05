// Makes "who is signed in?" available to every page (React context).

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { rawSession, subscribe, userFromRawSession } from "./auth.js";

const SessionContext = createContext({ user: null });

function subscribeAll(callback) {
  const unsubscribe = subscribe(callback);
  // Also react when the user signs in or out in another browser tab.
  window.addEventListener("storage", callback);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", callback);
  };
}

export function SessionProvider({ children }) {
  const raw = useSyncExternalStore(subscribeAll, rawSession, () => null);
  const value = useMemo(() => ({ user: userFromRawSession(raw) }), [raw]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
