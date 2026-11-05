// Login for the website, using Amazon Cognito.
//
// Beginner note: Cognito is AWS's "who is this person?" service. It stores the accounts,
// checks passwords and emails the confirmation code. We talk to it with plain web requests.
// When login succeeds Cognito gives us three "tokens" (long coded strings). The ID token is
// like a signed ID card: we send it to our API with every request that needs a signed-in user,
// and API Gateway checks the signature before our code runs.

import { config } from "./config.js";

const STORAGE_KEY = "eshop.session";

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

// ---------- Talking to Cognito ----------

function friendlyMessage(code, original) {
  switch (code) {
    case "UsernameExistsException":
      return "An account with this email already exists. Try signing in instead.";
    case "InvalidPasswordException":
      return "Password must be at least 8 characters and include a capital letter, a small letter and a number.";
    case "CodeMismatchException":
      return "That code is not correct. Please check it and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Please request a new one.";
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "Please confirm your email first. We sent you a code.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "InvalidParameterException":
      return original || "Please check the details you entered.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function cognito(action, payload) {
  let response;
  try {
    response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AuthError("NETWORK", "Could not reach the login service. Check your internet connection.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(data.__type ?? "").split("#").pop() || "Unknown";
    throw new AuthError(code, friendlyMessage(code, data.message));
  }
  return data;
}

// ---------- Sign up, confirm, sign in ----------

export async function signUp(email, password) {
  await cognito("SignUp", {
    ClientId: config.clientId,
    Username: email.trim(),
    Password: password,
    UserAttributes: [{ Name: "email", Value: email.trim() }],
  });
}

export async function confirmSignUp(email, code) {
  await cognito("ConfirmSignUp", {
    ClientId: config.clientId,
    Username: email.trim(),
    ConfirmationCode: code.trim(),
  });
}

export async function resendCode(email) {
  await cognito("ResendConfirmationCode", { ClientId: config.clientId, Username: email.trim() });
}

export async function signIn(email, password) {
  const data = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.clientId,
    AuthParameters: { USERNAME: email.trim(), PASSWORD: password },
  });
  const result = data.AuthenticationResult;
  if (!result?.IdToken) {
    throw new AuthError("Unknown", "Sign in did not finish. Please try again.");
  }
  saveSession({
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  });
}

export async function forgotPassword(email) {
  await cognito("ForgotPassword", { ClientId: config.clientId, Username: email.trim() });
}

export async function confirmForgotPassword(email, code, newPassword) {
  await cognito("ConfirmForgotPassword", {
    ClientId: config.clientId,
    Username: email.trim(),
    ConfirmationCode: code.trim(),
    Password: newPassword,
  });
}

export function signOut() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be blocked; nothing to clear */
  }
  notify();
}

// ---------- Session (kept in the browser so a refresh does not sign you out) ----------

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session?.idToken ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage blocked: the user simply stays signed in until the page closes */
  }
  notify();
}

// Reads the facts written inside the ID token (email, groups). The signature is NOT checked
// here: the browser only uses this to decide what to show. The real check is done by the API.
export function decodeToken(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const text = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The raw saved text. React watches this value to know when someone signs in or out.
export function rawSession() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function userFromRawSession(raw) {
  if (!raw) return null;
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }
  const claims = session?.idToken ? decodeToken(session.idToken) : null;
  if (!claims) return null;
  const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [];
  return { email: claims.email, userId: claims.sub, groups, isAdmin: groups.includes("admins") };
}

export function currentUser() {
  return userFromRawSession(rawSession());
}

let refreshing = null;

// Returns a valid ID token, quietly renewing it if it is about to expire.
export async function getIdToken() {
  const session = loadSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.idToken;

  if (!session.refreshToken) {
    signOut();
    return null;
  }
  refreshing ??= cognito("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: config.clientId,
    AuthParameters: { REFRESH_TOKEN: session.refreshToken },
  })
    .then((data) => {
      const result = data.AuthenticationResult;
      saveSession({
        idToken: result.IdToken,
        refreshToken: session.refreshToken, // Cognito does not send a new one
        expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
      });
      return result.IdToken;
    })
    .catch((err) => {
      if (err.code !== "NETWORK") signOut(); // the refresh token itself is no longer valid
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// ---------- Letting React know when the session changes ----------

const listeners = new Set();
function notify() {
  for (const fn of listeners) fn();
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
