import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: [
            "tests/**/*.test.ts"
        ],
        setupFiles: [
            "tests/setup.ts"
        ],
        coverage: {
            provider: "v8",
            include: [
                "src/engines/**",
                "src/ai/**",
                "src/agent/**",
                "src/storage/**",
                "src/security/**",
                "src/blockchain/**"
            ],
            reporter: ["text", "text-summary"],
        }
    }
});
