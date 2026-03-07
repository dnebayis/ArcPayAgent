import { vi } from "vitest";

// Mock persistence so tests don't write to disk
vi.mock("../src/storage/persistence", () => ({
    loadStore: vi.fn(() => ({})),
    saveStore: vi.fn()
}));
