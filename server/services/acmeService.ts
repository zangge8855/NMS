import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'node:net';
import axios from 'axios';
import config from '../config.js';
import certificateStore, {
    type CertificateRecord,
    resolveCertificateStatus,
} from '../store/certificateStore.js';
import serverStore from '../store/serverStore.js';
import { ensureAuthenticated } from '../lib/panelClient.js';
import { getTlsCertPathsCompat, postUpdateInboundCompat } from '../lib/panelApiCompat.js';
import { isSuiPanelServer } from '../lib/panelType.js';
import { normalizeIpAddress, stripIpv6Brackets } from '../lib/ipGeoResolver.js';
import { parseJsonObjectLike } from '../lib/normalize.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';

interface CloudflareZone {
    id: string;
    name: string;
}

export const ACME_DIRECTORY_URLS: Record<string, string> = {
    letsencrypt: 'https://acme-v02.api.letsencrypt.org/directory',
    'letsencrypt-staging': 'https://acme-staging-v02.api.letsencrypt.org/directory',
    zerossl: 'https://acme.zerossl.com/v2/DV90',
};

const HTTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const httpChallengeStore = new Map<string, { value: string; expiresAt: number }>();

function pruneExpiredHttpChallenges(nowMs: number = Date.now()): void {
    for (const [token, entry] of httpChallengeStore.entries()) {
        if (!entry || entry.expiresAt <= nowMs) {
            httpChallengeStore.delete(token);
        }
    }
}

export function setAcmeHttpChallengeResponse(token: string, value: string, ttlMs: number = HTTP_CHALLENGE_TTL_MS): void {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return;
    pruneExpiredHttpChallenges();
    httpChallengeStore.set(cleanToken, {
        value: String(value || ''),
        expiresAt: Date.now() + Math.max(1000, ttlMs),
    });
}

export function clearAcmeHttpChallengeResponse(token: string): void {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return;
    httpChallengeStore.delete(cleanToken);
}

export function getAcmeHttpChallengeResponse(token: string): string | null {
    const cleanToken = String(token || '').trim();
    if (!cleanToken || !/^[A-Za-z0-9_-]{8,256}$/.test(cleanToken)) {
        return null;
    }
    const entry = httpChallengeStore.get(cleanToken);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        httpChallengeStore.delete(cleanToken);
        return null;
    }
    return entry.value;
}

// ── ASN.1 DER Helpers (RFC 5280 X.509 v3 & RFC 2986 PKCS#10) ──

function encodeDerLength(len: number): Buffer {
    if (len < 0x80) {
        return Buffer.from([len]);
    }
    const bytes: number[] = [];
    let current = len;
    while (current > 0) {
        bytes.unshift(current & 0xff);
        current >>>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), encodeDerLength(content.length), content]);
}

function derSequence(...items: Buffer[]): Buffer {
    return derTlv(0x30, Buffer.concat(items));
}

function derSet(...items: Buffer[]): Buffer {
    return derTlv(0x31, Buffer.concat(items));
}

function derOctetString(content: Buffer): Buffer {
    return derTlv(0x04, content);
}

function derBitString(content: Buffer, unusedBits: number = 0): Buffer {
    return derTlv(0x03, Buffer.concat([Buffer.from([unusedBits & 0x07]), content]));
}

function derUtf8String(text: string): Buffer {
    return derTlv(0x0c, Buffer.from(text, 'utf8'));
}

function derIa5String(text: string): Buffer {
    return derTlv(0x16, Buffer.from(text, 'ascii'));
}

function derBoolean(value: boolean): Buffer {
    return derTlv(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derInteger(value: number | Buffer): Buffer {
    let raw: Buffer;
    if (typeof value === 'number') {
        if (value === 0) {
            raw = Buffer.from([0x00]);
        } else {
            const bytes: number[] = [];
            let current = Math.floor(value);
            while (current > 0) {
                bytes.unshift(current & 0xff);
                current = Math.floor(current / 256);
            }
            raw = Buffer.from(bytes);
        }
    } else {
        raw = value.length > 0 ? Buffer.from(value) : Buffer.from([0x00]);
    }
    if ((raw[0] & 0x80) !== 0) {
        raw = Buffer.concat([Buffer.from([0x00]), raw]);
    }
    return derTlv(0x02, raw);
}

function derOid(oid: string): Buffer {
    const parts = oid.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length < 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
        throw new Error(`Invalid OID: ${oid}`);
    }
    const bytes: number[] = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i += 1) {
        let val = parts[i];
        if (val === 0) {
            bytes.push(0);
            continue;
        }
        const stack: number[] = [];
        while (val > 0) {
            stack.unshift(val & 0x7f);
            val >>>= 7;
        }
        for (let j = 0; j < stack.length; j += 1) {
            bytes.push(j < stack.length - 1 ? stack[j] | 0x80 : stack[j]);
        }
    }
    return derTlv(0x06, Buffer.from(bytes));
}

function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
}

function derTime(date: Date): Buffer {
    const year = date.getUTCFullYear();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const month = pad2(date.getUTCMonth() + 1);
    const day = pad2(date.getUTCDate());
    const hour = pad2(date.getUTCHours());
    const minute = pad2(date.getUTCMinutes());
    const second = pad2(date.getUTCSeconds());
    if (year >= 1950 && year <= 2049) {
        const yy = pad2(year % 100);
        return derTlv(0x17, Buffer.from(`${yy}${month}${day}${hour}${minute}${second}Z`, 'ascii'));
    }
    return derTlv(0x18, Buffer.from(`${year}${month}${day}${hour}${minute}${second}Z`, 'ascii'));
}

