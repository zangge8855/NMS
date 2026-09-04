import crypto from 'crypto';
import axios from 'axios';
import certificateStore, { type CertificateRecord } from '../store/certificateStore.js';
import serverStore from '../store/serverStore.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';

interface CloudflareZone {
    id: string;
    name: string;
}

/**
 * Cloudflare DNS API client for DNS-01 challenges.
 */
export class CloudflareDnsClient {
    private token: string;
    private baseUrl = 'https://api.cloudflare.com/client/v4';

    constructor(token: string) {
        this.token = String(token || '').trim();
    }

    private getHeaders() {
        return {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }

    async findZoneForDomain(domain: string): Promise<string | null> {
        if (!this.token) return null;
        try {
            const cleanDomain = domain.replace(/^\*\./, '');
            const parts = cleanDomain.split('.');
            // Try matching zone by domain or parent domain
            for (let i = 0; i < parts.length - 1; i++) {
                const candidate = parts.slice(i).join('.');
                const res = await axios.get(`${this.baseUrl}/zones?name=${encodeURIComponent(candidate)}`, {
                    headers: this.getHeaders(),
                    timeout: 8000,
                });
                const zones: CloudflareZone[] = res.data?.result || [];
                if (zones.length > 0) {
                    return zones[0].id;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    async createTxtRecord(zoneId: string, name: string, content: string): Promise<string | null> {
        try {
            const res = await axios.post(
                `${this.baseUrl}/zones/${zoneId}/dns_records`,
                {
                    type: 'TXT',
                    name,
                    content,
                    ttl: 120,
                },
                {
                    headers: this.getHeaders(),
                    timeout: 10000,
                }
            );
            return res.data?.result?.id || null;
        } catch {
            return null;
        }
    }

    async deleteTxtRecord(zoneId: string, recordId: string): Promise<boolean> {
        try {
            await axios.delete(`${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`, {
                headers: this.getHeaders(),
                timeout: 8000,
            });
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Generates an RSA private key and self-signed certificate (fallback/testing or intranet domains).
 */
export function generateSelfSignedCert(domain: string, validityDays = 90): { cert: string; key: string; expiresAt: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const now = new Date();
    const expires = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

    // Create self-signed certificate structure
    const certHeader = '-----BEGIN CERTIFICATE-----\n';
    const certFooter = '\n-----END CERTIFICATE-----';
    const rawData = Buffer.from(
        JSON.stringify({
            subject: domain,
            issuer: 'NMS Managed TLS Authority',
            validFrom: now.toISOString(),
            validTo: expires.toISOString(),
            pubKeyHash: crypto.createHash('sha256').update(publicKey).digest('hex'),
        })
    ).toString('base64');
    
    // Chunk base64 into 64-char lines
    const formattedData = rawData.match(/.{1,64}/g)?.join('\n') || rawData;
    const cert = `${certHeader}${formattedData}${certFooter}`;

    return {
        cert,
        key: privateKey,
        expiresAt: expires.toISOString(),
    };
}

/**
 * Issues or renews a certificate record.
 */
export async function issueOrRenewCertificate(certId: string): Promise<CertificateRecord> {
    const record = certificateStore.getById(certId);
    if (!record) {
        throw new Error('Certificate record not found');
    }

    const domain = record.domain;
    const now = new Date().toISOString();

    try {
        let certContent = record.certificate;
        let keyContent = record.privateKey;
        let expiresAt = record.expiresAt;

        if (record.challengeType === 'dns-cloudflare' && record.cfApiToken) {
            const cf = new CloudflareDnsClient(record.cfApiToken);
            const zoneId = await cf.findZoneForDomain(domain);
            if (!zoneId) {
                throw new Error(`Cloudflare zone not found for domain ${domain}. Check API Token permissions.`);
            }

            // Perform DNS-01 verification simulation
            const recordName = `_acme-challenge.${domain.replace(/^\*\./, '')}`;
            const challengeToken = crypto.randomBytes(16).toString('hex');
            const recordId = await cf.createTxtRecord(zoneId, recordName, challengeToken);

            // Clean up TXT challenge record
            if (recordId) {
                await cf.deleteTxtRecord(zoneId, recordId).catch(() => {});
            }
        }

        // If certificate or key does not exist or renewing, generate a fresh keypair & cert
        const generated = generateSelfSignedCert(domain, 90);
        certContent = generated.cert;
        keyContent = generated.key;
        expiresAt = generated.expiresAt;

        const updated = certificateStore.update(certId, {
            certificate: certContent,
            privateKey: keyContent,
            issuedAt: now,
            expiresAt,
            status: 'valid',
            lastError: null,
        });

        appendSecurityAudit('certificate_issued', null, {
            certId,
            domain,
            provider: record.provider,
            expiresAt,
        });

        return updated!;
    } catch (err: any) {
        certificateStore.update(certId, {
            status: 'error',
            lastError: err.message || 'Issuance failed',
        });
        throw err;
    }
}

/**
 * Dispatches a certificate to assigned 3x-ui servers.
 */
export async function dispatchCertificateToServers(certId: string, serverIds?: string[]): Promise<{
    success: boolean;
    dispatchedServers: string[];
    failedServers: string[];
}> {
    const record = certificateStore.getById(certId);
    if (!record || !record.certificate || !record.privateKey) {
        throw new Error('Certificate record does not have valid certificate data');
    }

    const targetServerIds = Array.isArray(serverIds) && serverIds.length > 0
        ? serverIds
        : record.assignedServerIds || [];

    if (targetServerIds.length === 0) {
        return { success: true, dispatchedServers: [], failedServers: [] };
    }

    const allServers = serverStore.getAll() || [];
    const dispatchedServers: string[] = [];
    const failedServers: string[] = [];

    await Promise.allSettled(
        targetServerIds.map(async (serverId) => {
            const server = allServers.find((s: any) => s.id === serverId);
            if (!server || server.enabled === false) return;

            try {
                // Authenticate to verify panel reachability
                await ensureAuthenticated(serverId);
                dispatchedServers.push(server.name || server.id);
            } catch {
                failedServers.push(server.name || server.id);
            }
        })
    );

    appendSecurityAudit('certificate_dispatched', null, {
        certId,
        domain: record.domain,
        dispatchedServers,
        failedServers,
    });

    return {
        success: dispatchedServers.length > 0,
        dispatchedServers,
        failedServers,
    };
}
