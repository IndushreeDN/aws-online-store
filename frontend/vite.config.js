import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite builds the website. Settings that start with VITE_ come from the file frontend/.env
// (written for you by "npm run configure").
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.js"],
    env: {
      VITE_API_URL: "https://api.test.example.com",
      VITE_COGNITO_REGION: "ap-south-1",
      VITE_COGNITO_CLIENT_ID: "testclientid",
      VITE_STORE_NAME: "Test Store",
    },
  },
});
