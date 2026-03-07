import { ethers } from "ethers";

const ROUTER_EVENTS_ABI = [
    "event PaymentMade(address indexed payer, address indexed to, uint256 amount, bytes32 proofHash, string memo)"
];

export interface RouterPaymentEvent {
    type: "Executed";
    sender: string;
    recipient: string;
    amount: bigint;
    timestamp: number;
    memo?: string;
    transactionHash: string;
}

export class RouterReader {
    private contract: ethers.Contract;
    private static readonly DEFAULT_BLOCK_TAG = "latest" as const;

    constructor(private provider: ethers.Provider, address: string) {
        this.contract = new ethers.Contract(address, ROUTER_EVENTS_ABI, provider);
    }

    async getRouterEvents(address: string, fromBlock: number = -9000, toBlock: number | "latest" = RouterReader.DEFAULT_BLOCK_TAG): Promise<RouterPaymentEvent[]> {
        const events: RouterPaymentEvent[] = [];

        try {
            const payerFilter = this.contract.filters.PaymentMade(address);
            const toFilter = this.contract.filters.PaymentMade(null, address);

            // Fetch both where the user is sender and where the user is recipient
            const [payerLogs, toLogs] = await Promise.all([
                this.contract.queryFilter(payerFilter, fromBlock, toBlock).catch(() => []),
                this.contract.queryFilter(toFilter, fromBlock, toBlock).catch(() => [])
            ]);

            // Combine and deduplicate by transaction hash and log index
            const allLogs = [...payerLogs, ...toLogs];
            const uniqueLogs = Array.from(new Map(allLogs.map(log => [`${log.transactionHash}-${log.index}`, log])).values());

            for (const log of uniqueLogs as ethers.EventLog[]) {
                try {
                    const parsed = this.contract.interface.parseLog({
                        topics: log.topics as string[],
                        data: log.data
                    });
                    if (!parsed) continue;

                    // Getting timestamp from block
                    const block = await log.getBlock();

                    events.push({
                        type: "Executed",
                        sender: parsed.args[0],
                        recipient: parsed.args[1],
                        amount: parsed.args[2],
                        timestamp: block ? block.timestamp * 1000 : Date.now(),
                        memo: parsed.args[4],
                        transactionHash: log.transactionHash
                    });
                } catch (e) {
                    // ignore parse errors for non-matching logs
                }
            }
        } catch (error) {
            console.error("[RouterReader] Error fetching events:", error);
        }

        return events.sort((a, b) => b.timestamp - a.timestamp);
    }

    async getRecentPayments(address: string): Promise<RouterPaymentEvent[]> {
        return await this.getRouterEvents(address);
    }

    async getPendingPayments(address: string): Promise<RouterPaymentEvent[]> {
        // The current ArcRouter executes immediately. There is no on-chain pending state.
        return [];
    }
}
