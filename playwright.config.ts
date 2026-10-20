// UI smoke test (e2e/): the production build in the installed Chrome (channel "chrome"; GitHub's Ubuntu runners have it),
// so no browser download. Run: npm run build && npx playwright test
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  retries: 0, // a flaky test fails, never passes on a retry unnoticed
  use: { baseURL: "http://localhost:4173", channel: "chrome", viewport: { width: 1400, height: 850 } },
  webServer: { command: "npm run preview -- --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
