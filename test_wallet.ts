import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';

dotenv.config();

async function run() {
    console.log("Starting wallet test...");
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    const walletSetId = (process.env.CIRCLE_WALLET_SET_ID || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    const client = new CircleClient(apiKey, entitySecret, walletSetId, apiUrl);
    try {
        console.log("Creating wallet...");
        const wallet = await client.createWallet();
        console.log("Wallet created!", wallet);
    } catch (e: any) {
        console.error("HATA:", e.message);
    }
}

run();
