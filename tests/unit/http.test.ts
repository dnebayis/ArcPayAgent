import { describe, expect, it } from "vitest";
import { isRecoverableHealthServerError, resolveHealthResponse } from "../../src/http";

describe("health server", () => {
    it("responds with ok on /health", async () => {
        const response = resolveHealthResponse("/health");
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe("ok");
    });

    it("treats EADDRINUSE as recoverable when the health server is optional", () => {
        expect(isRecoverableHealthServerError({ code: "EADDRINUSE" }, { required: false })).toBe(true);
    });

    it("does not treat EADDRINUSE as recoverable when the health server is required", () => {
        expect(isRecoverableHealthServerError({ code: "EADDRINUSE" }, { required: true })).toBe(false);
    });

    it("does not treat unrelated startup errors as recoverable", () => {
        expect(isRecoverableHealthServerError({ code: "EACCES" }, { required: false })).toBe(false);
    });
});
