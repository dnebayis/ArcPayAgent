import { createServer, Server } from "http";

export interface HealthResponse {
    statusCode: number;
    body: string;
}

export function resolveHealthResponse(url?: string): HealthResponse {
    if (url === "/health" || url === "/") {
        return { statusCode: 200, body: "ok" };
    }

    return { statusCode: 404, body: "not found" };
}

export function createHealthServer(): Server {
    return createServer((req, res) => {
        const response = resolveHealthResponse(req.url);
        res.writeHead(response.statusCode, { "Content-Type": "text/plain" });
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
