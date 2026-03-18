import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/chrome-mock.ts"],
    include: ["src/__tests__/**/*.test.ts"],
  },
  define: {
    "import.meta.env.DEV": "true",
  },
});