function readDerTlvSlice(buf: Buffer, offset: number): { tag: number; contentStart: number; contentLength: number; totalLength: number } {
    const tag = buf[offset];
    const lenByte = buf[offset + 1];
    let contentLength = 0;
    let headerLen = 2;
    if ((lenByte & 0x80) === 0) {
        contentLength = lenByte;
    } else {
        const numOctets = lenByte & 0x7f;
        headerLen = 2 + numOctets;
        for (let i = 0; i < numOctets; i += 1) {
            contentLength = (contentLength << 8) | buf[offset + 2 + i];
        }
    }
    return {
        tag,
        contentStart: offset + headerLen,
        contentLength,
        totalLength: headerLen + contentLength,
    };
}

function extractSpkiKeyBytes(spkiDer: Buffer): Buffer {
    const outer = readDerTlvSlice(spkiDer, 0);
    const algId = readDerTlvSlice(spkiDer, outer.contentStart);
    const bitStringOffset = outer.contentStart + algId.totalLength;
    const bitString = readDerTlvSlice(spkiDer, bitStringOffset);
    // Skip leading unused-bits octet (0x00) inside BIT STRING
    return spkiDer.subarray(bitString.contentStart + 1, bitString.contentStart + bitString.contentLength);
}

function ipv6To16Bytes(ip: string): Buffer | null {
    let text = String(ip || '').trim().toLowerCase();
    if (!text) return null;
    if (text.includes('.')) {
        const lastColon = text.lastIndexOf(':');
        if (lastColon < 0) return null;
        const v4Parts = text.slice(lastColon + 1).split('.').map(Number);
        if (v4Parts.length !== 4 || v4Parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        const high = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
        const low = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
        text = `${text.slice(0, lastColon)}:${high}:${low}`;
    }

    const parts = text.split('::');
    if (parts.length > 2) return null;
    let hextets: string[] = [];
    if (parts.length === 2) {
        const head = parts[0] ? parts[0].split(':') : [];
        const tail = parts[1] ? parts[1].split(':') : [];
        const missing = 8 - head.length - tail.length;
        if (missing < 1) return null;
        hextets = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
    } else {
        hextets = text.split(':');
    }
    if (hextets.length !== 8) return null;

    const out = Buffer.alloc(16);
    for (let i = 0; i < 8; i += 1) {
        if (!/^[0-9a-f]{1,4}$/i.test(hextets[i])) return null;
        const val = Number.parseInt(hextets[i], 16);
        out.writeUInt16BE(val, i * 2);
    }
    return out;
}

export function normalizeSanList(domain: string, sans: unknown = []): string[] {
    const rawList = [
        domain,
        ...(Array.isArray(sans) ? sans : String(sans || '').split(/[,\s]+/)),
    ];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const rawItem of rawList) {
        const stripped = stripIpv6Brackets(String(rawItem || '').trim());
        if (!stripped) continue;
        const ip = normalizeIpAddress(stripped);
        const normalized = ip || stripped.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function buildSanExtensionValueDer(identifiers: string[]): Buffer {
    const names: Buffer[] = [];
    for (const raw of identifiers) {
        const value = stripIpv6Brackets(raw);
        if (!value) continue;
        const family = net.isIP(value);
        if (family === 4) {
            const octets = value.split('.').map(Number);
            names.push(derTlv(0x87, Buffer.from(octets)));
        } else if (family === 6) {
            const bytes = ipv6To16Bytes(value);
            if (bytes) {
                names.push(derTlv(0x87, bytes));
            }
        } else {
            names.push(derTlv(0x82, Buffer.from(value, 'ascii')));
        }
    }
    return derSequence(...names);
}

function buildX509Extension(oid: string, critical: boolean, extValueDer: Buffer): Buffer {
    const parts: Buffer[] = [derOid(oid)];
    if (critical) {
        parts.push(derBoolean(true));
    }
    parts.push(derOctetString(extValueDer));
    return derSequence(...parts);
}

function buildX509Name(commonName: string, organization?: string): Buffer {
    const rdns: Buffer[] = [];
    if (organization) {
        rdns.push(derSet(derSequence(derOid('2.5.4.10'), derUtf8String(organization))));
    }
    rdns.push(derSet(derSequence(derOid('2.5.4.3'), derUtf8String(commonName.slice(0, 64)))));
    return derSequence(...rdns);
}

function wrapPem(label: string, der: Buffer): string {
    const b64 = der.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [b64];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export function buildPkcs10CsrDer(
    identifiers: string[],
    privateKeyPem: string,
    publicKeySpkiDer: Buffer
): Buffer {
    const primaryCn = stripIpv6Brackets(identifiers[0] || 'localhost');
    const subject = buildX509Name(primaryCn);
    const sanExt = buildX509Extension('2.5.29.17', false, buildSanExtensionValueDer(identifiers));
    const extReqAttr = derSequence(
        derOid('1.2.840.113549.1.9.14'),
        derSet(derSequence(sanExt))
    );
    const attributes = derTlv(0xa0, extReqAttr);

    const csrInfo = derSequence(
        derInteger(0),
        subject,
        publicKeySpkiDer,
        attributes
    );

    const sha256WithRsaAlgId = derSequence(derOid('1.2.840.113549.1.1.11'), derNull());
    const signature = crypto.sign('sha256', csrInfo, crypto.createPrivateKey(privateKeyPem));
    return derSequence(csrInfo, sha256WithRsaAlgId, derBitString(signature));
}

/**
 * Generates an RSA-2048 private key and a genuine RFC 5280 X.509 v3 self-signed certificate
 * (parseable & verifiable by OpenSSL, Xray-core, and Node crypto.X509Certificate).
 */
export function generateSelfSignedCert(
    domain: string,
    validityDays = 90,
    options: { sans?: string[] } = {}
): { cert: string; key: string; expiresAt: string } {
    const cleanDomain = stripIpv6Brackets(String(domain || '').trim()) || 'localhost';
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(validityDays) || 90)));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const now = new Date();
    // Backdate notBefore by 5 minutes to accommodate small clock skew across nodes
    const notBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const notAfter = new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000);

    const serialBytes = crypto.randomBytes(16);
    serialBytes[0] &= 0x7f;
    if (serialBytes[0] === 0) serialBytes[0] = 0x01;

    const sha256WithRsaAlgId = derSequence(derOid('1.2.840.113549.1.1.11'), derNull());
    const issuerAndSubject = buildX509Name(cleanDomain, 'NMS Managed TLS Authority');

    const skiDigest = crypto.createHash('sha1').update(extractSpkiKeyBytes(spkiDer)).digest();
    const sanList = normalizeSanList(cleanDomain, options.sans);

    const extensionsList: Buffer[] = [
        buildX509Extension('2.5.29.19', true, derSequence()),
        // digitalSignature (bit 0) + keyEncipherment (bit 2) = 0xa0 with 5 unused trailing bits
        buildX509Extension('2.5.29.15', true, derBitString(Buffer.from([0xa0]), 5)),
        buildX509Extension(
            '2.5.29.37',
            false,
            derSequence(derOid('1.3.6.1.5.5.7.3.1'), derOid('1.3.6.1.5.5.7.3.2'))
        ),
        buildX509Extension('2.5.29.14', false, derOctetString(skiDigest)),
    ];
    if (sanList.length > 0) {
        extensionsList.push(buildX509Extension('2.5.29.17', false, buildSanExtensionValueDer(sanList)));
    }

    const tbsCertificate = derSequence(
        derTlv(0xa0, derInteger(2)), // v3
        derInteger(serialBytes),
        sha256WithRsaAlgId,
        issuerAndSubject,
        derSequence(derTime(notBefore), derTime(notAfter)),
        issuerAndSubject,
        spkiDer,
        derTlv(0xa3, derSequence(...extensionsList))
    );

    const signature = crypto.sign('sha256', tbsCertificate, privateKey);
    const fullCertDer = derSequence(tbsCertificate, sha256WithRsaAlgId, derBitString(signature));

    return {
        cert: wrapPem('CERTIFICATE', fullCertDer),
        key: keyPem,
        expiresAt: notAfter.toISOString(),
    };
}

