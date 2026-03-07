import { createServer, Server } from "http";
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
