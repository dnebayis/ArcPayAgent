import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';
import fs from 'fs';

dotenv.config();

async function run() {
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    const recoveryFile = fs.readFileSync('/Users/mehmet/Downloads/recovery_file_2026-02-25.dat', 'utf8').trim();

    console.log("Recovery File Loaded.");

    const newSecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    const client = new CircleClient(apiKey, newSecret, "dummy", apiUrl);
    let newCiphertext = "";
    try {
        newCiphertext = await (client as any).getEntitySecretCiphertext();
        console.log("Newly generated ciphertext is ready to be sent to Circle API.");
    } catch (e: any) {
        console.error("HATA:", e.message);
        return;
    }

    try {
        console.log("Attempting automatic reset by sending the Recovery File + New Ciphertext to Circle API...");
        const res = await fetch(`${apiUrl}/config/entity/secret`, {
            method: 'PUT',
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "entitySecretCiphertext": newCiphertext,
                "recoveryFile": recoveryFile
            })
        });
        const respJson = await res.json();
        if (res.ok) {
            console.log("SUCCESS! API accepted the reset!");
        } else {
            console.error("ERROR from API:", respJson);
        }
    } catch (e: any) {
        console.error("Fetch Error:", e);
    }
}
run();