// ── Cloudflare DNS-01 Client ──

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
        const cleanDomain = stripIpv6Brackets(domain).replace(/^\*\./, '').toLowerCase();
        const parts = cleanDomain.split('.');
        let authErrorMsg = '';
        for (let i = 0; i < parts.length - 1; i += 1) {
            const candidate = parts.slice(i).join('.');
            try {
                const res = await axios.get(`${this.baseUrl}/zones?name=${encodeURIComponent(candidate)}`, {
                    headers: this.getHeaders(),
                    timeout: 10000,
                });
                if (res.data?.success === false) {
                    const cfErr = res.data?.errors?.[0];
                    if (cfErr?.message) {
                        authErrorMsg = cfErr.message;
                    }
                    continue;
                }
                const zones: CloudflareZone[] = res.data?.result || [];
                if (zones.length > 0) {
                    return zones[0].id;
                }
            } catch (err: any) {
                const status = Number(err?.response?.status || 0);
                if (status === 401 || status === 403) {
                    const detail = err?.response?.data?.errors?.[0]?.message || 'Invalid Cloudflare API token permissions';
                    throw new Error(`Cloudflare API authentication failed: ${detail}`);
                }
            }
        }
        if (authErrorMsg) {
            throw new Error(`Cloudflare API error: ${authErrorMsg}`);
        }
        return null;
    }

    async createTxtRecord(zoneId: string, name: string, content: string): Promise<string> {
        const res = await axios.post(
            `${this.baseUrl}/zones/${zoneId}/dns_records`,
            {
                type: 'TXT',
                name,
                content,
                ttl: 60,
            },
            {
                headers: this.getHeaders(),
                timeout: 10000,
            }
        );
        const recordId = res.data?.result?.id;
        if (res.data?.success === false || !recordId) {
            const detail = res.data?.errors?.[0]?.message || 'Failed to create Cloudflare TXT record';
            throw new Error(detail);
        }
        return recordId;
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

// ── RFC 8555 ACME v2 Client ──

interface StoredAcmeAccount {
    privateKeyPem: string;
    kid?: string;
}

const memoryAcmeAccounts = new Map<string, StoredAcmeAccount>();

function isLoopbackDirectoryUrl(directoryUrl: string): boolean {
    try {
        const parsed = new URL(directoryUrl);
        const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
        return false;
    }
}

function getOrCreateAcmeAccount(directoryUrl: string, email: string): StoredAcmeAccount {
    const accountKey = `${directoryUrl}|${String(email || '').trim().toLowerCase()}`;
    const inMemory = memoryAcmeAccounts.get(accountKey);
    if (inMemory) return inMemory;

    const persistOnDisk = !isLoopbackDirectoryUrl(directoryUrl);
    const accountsFile = path.join(config.dataDir, 'acme-accounts.json');
    if (persistOnDisk) {
        try {
            if (fs.existsSync(accountsFile)) {
                const raw = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
                if (raw && typeof raw === 'object' && raw[accountKey]?.privateKeyPem) {
                    const entry: StoredAcmeAccount = raw[accountKey];
                    memoryAcmeAccounts.set(accountKey, entry);
                    return entry;
                }
            }
        } catch {
            // Fall through to generate a fresh ECDSA account key
        }
    }

    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const entry: StoredAcmeAccount = {
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    };
    memoryAcmeAccounts.set(accountKey, entry);

    if (persistOnDisk) {
        try {
            fs.mkdirSync(config.dataDir, { recursive: true });
            let existing: Record<string, StoredAcmeAccount> = {};
            if (fs.existsSync(accountsFile)) {
                existing = JSON.parse(fs.readFileSync(accountsFile, 'utf8')) || {};
            }
            existing[accountKey] = entry;
            fs.writeFileSync(accountsFile, JSON.stringify(existing, null, 2), { mode: 0o600 });
        } catch {
            // Non-fatal: keep account key in memory for current session
        }
    }

    return entry;
}

function saveAcmeAccountKid(directoryUrl: string, email: string, kid: string): void {
    const accountKey = `${directoryUrl}|${String(email || '').trim().toLowerCase()}`;
    const current = memoryAcmeAccounts.get(accountKey);
    if (!current) return;
    current.kid = kid;
    memoryAcmeAccounts.set(accountKey, current);
    if (isLoopbackDirectoryUrl(directoryUrl)) return;

    const accountsFile = path.join(config.dataDir, 'acme-accounts.json');
    try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        let existing: Record<string, StoredAcmeAccount> = {};
        if (fs.existsSync(accountsFile)) {
            existing = JSON.parse(fs.readFileSync(accountsFile, 'utf8')) || {};
        }
        existing[accountKey] = current;
        fs.writeFileSync(accountsFile, JSON.stringify(existing, null, 2), { mode: 0o600 });
    } catch {
        // Non-fatal
    }
}

