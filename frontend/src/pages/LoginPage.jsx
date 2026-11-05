import { useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  AuthError,
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  resendCode,
  signIn,
  signUp,
} from "../auth.js";
import { useSession } from "../session.jsx";
import Notice from "../components/Notice.jsx";

// Only allow going back to a page on THIS website (never to another site).
export function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function passwordProblem(password) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Password needs at least one small letter.";
  if (!/[A-Z]/.test(password)) return "Password needs at least one capital letter.";
  if (!/[0-9]/.test(password)) return "Password needs at least one number.";
  return "";
}

const TITLES = {
  signin: "Sign in",
  signup: "Create your account",
  confirm: "Confirm your email",
  forgot: "Reset your password",
  reset: "Choose a new password",
};

export default function LoginPage() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pendingPassword = useRef(""); // lets us sign in automatically right after confirming

  if (user) return <Navigate to={next} replace />;

  function go(newMode, text = "") {
    setMode(newMode);
    setError("");
    setMessage(text);
    setCode("");
  }

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      if (err instanceof AuthError && err.code === "UserNotConfirmedException") {
        resendCode(email).catch(() => {});
        go("confirm", `Your email is not confirmed yet. We sent a new code to ${email}.`);
      } else {
        setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const onSignIn = (e) => {
    e.preventDefault();
    run(async () => {
      await signIn(email, password); // the page redirects automatically once signed in
    });
  };

  const onSignUp = (e) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== password2) return setError("The two passwords do not match.");
    run(async () => {
      await signUp(email, password);
      pendingPassword.current = password;
      go("confirm", `We emailed a 6-digit code to ${email}. Enter it below.`);
    });
  };

  const onConfirm = (e) => {
    e.preventDefault();
    run(async () => {
      await confirmSignUp(email, code);
      if (pendingPassword.current) {
        const saved = pendingPassword.current;
        pendingPassword.current = "";
        await signIn(email, saved);
      } else {
        go("signin", "Email confirmed. Please sign in.");
      }
    });
  };

  const onResend = () =>
    run(async () => {
      await resendCode(email);
      setMessage(`We sent a new code to ${email}.`);
    });

  const onForgot = (e) => {
    e.preventDefault();
    run(async () => {
      await forgotPassword(email);
      go("reset", `If an account exists for ${email}, we emailed a code. Enter it with your new password.`);
    });
  };

  const onReset = (e) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    run(async () => {
      await confirmForgotPassword(email, code, password);
      setPassword("");
      go("signin", "Password changed. Please sign in with your new password.");
    });
  };

  const emailField = (
    <label>Email
      <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    </label>
  );
  const passwordField = (label, value, setter, autoComplete) => (
    <label>{label}
      <input type="password" required autoComplete={autoComplete} value={value} onChange={(e) => setter(e.target.value)} />
    </label>
  );
  const codeField = (
    <label>6-digit code
      <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
    </label>
  );

  return (
    <section className="narrow">
      <h1>{TITLES[mode]}</h1>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {mode === "signin" && (
        <form className="form" onSubmit={onSignIn}>
          {emailField}
          {passwordField("Password", password, setPassword, "current-password")}
          <button className="button wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="small">
            <button type="button" className="link-button" onClick={() => go("signup")}>Create an account</button>
            {" · "}
            <button type="button" className="link-button" onClick={() => go("forgot")}>Forgot password?</button>
          </p>
        </form>
      )}

      {mode === "signup" && (
        <form className="form" onSubmit={onSignUp}>
          {emailField}
          {passwordField("Password", password, setPassword, "new-password")}
          {passwordField("Repeat password", password2, setPassword2, "new-password")}
          <p className="muted small">At least 8 characters, with a capital letter, a small letter and a number.</p>
          <button className="button wide" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
          <p className="small">
            Already have an account?{" "}
            <button type="button" className="link-button" onClick={() => go("signin")}>Sign in</button>
          </p>
        </form>
      )}

      {mode === "confirm" && (
        <form className="form" onSubmit={onConfirm}>
          {emailField}
          {codeField}
          <button className="button wide" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
          <p className="small">
            No email? Check your spam folder, or{" "}
            <button type="button" className="link-button" onClick={onResend} disabled={busy || !email}>send the code again</button>.
          </p>
        </form>
      )}

      {mode === "forgot" && (
        <form className="form" onSubmit={onForgot}>
          {emailField}
          <button className="button wide" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
          <p className="small"><button type="button" className="link-button" onClick={() => go("signin")}>Back to sign in</button></p>
        </form>
      )}

      {mode === "reset" && (
        <form className="form" onSubmit={onReset}>
          {emailField}
          {codeField}
          {passwordField("New password", password, setPassword, "new-password")}
          <button className="button wide" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
        </form>
      )}
    </section>
  );
}
