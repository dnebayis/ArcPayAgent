import { describe, expect, it, vi } from "vitest";
import { InternalToolset } from "../../src/agent/internalTools";

describe("InternalToolset", () => {
    it("should provide an account snapshot for planner-side informational questions", async () => {
        const toolset = new InternalToolset({
            walletStore: {
                getWalletAddress: vi.fn().mockReturnValue("0xwallet")
            } as any,
            vendorStore: {
                resolveVendor: vi.fn().mockReturnValue(null),
                getVendorsWithStats: vi.fn().mockReturnValue({
                    aws: {},
                    jack: {}
                })
            } as any,
            analyticsEngine: {
                getTotalSpending: vi.fn().mockReturnValue(14),
                getSpendingByVendor: vi.fn().mockReturnValue([{ vendor: "AWS", total: 10 }])
            } as any,
            paymentLogs: {
                getRecentPayments: vi.fn().mockReturnValue([
                    {
                        vendor: "aws",
                        address: "0xabc",
                        amount: 4,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x1"
                    }
                ]),
                getPayments: vi.fn().mockReturnValue([{}, {}])
            } as any,
            scheduleStore: {
                getSchedules: vi.fn().mockReturnValue([{ id: "sched-1" }])
            } as any,
            invoiceEngine: {} as any,
            usdc: {
                balanceOf: vi.fn().mockResolvedValue(7_000_000n)
            } as any
        });

        const result = await toolset.execute(1, "account_snapshot");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("Account snapshot");
        expect(result.summary).toContain("7.0");
        expect(result.references?.lastFocus).toBe("account_summary");
    });

    it("should provide a recent payee summary with reusable references", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {
                resolveVendor: vi.fn().mockReturnValue(null)
            } as any,
            analyticsEngine: {} as any,
            paymentLogs: {
                getRecentPayments: vi.fn().mockReturnValue([
                    {
                        vendor: "jack",
                        address: "0xabc",
                        amount: 1,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x1"
                    }
                ])
            } as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "recent_payee");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("jack");
        expect(result.references).toEqual(expect.objectContaining({
            vendor: "jack",
            address: "0xabc",
            amount: "1",
            lastFocus: "recent_payee"
        }));
    });

    it("should surface pending payment status from session state", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {} as any,
            analyticsEngine: {} as any,
            paymentLogs: {} as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any,
            pendingPaymentStore: {
                getPendingPayment: vi.fn().mockReturnValue({
                    vendorName: "aws",
                    amountStr: "5",
                    beneficiary: "0xabc",
                    amount: "5000000",
                    memo: null
                })
            } as any
        });

        const result = await toolset.execute(1, "pending_payment_status");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("5 USDC");
        expect(result.references?.vendor).toBe("aws");
    });

    it("should summarize active schedules with next-schedule references", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {} as any,
            analyticsEngine: {} as any,
            paymentLogs: {} as any,
            scheduleStore: {
                getSchedules: vi.fn().mockReturnValue([
                    {
                        id: "sched-2",
                        vendor: "aws",
                        address: "0xabc",
                        amount: 2,
                        nextExecution: Date.now() + 10_000
                    },
                    {
                        id: "sched-1",
                        vendor: "jack",
                        address: "0xdef",
                        amount: 1,
                        nextExecution: Date.now() + 5_000
                    }
                ])
            } as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "schedule_summary");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("2 active schedules");
        expect(result.references).toEqual(expect.objectContaining({
            vendor: "jack",
            address: "0xdef",
            scheduleId: "sched-1",
            amount: "1",
            lastFocus: "schedule_summary"
        }));
    });

    it("should stop requiring invoice override after payment review is already open", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {} as any,
            analyticsEngine: {} as any,
            paymentLogs: {} as any,
            scheduleStore: {} as any,
            invoiceEngine: {
                getActiveSession: vi.fn().mockReturnValue({
                    id: "inv-session-1",
                    status: "awaiting_payment_confirmation",
                    invoice: {
                        vendor: "Anthropic, PBC",
                        amount: "10",
                        settlementAmount: "10",
                        settlementCurrency: "USDC",
                        detectedAmount: "10",
                        detectedCurrency: "USD",
                        invoiceNumber: "INV-42"
                    },
                    risk: {
                        level: "REVIEW",
                        riskScore: 0.4,
                        flags: ["duplicate_invoice"],
                        explanations: ["duplicate invoice number"],
                        canPreparePayment: false,
                        requiresOverride: true,
                        blocked: false
                    },
                    rawRisk: {
                        level: "REVIEW",
                        riskScore: 0.4,
                        flags: ["duplicate_invoice"]
                    },
                    resolution: {
                        displayVendor: "Anthropic, PBC",
                        matchedVendorName: "Anthropic, PBC",
                        resolvedBeneficiary: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328",
                        canPreparePayment: true,
                        requiresOverride: false
                    }
                })
            } as any,
            conversationMemory: {
                getContext: vi.fn().mockReturnValue({ lastInvoice: null })
            } as any,
            usdc: {} as any
        });

        const context = await toolset.execute(1, "invoice_context");
        const risk = await toolset.execute(1, "invoice_risk");

        expect(context.status).toBe("success");
        expect(context.data?.requiresOverride).toBe(false);
        expect(context.data?.readyToPrepare).toBe(true);
        expect(risk.status).toBe("success");
        expect(risk.data?.requiresOverride).toBe(false);
        expect(risk.data?.readyToPrepare).toBe(true);
    });

    it("should prefer a saved vendor name over a raw address in recent payments", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {
                getVendorDisplayNameByAddress: vi.fn().mockReturnValue("AWS"),
                getVendorNameByAddress: vi.fn().mockReturnValue("aws")
            } as any,
            analyticsEngine: {} as any,
            paymentLogs: {
                getRecentPayments: vi.fn().mockReturnValue([
                    {
                        vendor: null,
                        address: "0x00000000000000000000000000000000000000ab",
                        amount: 1,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x1"
                    }
                ])
            } as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "recent_payments", { limit: 5 });
        expect(result.status).toBe("success");
        expect(result.references?.vendor).toBe("AWS");
        expect(result.summary).toContain("1 USDC to AWS");
    });

    it("should prefer a saved vendor name over a raw address in spending summaries", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {
                getVendorDisplayNameByAddress: vi.fn().mockReturnValue("Anthropic, PBC"),
                getVendorNameByAddress: vi.fn().mockReturnValue("anthropic pbc"),
                resolveVendor: vi.fn().mockReturnValue(null)
            } as any,
            analyticsEngine: {
                getTotalSpending: vi.fn().mockReturnValue(13)
            } as any,
            paymentLogs: {
                getPayments: vi.fn().mockReturnValue([
                    {
                        vendor: null,
                        address: "0x1d0d4da384f58612970100f4f3f22d4134369ca7",
                        amount: 10,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x1"
                    },
                    {
                        vendor: null,
                        address: "0x1d0d4da384f58612970100f4f3f22d4134369ca7",
                        amount: 3,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x2"
                    }
                ])
            } as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "spending_summary", { period: "all", topOnly: true });
        expect(result.status).toBe("success");
        expect(result.summary).toContain("Anthropic, PBC");
        expect(result.references?.vendor).toBe("Anthropic, PBC");
        expect(result.references?.address).toBe("0x1d0d4da384f58612970100f4f3f22d4134369ca7");
        expect(result.data?.topVendor).toEqual(
            expect.objectContaining({
                label: "Anthropic, PBC",
                vendor: "Anthropic, PBC",
                total: 13,
                count: 2
            })
        );
    });

    it("should summarize how spending changed versus the previous period", async () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);

        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {
                resolveVendor: vi.fn().mockReturnValue(null),
                getVendorDisplayNameByAddress: vi.fn().mockImplementation((_chatId: number, address: string) => address === "0xaaa" ? "AWS" : "Stripe"),
                getVendorNameByAddress: vi.fn().mockImplementation((_chatId: number, address: string) => address === "0xaaa" ? "aws" : "stripe")
            } as any,
            analyticsEngine: {} as any,
            paymentLogs: {
                getPayments: vi.fn().mockReturnValue([
                    {
                        vendor: null,
                        address: "0xaaa",
                        amount: 10,
                        timestamp: now - 2 * 24 * 60 * 60 * 1000,
                        memo: "",
                        txHash: "0x1"
                    },
                    {
                        vendor: null,
                        address: "0xbbb",
                        amount: 4,
                        timestamp: now - 33 * 24 * 60 * 60 * 1000,
                        memo: "",
                        txHash: "0x2"
                    }
                ])
            } as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "spending_change_summary", { period: "month" });

        expect(result.status).toBe("success");
        expect(result.summary).toContain("Spending is up by 6");
        expect(result.summary).toContain("AWS");
        expect(result.data).toEqual(expect.objectContaining({
            period: "month",
            currentTotal: 10,
            previousTotal: 4,
            delta: 6,
            direction: "up"
        }));

        vi.restoreAllMocks();
    });

    it("should produce an invoice payment checklist with balance readiness", async () => {
        const toolset = new InternalToolset({
            walletStore: {
                getWalletAddress: vi.fn().mockReturnValue("0xwallet")
            } as any,
            vendorStore: {} as any,
            analyticsEngine: {} as any,
            paymentLogs: {} as any,
            scheduleStore: {} as any,
            invoiceEngine: {
                getActiveSession: vi.fn().mockReturnValue({
                    id: "inv-session-1",
                    status: "ready",
                    invoice: {
                        vendor: "Anthropic, PBC",
                        amount: "10",
                        settlementAmount: "10",
                        settlementCurrency: "USDC",
                        invoiceNumber: "INV-42"
                    },
                    risk: {
                        level: "SAFE",
                        riskScore: 0.1,
                        flags: [],
                        explanations: [],
                        blocked: false
                    },
                    resolution: {
                        matchedVendorName: "Anthropic, PBC",
                        resolvedBeneficiary: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328",
                        canPreparePayment: true
                    }
                })
            } as any,
            usdc: {
                balanceOf: vi.fn().mockResolvedValue(15_000_000n)
            } as any
        });

        const result = await toolset.execute(1, "invoice_payment_checklist");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("Before paying this invoice");
        expect(result.summary).toContain("ready to prepare");
        expect(result.data).toEqual(expect.objectContaining({
            vendor: "Anthropic, PBC",
            amount: "10",
            currency: "USDC",
            readyToPrepare: true,
            enoughBalance: true
        }));
        expect(result.references).toEqual(expect.objectContaining({
            vendor: "Anthropic, PBC",
            invoiceNumber: "INV-42"
        }));
    });

    it("should report agent registration status through the internal toolset", async () => {
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {} as any,
            analyticsEngine: {} as any,
            paymentLogs: {} as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any,
            agentIdentityEngine: {
                getStatus: vi.fn().mockReturnValue({
                    configured: true,
                    registered: true,
                    agentId: "42"
                }),
                getStatusSummary: vi.fn().mockResolvedValue("Arc Pay Agent is registered on Arc. Agent ID: 42.")
            } as any
        });

        const result = await toolset.execute(1, "agent_registration_status");
        expect(result.status).toBe("success");
        expect(result.summary).toContain("Agent ID: 42");
    });

    it("should summarize the agent's operating model and current account posture", async () => {
        const toolset = new InternalToolset({
            walletStore: {
                getWalletAddress: vi.fn().mockReturnValue("0xwallet")
            } as any,
            vendorStore: {
                getVendors: vi.fn().mockReturnValue({
                    aws: "0x1",
                    jack: "0x2"
                })
            } as any,
            analyticsEngine: {} as any,
            paymentLogs: {
                getPayments: vi.fn().mockReturnValue([
                    { vendor: "aws", address: "0x1", amount: 1, timestamp: 1, memo: "", txHash: "0x1" },
                    { vendor: "jack", address: "0x2", amount: 2, timestamp: 2, memo: "", txHash: "0x2" }
                ])
            } as any,
            scheduleStore: {
                getSchedules: vi.fn().mockReturnValue([
                    { id: "sched-1", vendor: "aws" }
                ])
            } as any,
            invoiceEngine: {
                getActiveSession: vi.fn().mockReturnValue({
                    status: "review_required",
                    invoice: {
                        vendor: "Anthropic, PBC"
                    }
                })
            } as any,
            usdc: {} as any,
            agentIdentityEngine: {
                getStatus: vi.fn().mockReturnValue({
                    configured: true,
                    registered: true,
                    agentId: "42"
                })
            } as any
        });

        const result = await toolset.execute(1, "agent_operations_overview");

        expect(result.status).toBe("success");
        expect(result.summary).toContain("LLM-orchestrated runtime");
        expect(result.summary).toContain("Circle developer-controlled wallets");
        expect(result.summary).toContain("wallet configured");
        expect(result.summary).toContain("2 saved vendors");
        expect(result.summary).toContain("1 active schedules");
        expect(result.summary).toContain("2 recorded payments");
        expect(result.summary).toContain("active invoice review_required");
        expect(result.data).toEqual(expect.objectContaining({
            runtimeModel: "llm_orchestrated",
            paymentConfirmationRequired: true,
            walletConfigured: true,
            savedVendorCount: 2,
            activeScheduleCount: 1,
            paymentHistoryCount: 2,
            activeInvoiceStatus: "review_required",
            agentIdentityRegistered: true,
            agentId: "42"
        }));
    });

    it("should not merge different vendor aliases into one top-payee bucket just because they share an address", async () => {
        const sharedAddress = "0x1d0d4da384f58612970100f4f3f22d4134369ca7";
        const toolset = new InternalToolset({
            walletStore: {} as any,
            vendorStore: {
                resolveVendor: vi.fn((_chatId: number, vendor: string) => ({
                    found: true,
                    data: { name: vendor, displayName: vendor, address: sharedAddress }
                })),
                getVendorDisplayName: vi.fn((_chatId: number, vendor: string) => vendor),
                getVendorDisplayNameByAddress: vi.fn().mockReturnValue("aws"),
                getVendorNameByAddress: vi.fn().mockReturnValue("aws")
            } as any,
            analyticsEngine: {
                getTotalSpending: vi.fn().mockReturnValue(171)
            } as any,
            paymentLogs: {
                getPaymentsSince: vi.fn().mockReturnValue([
                    {
                        vendor: "Anthropic, PBC",
                        address: sharedAddress,
                        amount: 170,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x1"
                    },
                    {
                        vendor: "aws",
                        address: sharedAddress,
                        amount: 1,
                        timestamp: Date.now(),
                        memo: "",
                        txHash: "0x2"
                    }
                ])
            } as any,
            scheduleStore: {} as any,
            invoiceEngine: {} as any,
            usdc: {} as any
        });

        const result = await toolset.execute(1, "spending_summary", { period: "month", topOnly: true });

        expect(result.status).toBe("success");
        expect(result.data?.topVendor).toEqual(expect.objectContaining({
            label: "Anthropic, PBC",
            vendor: "Anthropic, PBC",
            total: 170,
            count: 1
        }));
    });
});
