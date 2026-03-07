import { describe, expect, it } from "vitest";
import { resolveHealthResponse } from "../../src/http";

describe("health server", () => {
    it("responds with ok on /health", async () => {
        const response = resolveHealthResponse("/health");
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe("ok");
    });
});
