import { createServer, Server } from "http";
import type TelegramBot from "node-telegram-bot-api";
import { getReadinessState, isAppReady } from "./appStatus";

export interface HealthResponse {
    statusCode: number;
    body: string;
}

export function resolveHealthResponse(url?: string): HealthResponse {
    if (url === "/health" || url === "/") {
        return { statusCode: 200, body: "ok" };
    }

    if (url === "/ready") {
        const readiness = getReadinessState();
        const body = JSON.stringify({
            ready: isAppReady(),
            ...readiness
        });
        return {
            statusCode: isAppReady() ? 200 : 503,
            body
        };
    }

    return { statusCode: 404, body: "not found" };
}

export function createHealthServer(): Server {
    return createServer((req, res) => {
        const response = resolveHealthResponse(req.url);
        const isJson = req.url === "/ready";
        res.writeHead(response.statusCode, { "Content-Type": isJson ? "application/json" : "text/plain" });
        res.end(response.body);
    });
}

export function isRecoverableHealthServerError(
    error: unknown,
    options?: { required?: boolean }
): boolean {
    if (options?.required) {
        return false;
    }

    const nodeError = error as NodeJS.ErrnoException | undefined;
    return nodeError?.code === "EADDRINUSE";
}

export async function startHealthServer(port: number, host: string = "0.0.0.0"): Promise<Server> {
    const server = createHealthServer();

    return await new Promise<Server>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve(server);
        });
    });
}

export function addTelegramWebhookHandler(
    server: Server,
    bot: TelegramBot,
    secretToken?: string
): void {
    // We need to intercept requests to /telegram on an existing server.
    // The cleanest way: replace the server's request listener.
    const listeners = server.rawListeners("request");
    server.removeAllListeners("request");

    server.on("request", (req, res) => {
        if (req.method === "POST" && req.url === "/telegram") {
            // Verify secret token if provided
            if (secretToken) {
                const token = req.headers["x-telegram-bot-api-secret-token"];
                if (token !== secretToken) {
                    res.writeHead(403);
                    res.end("Forbidden");
                    return;
                }
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", () => {
                try {
                    const update = JSON.parse(body);
                    bot.processUpdate(update);
                    res.writeHead(200, { "Content-Type": "text/plain" });
                    res.end("ok");
                } catch {
                    res.writeHead(400);
                    res.end("Bad Request");
                }
            });
            return;
        }

        // Fall through to original health handlers
        for (const listener of listeners) {
            (listener as (req: unknown, res: unknown) => void)(req, res);
        }
    });
}
