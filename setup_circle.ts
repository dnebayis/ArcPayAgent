import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

dotenv.config();

async function setup() {
    console.log("Setting up Circle API...");
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    let walletSetId = (process.env.CIRCLE_WALLET_SET_ID || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    if (!apiKey || !entitySecret) {
        console.error("❌ Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env !");
        process.exit(1);
    }

    // We pass a dummy walletSetId just to instantiate the client and get the ciphertext
    const client = new CircleClient(apiKey, entitySecret, walletSetId || "dummy", apiUrl);

    let cipherText = "";
    try {
        console.log("Generating Entity Secret Ciphertext...");
        cipherText = await (client as any).getEntitySecretCiphertext();
        console.log("✅ Successfully generated ciphertext!");
    } catch (e: any) {
        console.error("❌ Authentication Failed: " + (e.message || JSON.stringify(e)));
        process.exit(1);
    }

    if (!walletSetId || walletSetId === "BURAYA_WALLET_SET_ID_GELECEK") {
        console.log("Creating a new Wallet Set...");
        try {
            const req = await fetch(`${apiUrl}/developer/walletSets`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    idempotencyKey: uuidv4(),
                    entitySecretCiphertext: cipherText,
                    name: "ArcPay System Wallets"
                })
            });

            const json = await req.json();
            if (req.ok) {
                walletSetId = json.data.walletSet.id;
                console.log(`✅ Successfully created new Wallet Set ID: ${walletSetId}`);

                // Update .env file
                let envFile = fs.readFileSync(".env", "utf-8");
                envFile = envFile.replace(/CIRCLE_WALLET_SET_ID=.*$/m, `CIRCLE_WALLET_SET_ID="${walletSetId}"`);
                if (!envFile.includes("CIRCLE_WALLET_SET_ID")) {
                    envFile += `\nCIRCLE_WALLET_SET_ID="${walletSetId}"`;
                }
                fs.writeFileSync(".env", envFile);
                console.log("✅ Updated .env file with the new CIRCLE_WALLET_SET_ID!");
            } else {
                console.error("⚠️ Failed to create Wallet Set:", json.message || JSON.stringify(json));
                process.exit(1);
            }
        } catch (e: any) {
            console.error("❌ Network Error creating Wallet Set:", e.message);
            process.exit(1);
        }
    } else {
        console.log(`✅ CIRCLE_WALLET_SET_ID is already set: ${walletSetId}`);
    }

    console.log("🎉 Setup complete. You can now use ArcPay Agent with Circle.");
}

setup();
