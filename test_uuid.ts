import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

async function run() {
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    const walletSetId = (process.env.CIRCLE_WALLET_SET_ID || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    const client = new CircleClient(apiKey, entitySecret, walletSetId, apiUrl);
    try {
        console.log("Generating with UUID instead of nanoid...");
        const cipherText = await (client as any).getEntitySecretCiphertext();
        const res = await fetch(`${apiUrl}/developer/wallets`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                idempotencyKey: uuidv4(),
                entitySecretCiphertext: cipherText,
                blockchains: ["ETH-SEPOLIA"],
                count: 1,
                walletSetId: walletSetId
            })
        });
        const json = await res.json();
        console.log(JSON.stringify(json, null, 2));
    } catch (e: any) {
        console.error("HATA:", e.message);
    }
}

run();
