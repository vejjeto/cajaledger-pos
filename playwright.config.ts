import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3009",
    headless: true,
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3009/api/health",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
