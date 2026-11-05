// One place that talks to our backend API (API Gateway + Lambda).

import { config, isConfigured } from "./config.js";
import { getIdToken, signOut } from "./auth.js";

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// auth: true  -> sends the signed-in user's ID token (needed for cart checkout, orders, admin)
export async function api(path, { method = "GET", body, auth = false } = {}) {
  if (!isConfigured()) {
    throw new ApiError(
      0,
      "This website is not connected to AWS yet. In your project folder run: npm run configure",
      "NOT_CONFIGURED",
    );
  }

  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, "Please sign in first.", "UNAUTHENTICATED");
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Could not reach the store. Check your internet connection and try again.", "NETWORK");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth) {
      signOut(); // the token is no longer accepted
      throw new ApiError(401, "Your session has ended. Please sign in again.", "UNAUTHENTICATED");
    }
    throw new ApiError(
      response.status,
      data.error || data.message || `Something went wrong (${response.status}).`,
      data.code,
    );
  }
  return data;
}
