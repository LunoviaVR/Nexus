import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Lock, Mail, User, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { applyLogin } from "@/lib/session";
import { Button, Input, Switch } from "@/components/ui";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { useAuth } from "@/stores/auth";
import { Img } from "@/components/ui";

const FEATURES = [
  ["Live friends", "See where everyone is, grouped by instance, the moment it changes."],
  ["Your history", "A searchable timeline of every world, player and video you've seen."],
  ["Insights", "Find out where your hours go and who you spend them with."],
];

export function Login() {
  const phase = useAuth((s) => s.phase);
  return (
    <div className="flex h-full">
      <div className="relative hidden w-[44%] overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,oklch(0.55_0.22_var(--accent-h))_0,transparent_55%),radial-gradient(circle_at_80%_80%,oklch(0.6_0.15_200)_0,transparent_50%)] opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="size-10" />
            <span className="text-xl font-bold">Nexus</span>
          </div>
          <div className="space-y-6">
            <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">Your VRChat social life, at a glance.</h1>
            <div className="space-y-4">
              {FEATURES.map(([t, d]) => (
                <div key={t} className="max-w-sm">
                  <div className="font-semibold">{t}</div>
                  <div className="text-sm text-white/75">{d}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/60">Not affiliated with VRChat Inc. Your credentials only go to VRChat.</p>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">{phase === "twoFactor" ? <TwoFactor /> : <Credentials />}</div>
      </div>
    </div>
  );
}

function Credentials() {
  const last = useAuth((s) => s.lastUsername);
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: ipc.accounts });
  const [username, setUsername] = useState(last ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (last) setUsername(last);
  }, [last]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("login");
    setError(null);
    try {
      applyLogin(await ipc.login(username.trim(), password, remember));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const quick = async (id: string, uname?: string | null) => {
    setBusy(id);
    setError(null);
    try {
      const r = await ipc.restore(id);
      if (r.kind === "loggedOut") {
        setUsername(r.username ?? uname ?? "");
        setError("That session has expired. Enter your password to continue.");
      } else applyLogin(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
      <p className="mt-1 text-[13px] text-muted">Sign in with your VRChat account.</p>

      {!!accounts.data?.length && (
        <div className="mt-6 space-y-1.5">
          {accounts.data.map((a) => (
            <div key={a.id} className="group flex items-center gap-1">
              <button
                onClick={() => quick(a.id, a.username)}
                disabled={!!busy}
                className="flex flex-1 items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-left hover:border-accent/50 hover:bg-panel-2 cursor-pointer"
              >
                <Img src={a.thumbnail} className="size-8 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{a.displayName}</div>
                  <div className="truncate text-xs text-subtle">{a.username}</div>
                </div>
                {busy === a.id && <span className="text-xs text-muted">Signing in…</span>}
              </button>
              <button
                aria-label={`Forget ${a.displayName}`}
                onClick={async () => {
                  await ipc.removeAccount(a.id);
                  qc.invalidateQueries({ queryKey: ["accounts"] });
                }}
                className="invisible inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-hover hover:text-fg group-hover:visible cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 py-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" /> or use another account <span className="h-px flex-1 bg-line" />
          </div>
        </div>
      )}

      <form onSubmit={submit} className={cn("space-y-3", !accounts.data?.length && "mt-6")}>
        <Input
          icon={<User className="size-4" />}
          placeholder="Username or email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
        <Input
          icon={<Lock className="size-4" />}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <label className="flex items-center justify-between py-1 text-[13px] text-muted">
          <span>
            Remember password
            <span className="block text-xs text-subtle">Stored in Windows Credential Manager</span>
          </span>
          <Switch checked={remember} onChange={setRemember} label="Remember password" />
        </label>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</p>}
        <Button variant="primary" type="submit" className="w-full" loading={busy === "login"} disabled={!username || !password}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

function TwoFactor() {
  const methods = useAuth((s) => s.methods);
  const loggedOut = useAuth((s) => s.loggedOut);
  const email = methods.includes("emailOtp") && !methods.includes("totp");
  const [method, setMethod] = useState(email ? "emailOtp" : "totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recovery = method === "otp";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      applyLogin(await ipc.verify(method, code));
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button onClick={() => loggedOut(null)} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg cursor-pointer">
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {email ? <Mail className="size-6" /> : <KeyRound className="size-6" />}
      </div>
      <h2 className="text-2xl font-bold tracking-tight">Two-factor authentication</h2>
      <p className="mt-1 text-[13px] text-muted">
        {email
          ? "We sent a code to your email address. Enter it below."
          : recovery
            ? "Enter one of your recovery codes."
            : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          value={code}
          onChange={(e) => {
            const v = recovery ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (!recovery && v.length === 6) setTimeout(() => (document.getElementById("tfa-submit") as HTMLButtonElement)?.click(), 0);
          }}
          inputMode={recovery ? "text" : "numeric"}
          autoFocus
          autoComplete="one-time-code"
          placeholder={recovery ? "xxxx-xxxx" : "000000"}
          className="h-14 w-full rounded-xl border border-line bg-panel-2 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</p>}
        <Button id="tfa-submit" variant="primary" type="submit" className="w-full" loading={busy} disabled={!code}>
          Verify
        </Button>
        {methods.includes("otp") && (
          <button
            type="button"
            onClick={() => {
              setMethod(recovery ? (email ? "emailOtp" : "totp") : "otp");
              setCode("");
            }}
            className="w-full text-center text-[13px] text-muted hover:text-fg cursor-pointer"
          >
            {recovery ? "Use authenticator code instead" : "Use a recovery code"}
          </button>
        )}
      </form>
    </div>
  );
}
