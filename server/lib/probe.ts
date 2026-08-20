import net from 'net';

export async function pingServer(urlStr: string): Promise<{ latencyMs: number, online: boolean, httpStatus?: number }> {
    try {
        const url = new URL(urlStr);
        const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
        const host = url.hostname;

        const start = Date.now();
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            
            let online = false;

            socket.on('connect', () => {
                online = true;
                const latencyMs = Date.now() - start;
                socket.destroy();
                resolve({ online: true, latencyMs });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ online: false, latencyMs: -1 });
            });

            socket.on('error', () => {
                resolve({ online: false, latencyMs: -1 });
            });

            socket.connect(port, host);
        });
    } catch (err) {
        return { online: false, latencyMs: -1 };
    }
}
