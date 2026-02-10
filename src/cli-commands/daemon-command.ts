import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { CommandConfig } from "./command-config.ts";

export async function daemonCommand(config: CommandConfig): Promise<void> {
    config.logger?.log('Starting daemon mode...\n');

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
    config.signal.addEventListener('abort', () => {
        config.logger?.log('\n\nShutting down daemon...');
        config.logger?.log('\nStopping health check server...');
        server.close(() => config.logger?.log('Health check server stopped'));
    }, { once: true });
    await client.start({ signal: config.signal });
    await new Promise<void>((resolve, reject) => {
        if (config.signal.aborted) return resolve();
        server.once('error', reject);
        server.listen(config.healthcheckPort, () => {
            resolve();
            server.off('error', reject);
            config.logger?.log(`Health check endpoint available at http://localhost:${(server.address() as AddressInfo).port}/health`);
        });
    });
    if (config.signal.aborted && server.listening) {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    } else if (server.listening) {
        config.logger?.log('Daemon started. Press Ctrl+C to stop.\n');
        await once(server, 'close');
    }
}
