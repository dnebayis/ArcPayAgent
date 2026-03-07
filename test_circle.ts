import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';

dotenv.config();

async function test() {
    console.log("Testing Circle API Configuration...");
    // Make sure we strip any quotes from the .env reading
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    const walletSetId = (process.env.CIRCLE_WALLET_SET_ID || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    console.log(`API Key set: ${!!apiKey}`);
    console.log(`Entity Secret set: ${!!entitySecret}`);
    console.log(`Wallet Set ID set: ${!!walletSetId}`);

    if (!apiKey || !entitySecret) {
        console.error("❌ Missing primary credentials.");
        process.exit(1);
    }

    const client = new CircleClient(apiKey, entitySecret, walletSetId, apiUrl);

    try {
        console.log("Attempting to get public key ciphertext...");
        // Hacky way to access private method for testing just the encryption/auth
        const result = await (client as any).getEntitySecretCiphertext();
        console.log("✅ Successfully authenticated and generated ciphertext.");
    } catch (e: any) {
        console.error("❌ Authentication Failed: " + (e.message || JSON.stringify(e)));
        process.exit(1);
    }

    if (walletSetId) {
        try {
            console.log(`Attempting to verify wallet set ID: ${walletSetId}...`);
            const req = await fetch(`${apiUrl}/developer/walletSets/${walletSetId}`, {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            });

            const json = await req.json();
            if (req.ok) {
                console.log(`✅ Wallet Set ID is valid. (Name: ${json.data?.walletSet?.name || "Unknown"})`);
            } else {
                console.error("⚠️ Wallet Set ID verification returned an error:", json.message || JSON.stringify(json));
            }
        } catch (e: any) {
            console.error("❌ Failed to verify Wallet Set ID:", e.message);
        }
    }
}

test();
