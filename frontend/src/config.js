// Settings the website needs to talk to AWS.
// They come from frontend/.env, which "npm run configure" writes for you.
// They are read when needed (not once at start) so tests can change them.

export const config = {
  get apiUrl() {
    return (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  },
  get region() {
    return import.meta.env.VITE_COGNITO_REGION || "";
  },
  get clientId() {
    return import.meta.env.VITE_COGNITO_CLIENT_ID || "";
  },
  get storeName() {
    return import.meta.env.VITE_STORE_NAME || "My Online Store";
  },
};

export function isConfigured() {
  return Boolean(config.apiUrl && config.region && config.clientId);
}
