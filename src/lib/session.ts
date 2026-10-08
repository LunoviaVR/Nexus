import type { LoginResult } from "./types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";

export function applyLogin(r: LoginResult) {
  const auth = useAuth.getState();
  if (r.kind === "ok") auth.loggedIn(r.user);
  else if (r.kind === "twoFactor") auth.needTwoFactor(r.methods);
  else auth.loggedOut(r.username);
}

export function clearSession() {
  useFriends.getState().reset();
  useLive.getState().reset();
  useAuth.getState().loggedOut(null);
}
