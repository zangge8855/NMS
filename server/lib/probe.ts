import dns from 'dns/promises';
import net from 'net';
import config from '../config.js';
import { isReservedOrPrivateIp, stripIpv6Brackets } from './ipGeoResolver.js';
import { isBlockedInternalHostname } from './ssrfProtection.js';

export interface PingServerOptions {
    lookup?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
    timeoutMs?: number;
}

export async function pingServer(
    urlStr: string,
    options: PingServerOptions = {}
): Promise<{ latencyMs: number, online: boolean, httpStatus?: number }> {
    try {
        if (!urlStr || typeof urlStr !== 'string') {
            return { online: false, latencyMs: -1 };
        }
        const trimmed = urlStr.trim();
        if (!trimmed) {
            return { online: false, latencyMs: -1 };
        }
        const normalizedUrl = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
        const url = new URL(normalizedUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { online: false, latencyMs: -1 };
        }

        const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
        const host = stripIpv6Brackets(url.hostname).trim();
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
            return { online: false, latencyMs: -1 };
        }

        let targetAddress = host;
        if (!config.servers?.allowPrivateServerUrl) {
            const literalFamily = net.isIP(host);
            if (literalFamily !== 0) {
                if (isReservedOrPrivateIp(host)) {
                    return { online: false, latencyMs: -1 };
                }
            } else {
                if (isBlockedInternalHostname(host)) {
                    return { online: false, latencyMs: -1 };
                }
                const lookup = options.lookup || ((target: string) => dns.lookup(target, { all: true, verbatim: true }));
                let records: Array<{ address: string; family?: number }>;
                try {
                    records = await lookup(host);
                } catch {
                    return { online: false, latencyMs: -1 };
                }
                if (!Array.isArray(records) || records.length === 0) {
                    return { online: false, latencyMs: -1 };
                }
                for (const record of records) {
                    const addr = stripIpv6Brackets(String(record?.address || '').trim());
                    if (!addr || net.isIP(addr) === 0 || isReservedOrPrivateIp(addr)) {
                        return { online: false, latencyMs: -1 };
                    }
                }
                targetAddress = stripIpv6Brackets(String(records[0].address || '').trim());
            }
        }

        const timeoutMs = Math.max(200, Number(options.timeoutMs || 2000));
        const start = Date.now();
        return await new Promise((resolve) => {
            let settled = false;
            const socket = new net.Socket();
            socket.setTimeout(timeoutMs);

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

            try {
                socket.connect(port, targetAddress);
            } catch {
                finish(false, -1);
            }
        });
    } catch {
        return { online: false, latencyMs: -1 };
    }
}