function encodeBase64Url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveAcmeDirectoryUrl(provider: string, explicitDirectoryUrl?: string): string {
    const explicit = String(explicitDirectoryUrl || '').trim();
    if (/^https?:\/\//i.test(explicit)) return explicit;

    const key = String(provider || '').trim().toLowerCase();
    if (ACME_DIRECTORY_URLS[key]) return ACME_DIRECTORY_URLS[key];

    const envUrl = String(process.env.ACME_DIRECTORY_URL || '').trim();
    if (/^https?:\/\//i.test(envUrl)) return envUrl;

    return ACME_DIRECTORY_URLS.letsencrypt;
}

interface AcmeDirectory {
    newNonce: string;
    newAccount: string;
    newOrder: string;
}

class AcmeV2Client {
    private directoryUrl: string;
    private email: string;
    private account: StoredAcmeAccount;
    private jwk: Record<string, string>;
    private thumbprint: string;
    private directory: AcmeDirectory | null = null;
    private nonce: string = '';

    constructor(directoryUrl: string, email: string = '') {
        this.directoryUrl = directoryUrl;
        this.email = String(email || '').trim();
        this.account = getOrCreateAcmeAccount(directoryUrl, this.email);

        const keyObj = crypto.createPrivateKey(this.account.privateKeyPem);
        const exported = keyObj.export({ format: 'jwk' }) as Record<string, string>;
        this.jwk = {
            crv: exported.crv || 'P-256',
            kty: exported.kty || 'EC',
            x: exported.x,
            y: exported.y,
        };
        const canonicalThumbprintJson = JSON.stringify({
            crv: this.jwk.crv,
            kty: this.jwk.kty,
            x: this.jwk.x,
            y: this.jwk.y,
        });
        this.thumbprint = encodeBase64Url(
            crypto.createHash('sha256').update(canonicalThumbprintJson, 'utf8').digest()
        );
    }

    getKeyAuthorization(token: string): string {
        return `${token}.${this.thumbprint}`;
    }

    getDnsTxtDigest(token: string): string {
        const keyAuth = this.getKeyAuthorization(token);
        return encodeBase64Url(crypto.createHash('sha256').update(keyAuth, 'utf8').digest());
    }

    private async init(): Promise<AcmeDirectory> {
        if (this.directory) return this.directory;
        const dirRes = await axios.get(this.directoryUrl, { timeout: 15000 });
        const data = dirRes.data || {};
        if (!data.newNonce || !data.newAccount || !data.newOrder) {
            throw new Error(`Invalid ACME directory response from ${this.directoryUrl}`);
        }
        this.directory = {
            newNonce: String(data.newNonce),
            newAccount: String(data.newAccount),
            newOrder: String(data.newOrder),
        };
        if (dirRes.headers?.['replay-nonce']) {
            this.nonce = String(dirRes.headers['replay-nonce']);
        }
        return this.directory;
    }

    private async ensureNonce(): Promise<string> {
        if (this.nonce) {
            const current = this.nonce;
            this.nonce = '';
            return current;
        }
        const dir = await this.init();
        const res = await axios.head(dir.newNonce, { timeout: 10000 });
        const nextNonce = String(res.headers?.['replay-nonce'] || '');
        if (!nextNonce) {
            throw new Error('ACME server did not return Replay-Nonce');
        }
        return nextNonce;
    }

    private signJws(url: string, payload: unknown, nonce: string, useJwk: boolean): string {
        const protectedHeader: Record<string, any> = {
            alg: 'ES256',
            nonce,
            url,
        };
        if (useJwk || !this.account.kid) {
            protectedHeader.jwk = this.jwk;
        } else {
            protectedHeader.kid = this.account.kid;
        }
        const protectedB64 = encodeBase64Url(JSON.stringify(protectedHeader));
        // RFC 8555 POST-as-GET passes empty string "" which encodes cleanly to "" base64url.
        const payloadB64 = payload === '' ? '' : encodeBase64Url(JSON.stringify(payload));
        const signingInput = `${protectedB64}.${payloadB64}`;
        const signature = crypto.sign('sha256', Buffer.from(signingInput, 'ascii'), {
            key: crypto.createPrivateKey(this.account.privateKeyPem),
            dsaEncoding: 'ieee-p1363',
        });
        return JSON.stringify({
            protected: protectedB64,
            payload: payloadB64,
            signature: encodeBase64Url(signature),
        });
    }

    private async signedPost(
        url: string,
        payload: unknown,
        options: { useJwk?: boolean; accept?: string } = {}
    ): Promise<{ status: number; headers: Record<string, any>; data: any }> {
        let lastError: any = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const nonce = await this.ensureNonce();
            const body = this.signJws(url, payload, nonce, options.useJwk === true);
            try {
                const res = await axios.post(url, body, {
                    headers: {
                        'Content-Type': 'application/jose+json',
                        ...(options.accept ? { Accept: options.accept } : {}),
                    },
                    timeout: 20000,
                    validateStatus: () => true,
                });
                if (res.headers?.['replay-nonce']) {
                    this.nonce = String(res.headers['replay-nonce']);
                }
                if (res.status === 400 && String(res.data?.type || '').includes('badNonce') && attempt === 0) {
                    continue;
                }
                if (res.status >= 400) {
                    const detail = res.data?.detail || res.data?.type || `HTTP ${res.status}`;
                    throw new Error(`ACME request failed (${res.status}): ${detail}`);
                }
                return res;
            } catch (err: any) {
                lastError = err;
                if (attempt === 0 && err?.response?.headers?.['replay-nonce']) {
                    this.nonce = String(err.response.headers['replay-nonce']);
                }
                if (!String(err?.message || '').includes('badNonce')) {
                    throw err;
                }
            }
        }
        throw lastError || new Error('ACME request failed');
    }

    async ensureAccount(): Promise<string> {
        const dir = await this.init();
        const accountPayload: Record<string, any> = {
            termsOfServiceAgreed: true,
        };
        if (this.email) {
            accountPayload.contact = [`mailto:${this.email}`];
        }
        const res = await this.signedPost(dir.newAccount, accountPayload, { useJwk: true });
        const kid = String(res.headers?.location || this.account.kid || '').trim();
        if (!kid) {
            throw new Error('ACME server did not return account location (kid)');
        }
        saveAcmeAccountKid(this.directoryUrl, this.email, kid);
        return kid;
    }

    async issueCertificate(params: {
        domain: string;
        sans?: string[];
        challengeType: 'dns-cloudflare' | 'http';
        cfApiToken?: string;
        dnsPropagationWaitMs?: number;
        pollIntervalMs?: number;
    }): Promise<{ cert: string; key: string; expiresAt: string }> {
        const identifiers = normalizeSanList(params.domain, params.sans);
        if (identifiers.length === 0) {
            throw new Error('At least one valid domain or IP identifier is required');
        }
        if (params.challengeType === 'http' && identifiers.some((id) => id.startsWith('*.'))) {
            throw new Error('HTTP-01 challenge does not support wildcard certificates; use dns-cloudflare instead');
        }
        if (params.challengeType === 'dns-cloudflare' && !String(params.cfApiToken || '').trim()) {
            throw new Error('Cloudflare API Token is required for dns-cloudflare challenge');
        }

        const dir = await this.init();
        await this.ensureAccount();

        const acmeIdentifiers = identifiers.map((value) => ({
            type: net.isIP(value) !== 0 ? 'ip' : 'dns',
            value,
        }));

        const orderRes = await this.signedPost(dir.newOrder, {
            identifiers: acmeIdentifiers,
        });
        const orderUrl = String(orderRes.headers?.location || '').trim();
        let order = orderRes.data || {};
        const authUrls: string[] = Array.isArray(order.authorizations) ? order.authorizations : [];
        if (authUrls.length === 0 || !order.finalize) {
            throw new Error('ACME order did not return authorization URLs or finalize endpoint');
        }

        const cf = params.challengeType === 'dns-cloudflare'
            ? new CloudflareDnsClient(params.cfApiToken || '')
            : null;
        const createdDnsRecords: Array<{ zoneId: string; recordId: string }> = [];
        const registeredHttpTokens: string[] = [];

        const pollIntervalMs = Math.max(20, Number(params.pollIntervalMs ?? 1000));
        const defaultDnsWait = isLoopbackDirectoryUrl(this.directoryUrl)
            ? 0
            : Math.max(0, Number(process.env.ACME_DNS_PROPAGATION_MS ?? 3000));
        const dnsPropagationWaitMs = params.dnsPropagationWaitMs !== undefined
            ? Math.max(0, Number(params.dnsPropagationWaitMs))
            : defaultDnsWait;

        try {
            const pendingChallenges: Array<{ authUrl: string; challengeUrl: string }> = [];

            for (const authUrl of authUrls) {
                const authRes = await this.signedPost(authUrl, '');
                const auth = authRes.data || {};
                if (auth.status === 'valid') continue;

                const targetType = params.challengeType === 'dns-cloudflare' ? 'dns-01' : 'http-01';
                const challenge = (Array.isArray(auth.challenges) ? auth.challenges : [])
                    .find((c: any) => c?.type === targetType);
                if (!challenge || !challenge.url || !challenge.token) {
                    throw new Error(`ACME authorization for ${auth.identifier?.value || params.domain} lacks ${targetType} challenge`);
                }

                if (targetType === 'dns-01' && cf) {
                    const idValue = String(auth.identifier?.value || params.domain).replace(/^\*\./, '');
                    const zoneId = await cf.findZoneForDomain(idValue);
                    if (!zoneId) {
                        throw new Error(`Cloudflare zone not found for domain ${idValue}. Check API Token permissions.`);
                    }
                    const recordName = `_acme-challenge.${idValue}`;
                    const txtValue = this.getDnsTxtDigest(challenge.token);
                    const recordId = await cf.createTxtRecord(zoneId, recordName, txtValue);
                    createdDnsRecords.push({ zoneId, recordId });
                } else if (targetType === 'http-01') {
                    const keyAuth = this.getKeyAuthorization(challenge.token);
                    setAcmeHttpChallengeResponse(challenge.token, keyAuth);
                    registeredHttpTokens.push(challenge.token);
                }

                pendingChallenges.push({ authUrl, challengeUrl: challenge.url });
            }

            if (createdDnsRecords.length > 0 && dnsPropagationWaitMs > 0) {
                await sleep(dnsPropagationWaitMs);
            }

            for (const item of pendingChallenges) {
                await this.signedPost(item.challengeUrl, {});
                let authStatus = 'pending';
                let latestAuth: any = null;
                for (let attempt = 0; attempt < 30; attempt += 1) {
                    const pollRes = await this.signedPost(item.authUrl, '');
                    latestAuth = pollRes.data || {};
                    authStatus = String(latestAuth.status || '').toLowerCase();
                    if (authStatus === 'valid') break;
                    if (authStatus === 'invalid') {
                        const errDetail = latestAuth.challenges?.find((c: any) => c?.error)?.error?.detail
                            || 'ACME challenge validation failed';
                        throw new Error(errDetail);
                    }
                    await sleep(pollIntervalMs);
                }
                if (authStatus !== 'valid') {
                    throw new Error(`ACME authorization timed out (status: ${authStatus})`);
                }
            }

            const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
            const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
            const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
            const csrDer = buildPkcs10CsrDer(identifiers, keyPem, spkiDer);

            const finalizeRes = await this.signedPost(order.finalize, {
                csr: encodeBase64Url(csrDer),
            });
            order = finalizeRes.data || order;

            if (order.status !== 'valid' || !order.certificate) {
                if (!orderUrl) {
                    throw new Error(`ACME order failed to finalize (status: ${order.status || 'unknown'})`);
                }
                for (let attempt = 0; attempt < 30; attempt += 1) {
                    const pollOrderRes = await this.signedPost(orderUrl, '');
                    order = pollOrderRes.data || {};
                    if (order.status === 'valid' && order.certificate) break;
                    if (order.status === 'invalid') {
                        throw new Error(order.error?.detail || 'ACME order became invalid during finalization');
                    }
                    await sleep(pollIntervalMs);
                }
            }

            if (order.status !== 'valid' || !order.certificate) {
                throw new Error('ACME order did not complete with a certificate download URL');
            }

            const certRes = await this.signedPost(order.certificate, '', {
                accept: 'application/pem-certificate-chain',
            });
            const certPem = typeof certRes.data === 'string'
                ? certRes.data.trim()
                : String(certRes.data || '').trim();
            if (!certPem.includes('BEGIN CERTIFICATE')) {
                throw new Error('ACME server returned invalid certificate PEM payload');
            }

            const parsedLeaf = new crypto.X509Certificate(certPem);
            const expiresAt = new Date(parsedLeaf.validTo).toISOString();

            return {
                cert: certPem,
                key: keyPem,
                expiresAt,
            };
        } finally {
            await Promise.allSettled(
                createdDnsRecords.map(({ zoneId, recordId }) =>
                    cf ? cf.deleteTxtRecord(zoneId, recordId) : Promise.resolve(false)
                )
            );
            registeredHttpTokens.forEach((token) => clearAcmeHttpChallengeResponse(token));
        }
    }
}

export interface IssueCertificateOptions {
    dnsPropagationWaitMs?: number;
    pollIntervalMs?: number;
}

/**
 * Issues or renews a certificate record (local X.509 v3 self-signed or full RFC 8555 ACME v2).
 */
export async function issueOrRenewCertificate(
    certId: string,
    options: IssueCertificateOptions = {}
): Promise<CertificateRecord> {
    const record = certificateStore.getById(certId);
    if (!record) {
        throw new Error('Certificate record not found');
    }

    const domain = stripIpv6Brackets(record.domain);
    const now = new Date().toISOString();

    try {
        let certContent = '';
        let keyContent = '';
        let expiresAt = '';

        const providerKey = String(record.provider || 'letsencrypt').trim().toLowerCase();
        const challengeType = String(record.challengeType || 'dns-cloudflare').trim().toLowerCase();

        if (providerKey === 'selfsigned' || challengeType === 'manual') {
            const generated = generateSelfSignedCert(domain, 90, { sans: record.sans });
            certContent = generated.cert;
            keyContent = generated.key;
            expiresAt = generated.expiresAt;
        } else if (challengeType === 'dns-cloudflare' || challengeType === 'http') {
            const directoryUrl = resolveAcmeDirectoryUrl(providerKey, record.acmeDirectoryUrl);
            const acmeClient = new AcmeV2Client(directoryUrl, record.email || '');
            const issued = await acmeClient.issueCertificate({
                domain,
                sans: record.sans,
                challengeType,
                cfApiToken: record.cfApiToken,
                dnsPropagationWaitMs: options.dnsPropagationWaitMs,
                pollIntervalMs: options.pollIntervalMs,
            });
            certContent = issued.cert;
            keyContent = issued.key;
            expiresAt = issued.expiresAt;
        } else {
            throw new Error(`Unsupported ACME challenge type: ${record.challengeType}`);
        }

        const updated = certificateStore.update(certId, {
            certificate: certContent,
            privateKey: keyContent,
            issuedAt: now,
            expiresAt,
            status: resolveCertificateStatus({ certificate: certContent, expiresAt, status: 'valid' }),
            lastError: null,
        });

        appendSecurityAudit('certificate_issued', null, {
            certId,
            domain,
            provider: record.provider,
            challengeType: record.challengeType,
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

// ── Certificate Dispatch to Nodes ──

function extractCertificateHosts(cert: crypto.X509Certificate, fallbackHosts: string[] = []): string[] {
    const hosts = new Set<string>(fallbackHosts.map((h) => stripIpv6Brackets(h).toLowerCase()).filter(Boolean));
    const sanRaw = String(cert.subjectAltName || '');
    for (const part of sanRaw.split(',')) {
        const trimmed = part.trim();
        if (trimmed.startsWith('DNS:')) {
            hosts.add(trimmed.slice(4).trim().toLowerCase());
        } else if (trimmed.startsWith('IP Address:')) {
            const ip = normalizeIpAddress(trimmed.slice('IP Address:'.length));
            if (ip) hosts.add(ip.toLowerCase());
        }
    }
    return Array.from(hosts);
}

function matchesCertificateHost(targetHostRaw: unknown, certPatterns: string[]): boolean {
    const targetRaw = stripIpv6Brackets(String(targetHostRaw || '').trim());
    if (!targetRaw) return false;
    const normalizedIp = normalizeIpAddress(targetRaw);
    const target = (normalizedIp || targetRaw).toLowerCase();

    return certPatterns.some((patternRaw) => {
        const pattern = stripIpv6Brackets(patternRaw).toLowerCase();
        if (!pattern) return false;
        if (pattern === target) return true;
        if (pattern.startsWith('*.') && !normalizedIp) {
            const suffix = pattern.slice(2);
            const firstDot = target.indexOf('.');
            return firstDot > 0 && target.slice(firstDot + 1) === suffix;
        }
        return false;
    });
}

function splitPemLines(pem: string): string[] {
    return String(pem || '')
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
}

export interface ServerDispatchDetail {
    serverId: string;
    serverName: string;
    ok: boolean;
    mode: string;
    matchedInbounds: number;
    updatedInbounds: number;
    panelCertPaths?: any;
    message?: string;
}

/**
 * Cryptographically verifies certificate/key pair and dispatches inline TLS certificates
 * to matching 3x-ui TLS inbounds on target servers.
 */
export async function dispatchCertificateToServers(
    certId: string,
    serverIds?: string[],
    options: { inboundIds?: Array<string | number>; applyAllTlsInbounds?: boolean } = {}
): Promise<{
    success: boolean;
    dispatchedServers: string[];
    failedServers: string[];
    updatedInboundCount: number;
    details: ServerDispatchDetail[];
}> {
    const record = certificateStore.getById(certId);
    if (!record || !record.certificate || !record.privateKey) {
        throw new Error('Certificate record does not have valid certificate data');
    }

    let x509: crypto.X509Certificate;
    let privateKeyObj: crypto.KeyObject;
    try {
        x509 = new crypto.X509Certificate(record.certificate);
        privateKeyObj = crypto.createPrivateKey(record.privateKey);
    } catch (err: any) {
        throw new Error(`Invalid X.509 certificate or private key PEM: ${err.message || 'parse failed'}`);
    }
    if (!x509.checkPrivateKey(privateKeyObj)) {
        throw new Error('Certificate public key does not match private key');
    }

    const certHosts = extractCertificateHosts(x509, [record.domain, ...(record.sans || [])]);
    const certLines = splitPemLines(record.certificate);
    const keyLines = splitPemLines(record.privateKey);
    const explicitInboundIds = new Set(
        (Array.isArray(options.inboundIds) ? options.inboundIds : [])
            .map((id) => String(id).trim())
            .filter(Boolean)
    );

    const targetServerIds = Array.isArray(serverIds) && serverIds.length > 0
        ? serverIds
        : record.assignedServerIds || [];

    if (targetServerIds.length === 0) {
        return {
            success: true,
            dispatchedServers: [],
            failedServers: [],
            updatedInboundCount: 0,
            details: [],
        };
    }

    const allServers = serverStore.getAll() || [];
    const dispatchedServers: string[] = [];
    const failedServers: string[] = [];
    const details: ServerDispatchDetail[] = [];
    let updatedInboundCount = 0;

    await Promise.allSettled(
        targetServerIds.map(async (serverId) => {
            const server = allServers.find((s: any) => s.id === serverId);
            if (!server || server.enabled === false) return;
            const serverLabel = server.name || server.id;

            try {
                const client = await ensureAuthenticated(serverId);

                if (isSuiPanelServer(server)) {
                    await client.get('/panel/api/inbounds/list').catch(() => null);
                    dispatchedServers.push(serverLabel);
                    details.push({
                        serverId,
                        serverName: serverLabel,
                        ok: true,
                        mode: 'sui_tls_profile_manual',
                        matchedInbounds: 0,
                        updatedInbounds: 0,
                        message: 's-ui manages TLS profiles natively; verified panel reachability',
                    });
                    return;
                }

                const [inboundsRes, certPathsRes] = await Promise.all([
                    client.get('/panel/api/inbounds/list'),
                    getTlsCertPathsCompat(client).catch(() => null),
                ]);
                const inbounds: any[] = Array.isArray(inboundsRes?.data?.obj) ? inboundsRes.data.obj : [];
                const panelCertPaths = certPathsRes?.data?.obj || null;

                let serverHost = '';
                try {
                    serverHost = stripIpv6Brackets(new URL(server.url).hostname);
                } catch {
                    serverHost = '';
                }

                let matchedInbounds = 0;
                let serverUpdatedInbounds = 0;

                for (const inbound of inbounds) {
                    const wasStringStream = typeof inbound?.streamSettings === 'string';
                    const streamSettings = parseJsonObjectLike(inbound?.streamSettings, {});
                    if (String(streamSettings?.security || '').toLowerCase() !== 'tls') continue;

                    const tlsSettings = parseJsonObjectLike(streamSettings?.tlsSettings, {});
                    const inboundIdStr = String(inbound?.id ?? '').trim();
                    const sniMatch = matchesCertificateHost(tlsSettings?.serverName, certHosts);
                    const emptySniServerMatch = !String(tlsSettings?.serverName || '').trim()
                        && matchesCertificateHost(serverHost, certHosts);
                    const explicitMatch = explicitInboundIds.size > 0 && explicitInboundIds.has(inboundIdStr);

                    const shouldUpdate = explicitInboundIds.size > 0
                        ? explicitMatch
                        : (options.applyAllTlsInbounds === true || sniMatch || emptySniServerMatch);
                    if (!shouldUpdate) continue;

                    matchedInbounds += 1;

                    const existingCerts = Array.isArray(tlsSettings.certificates) ? tlsSettings.certificates : [];
                    const preservedOtherCerts = existingCerts.filter((entry: any) => {
                        const usage = String(entry?.usage || 'encipherment').trim().toLowerCase();
                        return usage && usage !== 'encipherment' && usage !== 'issue';
                    });

                    const nextTlsSettings = {
                        ...tlsSettings,
                        certificates: [
                            {
                                certificate: certLines,
                                key: keyLines,
                                usage: 'encipherment',
                            },
                            ...preservedOtherCerts,
                        ],
                    };
                    const nextStreamSettings = {
                        ...streamSettings,
                        tlsSettings: nextTlsSettings,
                    };

                    await postUpdateInboundCompat(client, inbound.id, {
                        ...inbound,
                        streamSettings: wasStringStream ? JSON.stringify(nextStreamSettings) : nextStreamSettings,
                    });

                    serverUpdatedInbounds += 1;
                    updatedInboundCount += 1;
                }

                dispatchedServers.push(serverLabel);
                details.push({
                    serverId,
                    serverName: serverLabel,
                    ok: true,
                    mode: serverUpdatedInbounds > 0 ? 'inline_tls_updated' : 'panel_inspected_no_matching_inbound',
                    matchedInbounds,
                    updatedInbounds: serverUpdatedInbounds,
                    panelCertPaths,
                });
            } catch (err: any) {
                failedServers.push(serverLabel);
                details.push({
                    serverId,
                    serverName: serverLabel,
                    ok: false,
                    mode: 'failed',
                    matchedInbounds: 0,
                    updatedInbounds: 0,
                    message: err?.message || 'Dispatch failed',
                });
            }
        })
    );

    if (dispatchedServers.length > 0) {
        certificateStore.update(certId, { lastDispatchAt: new Date().toISOString() });
    }

    appendSecurityAudit('certificate_dispatched', null, {
        certId,
        domain: record.domain,
        dispatchedServers,
        failedServers,
        updatedInboundCount,
    });

    return {
        success: dispatchedServers.length > 0 && failedServers.length === 0,
        dispatchedServers,
        failedServers,
        updatedInboundCount,
        details,
    };
}
