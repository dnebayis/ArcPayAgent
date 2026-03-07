import dotenv from 'dotenv';
import { CircleClient } from './src/blockchain/circleClient';

dotenv.config();

async function run() {
    const apiKey = (process.env.CIRCLE_API_KEY || "").replace(/['"]+/g, '');
    const entitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").replace(/['"]+/g, '');
    const apiUrl = (process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s").replace(/['"]+/g, '');

    const client = new CircleClient(apiKey, entitySecret, "dummy", apiUrl);

    try {
        const cipherText = await (client as any).getEntitySecretCiphertext();
        console.log("\n=========================================================================================");
        console.log("KOPYALAMANIZ GEREKEN ENTITY SECRET CIPHERTEXT (ŞİFRELİ METİN) AŞAĞIDADIR:");
        console.log("=========================================================================================\n");
        console.log(cipherText);
        console.log("\n=========================================================================================");
    } catch (e: any) {
        console.error("HATA:", e.message);
    }
}

run();
