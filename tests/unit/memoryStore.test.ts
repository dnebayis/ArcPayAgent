import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryStore } from '../../src/ai/memoryStore';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('path');

describe('MemoryStore', () => {
    let memoryStore: MemoryStore;
    const testPath = '/path/to/mock/memory.json';
    const chatId = 123456;

    beforeEach(() => {
        vi.resetAllMocks();

        // Mock path.join to return our test path
        (path.join as any) = vi.fn().mockReturnValue(testPath);
        (path.dirname as any) = vi.fn().mockReturnValue('/path/to/mock');

        // Mock fs behavior for loading
        (fs.existsSync as any) = vi.fn().mockImplementation((path: string) => {
            return false; // Start with empty file
        });

        (fs.readFileSync as any) = vi.fn().mockReturnValue('{}');

        (fs.mkdirSync as any) = vi.fn();
        (fs.writeFileSync as any) = vi.fn();

        memoryStore = new MemoryStore(testPath);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with empty memory if file does not exist', () => {
        expect(memoryStore.getMemorySummary(chatId)).toBe('');
        // No memory exists for the chatId yet
    });

    it('should record vendor added', () => {
        memoryStore.recordVendorAdded(chatId, 'Jack');

        const summary = memoryStore.getMemorySummary(chatId);
        expect(summary).toContain('- Top Vendors: jack');

        // Ensure data is saved
        expect(fs.writeFileSync).toHaveBeenCalled();
        const writeCall = (fs.writeFileSync as any).mock.calls[0];
        expect(writeCall[0]).toBe(testPath);
        expect(writeCall[1]).toContain('"jack": 1');
    });

    it('should record successful payments and store them', () => {
        memoryStore.recordPayment(chatId, 'Jack', 10.5);
        memoryStore.recordPayment(chatId, 'Alice', 20);
        memoryStore.recordPayment(chatId, 'Jack', 5);

        const summary = memoryStore.getMemorySummary(chatId);

        expect(summary).toContain('- Top Vendors: jack, alice');
        expect(summary).toContain('- Average Payment: 11.83 USDC');
        expect(summary).toContain('- Recent Payments: 10.5 USDC to jack, 20 USDC to alice, 5 USDC to jack');
    });

    it('should keep only the last 10 payments', () => {
        for (let i = 1; i <= 15; i++) {
            memoryStore.recordPayment(chatId, 'Vendor' + i, 10);
        }

        const summary = memoryStore.getMemorySummary(chatId);
        // Average should be 10 always
        expect(summary).toContain('- Average Payment: 10.00 USDC');
    });

    it('should record invoices parsed', () => {
        memoryStore.recordInvoice(chatId, 'AWS', 35);
        memoryStore.recordInvoice(chatId, 'Azure', 45);

        const summary = memoryStore.getMemorySummary(chatId);
        expect(summary).toContain('- Recent Invoices: 35 USDC from aws, 45 USDC from azure');
    });

    it('should get recent invoice by vendor', () => {
        memoryStore.recordInvoice(chatId, 'AWS', 30); // older
        // Mock time progression
        const originalNow = Date.now;
        Date.now = vi.fn(() => originalNow() + 1000);

        memoryStore.recordInvoice(chatId, 'AWS', 50); // newer

        const invoice = memoryStore.getRecentInvoiceByVendor(chatId, 'AWS');
        expect(invoice).not.toBeNull();
        expect(invoice?.amount).toBe(50);
        expect(invoice?.vendor).toBe('aws');

        Date.now = originalNow;
    });

    it('should return null for unknown vendor search in invoices', () => {
        const invoice = memoryStore.getRecentInvoiceByVendor(chatId, 'Unknown');
        expect(invoice).toBeNull();
    });

    it('should sort top vendors by frequency', () => {
        memoryStore.recordPayment(chatId, 'Alice', 10);

        memoryStore.recordPayment(chatId, 'Jack', 10);
        memoryStore.recordPayment(chatId, 'Jack', 10);

        memoryStore.recordPayment(chatId, 'Bob', 10);
        memoryStore.recordPayment(chatId, 'Bob', 10);
        memoryStore.recordPayment(chatId, 'Bob', 10);

        const summary = memoryStore.getMemorySummary(chatId);
        // Bob (3), Jack (2), Alice (1)
        expect(summary).toContain('- Top Vendors: bob, jack, alice');
    });
});
