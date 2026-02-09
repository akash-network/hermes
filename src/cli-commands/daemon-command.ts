import http from 'node:http';
import type { CommandConfig } from "./command-config.ts";

export async function daemonCommand(config: CommandConfig): Promise<void> {
    config.logger?.log('Starting daemon mode...\n');

    const abortController = new AbortController();

    // Handle graceful shutdown
    config.process.on('SIGINT', () => {
        config.logger?.log('\n\nShutting down daemon...');
        abortController.abort();
    });

    config.process.on('SIGTERM', () => {
        config.logger?.log('\n\nShutting down daemon...');
        abortController.abort();
    });

    const client = await config.createHermesClient(config);
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
            const status = client.getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });
    abortController.signal.addEventListener('abort', () => {
        if (!server.listening) return;
        config.logger?.log('\nStopping health check server...');
        server.close(() => config.logger?.log('Health check server stopped'));
    }, { once: true });
    await client.start({ signal: abortController.signal });
    server.listen(3000, () => {
        config.logger?.log('Health check endpoint available at http://localhost:3000/health');
    });
    config.logger?.log('Daemon started. Press Ctrl+C to stop.\n');
}
