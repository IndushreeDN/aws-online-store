import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, currentUser, decodeToken, getIdToken, signIn, signOut, signUp } from "./auth.js";
import { installMockBackend, makeJwt } from "./mock-backend.js";

beforeEach(() => {
  installMockBackend({ users: { "a@example.com": { password: "Passw0rd", confirmed: true, code: "123456", groups: ["admins"] } } });
});

describe("auth", () => {
  it("signs in, remembers who you are, and knows admins", async () => {
    expect(currentUser()).toBeNull();
    await signIn("a@example.com", "Passw0rd");
    const user = currentUser();
    expect(user.email).toBe("a@example.com");
    expect(user.isAdmin).toBe(true);
    signOut();
    expect(currentUser()).toBeNull();
  });

  it("refuses a wrong password with a friendly message", async () => {
    await expect(signIn("a@example.com", "wrong")).rejects.toMatchObject({
      name: "AuthError",
      code: "NotAuthorizedException",
      message: "Incorrect email or password.",
    });
    expect(currentUser()).toBeNull();
  });

  it("explains a weak password and a duplicate account", async () => {
    await expect(signUp("new@example.com", "short")).rejects.toThrow(/at least 8 characters/);
    await expect(signUp("a@example.com", "Passw0rd")).rejects.toThrow(/already exists/);
  });

  it("reports a network failure clearly", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(signIn("a@example.com", "Passw0rd")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("renews an expired token with the refresh token", async () => {
    localStorage.setItem("eshop.session", JSON.stringify({ idToken: makeJwt({ sub: "x", email: "old@example.com" }), refreshToken: "refresh-ok", expiresAt: Date.now() - 1000 }));
    const token = await getIdToken();
    expect(decodeToken(token).email).toBe("refreshed@example.com");
    expect(currentUser().email).toBe("refreshed@example.com");
  });

  it("signs you out when the refresh token no longer works", async () => {
    localStorage.setItem("eshop.session", JSON.stringify({ idToken: makeJwt({ sub: "x" }), refreshToken: "revoked", expiresAt: Date.now() - 1000 }));
    expect(await getIdToken()).toBeNull();
    expect(currentUser()).toBeNull();
  });

  it("keeps you signed in if the refresh fails only because you are offline", async () => {
    localStorage.setItem("eshop.session", JSON.stringify({ idToken: makeJwt({ sub: "x", email: "keep@example.com" }), refreshToken: "refresh-ok", expiresAt: Date.now() - 1000 }));
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await getIdToken()).toBeNull();
    expect(currentUser()?.email).toBe("keep@example.com");
  });

  it("copes with garbage tokens and storage", () => {
    expect(decodeToken("not-a-token")).toBeNull();
    localStorage.setItem("eshop.session", "{broken");
    expect(currentUser()).toBeNull();
    expect(AuthError).toBeDefined();
  });
});
