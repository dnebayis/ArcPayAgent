import http from "http";
import { logger } from "./utils/logger";

export function startHealthServer(port: number): void {
    const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        }));
    });

    server.listen(port, () => {
        logger.info(null, `[Health] Listening on port ${port}`);
    });
}
