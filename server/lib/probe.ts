import net from 'net';

export async function pingServer(urlStr: string): Promise<{ latencyMs: number, online: boolean, httpStatus?: number }> {
    try {
        const url = new URL(urlStr);
        const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
        const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
        if (!host) {
            return { online: false, latencyMs: -1 };
        }

        const start = Date.now();
        return new Promise((resolve) => {
            let settled = false;
            const socket = new net.Socket();
            socket.setTimeout(2000);

            const finish = (online: boolean, latencyMs: number) => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch {}
                resolve({ online, latencyMs });
            };

            socket.on('connect', () => {
                finish(true, Date.now() - start);
            });

            socket.on('timeout', () => {
                finish(false, -1);
            });

            socket.on('error', () => {
                finish(false, -1);
            });

            socket.connect(port, host);
        });
    } catch (err) {
        return { online: false, latencyMs: -1 };
    }
}
