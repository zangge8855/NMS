import crypto from 'crypto';
import os from 'os';

export const DEFAULT_REVIEW_DATA_DIR = '/tmp/nms-review-harness';

export const REVIEW_SCENARIOS = Object.freeze(['empty', 'review', 'edge']);

export const REVIEW_PANEL_PORTS = Object.freeze({
    healthy: 20530,
    legacy: 20531,
    down: 20539,
});

function getDefaultReviewCredentialSeed() {
    const machineScopedSeed = [
        os.hostname(),
        process.env.USER || process.env.LOGNAME || 'unknown-user',
        import.meta.url,
    ].join(':');

    return crypto.createHash('sha256').update(machineScopedSeed).digest('hex').slice(0, 32);
}

const DEFAULT_REVIEW_CREDENTIAL_SEED = getDefaultReviewCredentialSeed();
const REVIEW_CREDENTIAL_SEED = String(
    process.env.REVIEW_CREDENTIAL_SEED || DEFAULT_REVIEW_CREDENTIAL_SEED
).trim() || DEFAULT_REVIEW_CREDENTIAL_SEED;

function deriveFixtureHex(label, size = 32) {
    return crypto
        .createHash('sha256')
        .update(`${REVIEW_CREDENTIAL_SEED}:${String(label || '').trim()}`)
        .digest('hex')
        .slice(0, Math.max(8, Number(size) || 32));
}

function deriveFixturePassword(label, envKey) {
    const override = String(process.env[envKey] || '').trim();
    if (override) return override;
    const digest = deriveFixtureHex(label, 16);
    return `Rv${digest.slice(0, 8)}Aa!${digest.slice(8, 16)}9`;
}

function deriveFixtureOpaqueValue(label, envKey, options = {}) {
    const override = String(process.env[envKey] || '').trim();
    if (override) return override;
    const prefix = String(options.prefix || 'fixture_');
    const size = Math.max(8, Number(options.size) || 24);
    return `${prefix}${deriveFixtureHex(label, size)}`;
}

export const REVIEW_CREDENTIALS = Object.freeze({
    admin: {
        username: 'review-admin',
        password: deriveFixturePassword('review-admin-password', 'REVIEW_ADMIN_PASSWORD'),
        email: 'review-admin@example.com',
        subscriptionEmail: 'admin-sub@example.com',
    },
    user: {
        username: 'review-user',
        password: deriveFixturePassword('review-user-password', 'REVIEW_USER_PASSWORD'),
        email: 'review-user@example.com',
        subscriptionEmail: 'alice@example.com',
    },
    operator: {
        username: 'review-ops',
        password: deriveFixturePassword('review-ops-password', 'REVIEW_OPERATOR_PASSWORD'),
        email: 'review-ops@example.com',
        subscriptionEmail: 'ops@example.com',
    },
    suspended: {
        username: 'review-suspended',
        password: deriveFixturePassword('review-suspended-password', 'REVIEW_SUSPENDED_PASSWORD'),
        email: 'review-suspended@example.com',
        subscriptionEmail: 'suspended@example.com',
    },
    panels: {
        healthy: {
            username: 'nmsadmin',
            password: deriveFixturePassword('review-panel-healthy-password', 'REVIEW_PANEL_HEALTHY_PASSWORD'),
        },
        legacy: {
            username: 'nmsadmin',
            password: deriveFixturePassword('review-panel-legacy-password', 'REVIEW_PANEL_LEGACY_PASSWORD'),
        },
    },
});

const REVIEW_FIXTURE_VALUES = Object.freeze({
    tokenActiveSecret: deriveFixtureOpaqueValue('review-active-token-secret', 'REVIEW_ACTIVE_TOKEN_SECRET', { prefix: 'rvtok_' }),
    tokenRevokedSecret: deriveFixtureOpaqueValue('review-revoked-token-secret', 'REVIEW_REVOKED_TOKEN_SECRET', { prefix: 'rvtok_' }),
    tokenAdminSecret: deriveFixtureOpaqueValue('review-admin-token-secret', 'REVIEW_ADMIN_TOKEN_SECRET', { prefix: 'rvtok_' }),
    realityPrivateKey: deriveFixtureOpaqueValue('review-reality-private-key', 'REVIEW_REALITY_PRIVATE_KEY', { prefix: 'fixture-reality-' }),
    trojanClientPassword: deriveFixturePassword('review-trojan-client-password', 'REVIEW_TROJAN_CLIENT_PASSWORD'),
    shadowsocksClientPassword: deriveFixturePassword('review-shadowsocks-client-password', 'REVIEW_SHADOWSOCKS_CLIENT_PASSWORD'),
    invalidPanelPassword: deriveFixturePassword('review-invalid-panel-password', 'REVIEW_PANEL_INVALID_PASSWORD'),
});

export const REVIEW_SERVER_IDS = Object.freeze({
    healthy: '10000000-0000-4000-8000-000000000001',
    legacy: '10000000-0000-4000-8000-000000000002',
    authFail: '10000000-0000-4000-8000-000000000003',
    down: '10000000-0000-4000-8000-000000000004',
});

const USER_IDS = Object.freeze({
    admin: '20000000-0000-4000-8000-000000000001',
    user: '20000000-0000-4000-8000-000000000002',
    operator: '20000000-0000-4000-8000-000000000003',
    suspended: '20000000-0000-4000-8000-000000000004',
});

const TOKEN_FIXTURES = Object.freeze([
    {
        id: '30000000-0000-4000-8000-000000000001',
        publicId: 'review-active-token',
        email: REVIEW_CREDENTIALS.user.subscriptionEmail,
        name: 'Clash Mobile',
        secret: REVIEW_FIXTURE_VALUES.tokenActiveSecret,
        createdAt: '2026-03-07T09:00:00.000Z',
        createdBy: REVIEW_CREDENTIALS.admin.username,
        expiresAt: '2026-04-07T09:00:00.000Z',
        lastUsedAt: '2026-03-09T08:15:00.000Z',
        revokedAt: null,
        revokedReason: null,
    },
    {
        id: '30000000-0000-4000-8000-000000000002',
        publicId: 'review-revoked-token',
        email: REVIEW_CREDENTIALS.user.subscriptionEmail,
        name: 'Legacy Import',
        secret: REVIEW_FIXTURE_VALUES.tokenRevokedSecret,
        createdAt: '2026-02-15T10:00:00.000Z',
        createdBy: REVIEW_CREDENTIALS.admin.username,
        expiresAt: '2026-03-15T10:00:00.000Z',
        lastUsedAt: '2026-02-20T10:00:00.000Z',
        revokedAt: '2026-02-25T11:00:00.000Z',
        revokedReason: 'review-cleanup',
    },
    {
        id: '30000000-0000-4000-8000-000000000003',
        publicId: 'admin-active-token',
        email: REVIEW_CREDENTIALS.admin.subscriptionEmail,
        name: 'Admin Manual',
        secret: REVIEW_FIXTURE_VALUES.tokenAdminSecret,
        createdAt: '2026-03-08T06:00:00.000Z',
        createdBy: REVIEW_CREDENTIALS.admin.username,
        expiresAt: null,
        lastUsedAt: '2026-03-10T06:30:00.000Z',
        revokedAt: null,
        revokedReason: null,
    },
]);

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildPasswordHash(password, saltHex) {
    const salt = String(saltHex || '').trim() || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(password), salt, 10000, 64, 'sha512').toString('hex');
    return {
        passwordHash: hash,
        passwordSalt: salt,
    };
}

function tokenEncryptionKey(jwtSecret) {
    return crypto.createHash('sha256').update(String(jwtSecret || 'default-secret-change-me')).digest();
}

function encryptTokenSecret(secret, jwtSecret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey(jwtSecret), iv);
    const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `subtok:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function hashTokenSecret(secret, jwtSecret) {
    return crypto
        .createHmac('sha256', String(jwtSecret || 'default-secret-change-me'))
        .update(String(secret || ''))
        .digest('hex');
}

function baseUsers() {
    return [
        {
            id: USER_IDS.admin,
            username: REVIEW_CREDENTIALS.admin.username,
            email: REVIEW_CREDENTIALS.admin.email,
            subscriptionEmail: REVIEW_CREDENTIALS.admin.subscriptionEmail,
            emailVerified: true,
            enabled: true,
            role: 'admin',
            createdAt: '2026-03-01T08:00:00.000Z',
            lastLoginAt: '2026-03-10T07:45:00.000Z',
            ...buildPasswordHash(REVIEW_CREDENTIALS.admin.password, 'aa11aa11aa11aa11aa11aa11aa11aa11'),
        },
        {
            id: USER_IDS.user,
            username: REVIEW_CREDENTIALS.user.username,
            email: REVIEW_CREDENTIALS.user.email,
            subscriptionEmail: REVIEW_CREDENTIALS.user.subscriptionEmail,
            emailVerified: true,
            enabled: true,
            role: 'user',
            createdAt: '2026-03-02T08:00:00.000Z',
            lastLoginAt: '2026-03-10T07:15:00.000Z',
            ...buildPasswordHash(REVIEW_CREDENTIALS.user.password, 'bb22bb22bb22bb22bb22bb22bb22bb22'),
        },
        {
            id: USER_IDS.operator,
            username: REVIEW_CREDENTIALS.operator.username,
            email: REVIEW_CREDENTIALS.operator.email,
            subscriptionEmail: REVIEW_CREDENTIALS.operator.subscriptionEmail,
            emailVerified: true,
            enabled: true,
            role: 'user',
            createdAt: '2026-03-03T08:00:00.000Z',
            lastLoginAt: '2026-03-09T13:05:00.000Z',
            ...buildPasswordHash(REVIEW_CREDENTIALS.operator.password, 'cc33cc33cc33cc33cc33cc33cc33cc33'),
        },
        {
            id: USER_IDS.suspended,
            username: REVIEW_CREDENTIALS.suspended.username,
            email: REVIEW_CREDENTIALS.suspended.email,
            subscriptionEmail: REVIEW_CREDENTIALS.suspended.subscriptionEmail,
            emailVerified: true,
            enabled: false,
            role: 'user',
            createdAt: '2026-03-04T08:00:00.000Z',
            lastLoginAt: '2026-03-08T10:15:00.000Z',
            ...buildPasswordHash(REVIEW_CREDENTIALS.suspended.password, 'dd44dd44dd44dd44dd44dd44dd44dd44'),
        },
    ];
}

function buildHealthyPanelState() {
    return {
        status: {
            cpu: 18.4,
            mem: {
                current: 3435973836,
                total: 8589934592,
            },
            uptime: 372340,
            xray: {
                version: '1.8.13',
            },
            netTraffic: {
                sent: 2684354560,
                recv: 4831838208,
            },
        },
        cpuHistory: [11, 13, 18, 21, 19, 17, 18, 22, 25, 21, 18, 16],
        xrayVersions: ['1.8.13', '1.8.12', '1.8.11'],
        config: {
            log: { level: 'warning' },
            inbounds: ['review-vless-main', 'review-trojan-edge'],
            routing: { domainStrategy: 'AsIs' },
        },
        logs: {
            panel: [
                '2026-03-10T07:00:00Z [INFO] review healthy panel booted',
                '2026-03-10T07:10:00Z [WARNING] token refresh took 120ms',
                '2026-03-10T07:20:00Z [INFO] client sync finished',
            ],
            xray: [
                '2026-03-10T07:00:01Z [info] xray started',
                '2026-03-10T07:10:14Z [warning] slow dns lookup',
            ],
            system: [
                '2026-03-10T06:59:00Z systemd[1]: x-ui.service started',
                '2026-03-10T07:25:00Z cron[1]: geofile refresh scheduled',
            ],
        },
        clientIps: {
            'alice@example.com': ['198.51.100.10', '198.51.100.11'],
            'admin-sub@example.com': ['203.0.113.8'],
        },
        inbounds: [
            {
                id: 101,
                remark: 'review-vless-main',
                protocol: 'vless',
                port: 443,
                listen: '',
                enable: true,
                total: 0,
                up: 1610612736,
                down: 3221225472,
                settings: JSON.stringify({
                    clients: [
                        {
                            id: '11111111-1111-1111-1111-111111111111',
                            email: 'alice@example.com',
                            enable: true,
                            flow: 'xtls-rprx-vision',
                            expiryTime: 1767225600000,
                            limitIp: 2,
                            totalGB: 1024,
                            subId: 'alice-sub',
                            comment: 'review-user',
                            up: 268435456,
                            down: 536870912,
                        },
                        {
                            id: '11111111-1111-1111-1111-111111111112',
                            email: 'admin-sub@example.com',
                            enable: true,
                            flow: '',
                            expiryTime: 0,
                            limitIp: 0,
                            totalGB: 0,
                            subId: 'admin-sub',
                            comment: 'admin',
                            up: 134217728,
                            down: 268435456,
                        },
                    ],
                }),
                streamSettings: {
                    network: 'tcp',
                    security: 'reality',
                    realitySettings: {
                        show: false,
                        dest: 'www.cloudflare.com:443',
                        serverNames: ['www.cloudflare.com'],
                        privateKey: REVIEW_FIXTURE_VALUES.realityPrivateKey,
                        shortIds: ['2f1d8a8b'],
                    },
                },
                clientStats: [
                    {
                        email: 'alice@example.com',
                        up: 268435456,
                        down: 536870912,
                    },
                    {
                        email: 'admin-sub@example.com',
                        up: 134217728,
                        down: 268435456,
                    },
                ],
            },
            {
                id: 102,
                remark: 'review-trojan-edge',
                protocol: 'trojan',
                port: 8443,
                listen: '0.0.0.0',
                enable: true,
                total: 0,
                up: 536870912,
                down: 1073741824,
                settings: {
                    clients: [
                        {
                            password: REVIEW_FIXTURE_VALUES.trojanClientPassword,
                            email: 'ops@example.com',
                            enable: true,
                            expiryTime: 1767225600000,
                            limitIp: 3,
                            totalGB: 2048,
                            subId: 'ops-sub',
                            comment: 'ops',
                            up: 67108864,
                            down: 134217728,
                        },
                    ],
                },
                streamSettings: JSON.stringify({
                    network: 'tcp',
                    security: 'tls',
                    tlsSettings: {
                        serverName: 'review.example.com',
                        alpn: ['h2', 'http/1.1'],
                    },
                }),
                clientStats: [
                    {
                        email: 'ops@example.com',
                        up: 67108864,
                        down: 134217728,
                    },
                ],
            },
            {
                id: 103,
                remark: 'review-disabled-ss',
                protocol: 'shadowsocks',
                port: 9443,
                listen: '',
                enable: false,
                total: 0,
                up: 0,
                down: 0,
                settings: JSON.stringify({
                    clients: [
                        {
                            password: REVIEW_FIXTURE_VALUES.shadowsocksClientPassword,
                            email: 'suspended@example.com',
                            enable: false,
                            expiryTime: 1760000000000,
                            limitIp: 1,
                            totalGB: 128,
                            method: 'aes-128-gcm',
                            up: 0,
                            down: 0,
                        },
                    ],
                }),
                streamSettings: JSON.stringify({
                    network: 'tcp',
                    security: 'none',
                }),
            },
        ],
        onlineSessions: [
            'alice@example.com',
            { email: 'alice@example.com' },
            { email: 'admin-sub@example.com' },
            { email: 'ops@example.com' },
        ],
    };
}

function buildLegacyPanelState() {
    return {
        status: {
            cpu: 67.2,
            mem: {
                current: 6442450944,
                total: 8589934592,
            },
            uptime: 90211,
            xray: {
                version: '1.8.8',
            },
            netTraffic: {
                sent: 805306368,
                recv: 1207959552,
            },
        },
        cpuHistory: [49, 51, 53, 57, 61, 64, 67, 63, 60, 58, 55, 52],
        xrayVersions: ['1.8.8', '1.8.7'],
        config: {
            log: { level: 'info' },
            inbounds: ['legacy-vmess', 'legacy-tunnel'],
            routing: { domainStrategy: 'IPIfNonMatch' },
        },
        logs: {
            panel: [
                '2026-03-10 07:00:00 [INFO] legacy panel booted',
                '2026-03-10 07:12:00 [WARNING] using compatibility log endpoint',
            ],
            xray: [],
            system: [
                '2026-03-10 07:05:00 journalctl: service healthy',
            ],
        },
        clientIps: {},
        inbounds: [
            {
                id: 201,
                remark: 'legacy-vmess',
                protocol: 'vmess',
                port: 2096,
                listen: '',
                enable: true,
                total: 0,
                up: 268435456,
                down: 536870912,
                settings: JSON.stringify({
                    clients: [
                        {
                            id: '22222222-2222-2222-2222-222222222222',
                            email: 'alice@example.com',
                            enable: true,
                            expiryTime: 1767225600000,
                            limitIp: 1,
                            totalGB: 256,
                            up: 33554432,
                            down: 67108864,
                        },
                    ],
                }),
                streamSettings: JSON.stringify({
                    network: 'ws',
                    security: 'tls',
                    wsSettings: {
                        path: '/legacy',
                    },
                }),
                clientStats: [
                    {
                        email: 'alice@example.com',
                        up: 33554432,
                        down: 67108864,
                    },
                ],
            },
            {
                id: 202,
                remark: 'legacy-tunnel',
                protocol: 'dokodemo-door',
                port: 1053,
                listen: '127.0.0.1',
                enable: true,
                total: 0,
                up: 0,
                down: 0,
                settings: JSON.stringify({
                    address: '8.8.8.8',
                    port: 53,
                    network: 'tcp,udp',
                }),
                streamSettings: '{}',
            },
        ],
        onlineSessions: [
            { email: 'alice@example.com' },
        ],
    };
}

export function buildReviewPanelDefinitions(options = {}) {
    const host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
    const ports = {
        healthy: Number(options.ports?.healthy || REVIEW_PANEL_PORTS.healthy),
        legacy: Number(options.ports?.legacy || REVIEW_PANEL_PORTS.legacy),
        down: Number(options.ports?.down || REVIEW_PANEL_PORTS.down),
    };

    return [
        {
            key: 'healthy',
            name: 'review-healthy-panel',
            profile: 'healthy',
            host,
            port: ports.healthy,
            url: `http://${host}:${ports.healthy}`,
            credentials: deepClone(REVIEW_CREDENTIALS.panels.healthy),
            state: buildHealthyPanelState(),
        },
        {
            key: 'legacy',
            name: 'review-legacy-panel',
            profile: 'legacy',
            host,
            port: ports.legacy,
            url: `http://${host}:${ports.legacy}`,
            credentials: deepClone(REVIEW_CREDENTIALS.panels.legacy),
            state: buildLegacyPanelState(),
        },
    ];
}

function buildServerRecords(options = {}) {
    const host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
    const ports = {
        healthy: Number(options.ports?.healthy || REVIEW_PANEL_PORTS.healthy),
        legacy: Number(options.ports?.legacy || REVIEW_PANEL_PORTS.legacy),
        down: Number(options.ports?.down || REVIEW_PANEL_PORTS.down),
    };

    return {
        review: [
            {
                id: REVIEW_SERVER_IDS.healthy,
                name: 'Review Healthy Node',
                url: `http://${host}:${ports.healthy}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.healthy.username,
                password: REVIEW_CREDENTIALS.panels.healthy.password,
                group: 'edge',
                tags: ['review', 'healthy'],
                environment: 'staging',
                health: 'healthy',
                createdAt: '2026-03-05T08:00:00.000Z',
            },
            {
                id: REVIEW_SERVER_IDS.legacy,
                name: 'Review Legacy Node',
                url: `http://${host}:${ports.legacy}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.legacy.username,
                password: REVIEW_CREDENTIALS.panels.legacy.password,
                group: 'compat',
                tags: ['review', 'legacy'],
                environment: 'testing',
                health: 'degraded',
                createdAt: '2026-03-05T09:00:00.000Z',
            },
            {
                id: REVIEW_SERVER_IDS.authFail,
                name: 'Review Auth Failure',
                url: `http://${host}:${ports.healthy}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.healthy.username,
                password: REVIEW_FIXTURE_VALUES.invalidPanelPassword,
                group: 'chaos',
                tags: ['review', 'auth-fail'],
                environment: 'testing',
                health: 'degraded',
                createdAt: '2026-03-05T10:00:00.000Z',
            },
            {
                id: REVIEW_SERVER_IDS.down,
                name: 'Review Down Node',
                url: `http://${host}:${ports.down}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.healthy.username,
                password: REVIEW_CREDENTIALS.panels.healthy.password,
                group: 'chaos',
                tags: ['review', 'down'],
                environment: 'sandbox',
                health: 'unreachable',
                createdAt: '2026-03-05T11:00:00.000Z',
            },
        ],
        edge: [
            {
                id: REVIEW_SERVER_IDS.legacy,
                name: 'Review Legacy Node',
                url: `http://${host}:${ports.legacy}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.legacy.username,
                password: REVIEW_CREDENTIALS.panels.legacy.password,
                group: 'compat',
                tags: ['review', 'legacy'],
                environment: 'testing',
                health: 'degraded',
                createdAt: '2026-03-05T09:00:00.000Z',
            },
            {
                id: REVIEW_SERVER_IDS.authFail,
                name: 'Review Auth Failure',
                url: `http://${host}:${ports.healthy}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.healthy.username,
                password: REVIEW_FIXTURE_VALUES.invalidPanelPassword,
                group: 'chaos',
                tags: ['review', 'auth-fail'],
                environment: 'testing',
                health: 'degraded',
                createdAt: '2026-03-05T10:00:00.000Z',
            },
            {
                id: REVIEW_SERVER_IDS.down,
                name: 'Review Down Node',
                url: `http://${host}:${ports.down}`,
                basePath: '/',
                username: REVIEW_CREDENTIALS.panels.healthy.username,
                password: REVIEW_CREDENTIALS.panels.healthy.password,
                group: 'chaos',
                tags: ['review', 'down'],
                environment: 'sandbox',
                health: 'unreachable',
                createdAt: '2026-03-05T11:00:00.000Z',
            },
        ],
        empty: [],
    };
}

function buildReviewPolicies() {
    return {
        [REVIEW_CREDENTIALS.user.subscriptionEmail]: {
            allowedServerIds: [REVIEW_SERVER_IDS.healthy, REVIEW_SERVER_IDS.legacy],
            allowedProtocols: ['vless', 'vmess'],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected',
            expiryTime: 1767225600000,
            limitIp: 2,
            trafficLimitBytes: 3221225472,
            updatedAt: '2026-03-08T09:30:00.000Z',
            updatedBy: REVIEW_CREDENTIALS.admin.username,
        },
        [REVIEW_CREDENTIALS.operator.subscriptionEmail]: {
            allowedServerIds: [REVIEW_SERVER_IDS.healthy],
            allowedProtocols: ['trojan'],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected',
            expiryTime: 1764547200000,
            limitIp: 3,
            trafficLimitBytes: 6442450944,
            updatedAt: '2026-03-08T10:00:00.000Z',
            updatedBy: REVIEW_CREDENTIALS.admin.username,
        },
    };
}

function buildReviewAudit() {
    return {
        events: [
            {
                id: '40000000-0000-4000-8000-000000000001',
                ts: '2026-03-10T07:00:00.000Z',
                eventType: 'subscription_token_issued',
                actor: REVIEW_CREDENTIALS.admin.username,
                actorRole: 'admin',
                ip: '198.51.100.10',
                method: 'POST',
                path: '/api/subscriptions/alice%40example.com/issue',
                outcome: 'success',
                resourceType: 'subscription_token',
                resourceId: 'review-active-token',
                serverId: REVIEW_SERVER_IDS.healthy,
                targetEmail: REVIEW_CREDENTIALS.user.subscriptionEmail,
                beforeSnapshot: null,
                afterSnapshot: {
                    tokenName: 'Clash Mobile',
                },
                details: {
                    email: REVIEW_CREDENTIALS.user.subscriptionEmail,
                    ttlDays: 30,
                },
            },
            {
                id: '40000000-0000-4000-8000-000000000002',
                ts: '2026-03-10T07:05:00.000Z',
                eventType: 'server_health_monitor_run',
                actor: REVIEW_CREDENTIALS.admin.username,
                actorRole: 'admin',
                ip: '198.51.100.10',
                method: 'POST',
                path: '/api/system/monitor/run',
                outcome: 'success',
                resourceType: 'server_monitor',
                resourceId: '',
                serverId: '',
                targetEmail: '',
                beforeSnapshot: null,
                afterSnapshot: null,
                details: {
                    healthy: 1,
                    degraded: 2,
                    unreachable: 1,
                },
            },
            {
                id: '40000000-0000-4000-8000-000000000003',
                ts: '2026-03-09T06:20:00.000Z',
                eventType: 'client_entitlement_overridden',
                actor: REVIEW_CREDENTIALS.admin.username,
                actorRole: 'admin',
                ip: '203.0.113.15',
                method: 'PUT',
                path: '/api/clients/entitlement',
                outcome: 'success',
                resourceType: 'client_entitlement',
                resourceId: '',
                serverId: REVIEW_SERVER_IDS.healthy,
                targetEmail: REVIEW_CREDENTIALS.user.subscriptionEmail,
                beforeSnapshot: null,
                afterSnapshot: {
                    limitIp: 1,
                },
                details: {
                    serverId: REVIEW_SERVER_IDS.healthy,
                    inboundId: '101',
                    clientIdentifier: '11111111-1111-1111-1111-111111111111',
                    email: REVIEW_CREDENTIALS.user.subscriptionEmail,
                    limitIp: 1,
                },
            },
        ],
        subscriptionAccess: [
            {
                id: '50000000-0000-4000-8000-000000000001',
                ts: '2026-03-10T07:30:00.000Z',
                email: REVIEW_CREDENTIALS.user.subscriptionEmail,
                tokenId: 'review-active-token',
                clientIp: '198.51.100.10',
                proxyIp: '172.16.0.10',
                ipSource: 'cf-connecting-ip',
                cfCountry: 'US',
                ip: '198.51.100.10',
                userAgent: 'ClashMeta/1.18.0',
                status: 'success',
                reason: '',
                serverId: REVIEW_SERVER_IDS.healthy,
                mode: 'auto',
                format: 'clash',
            },
            {
                id: '50000000-0000-4000-8000-000000000002',
                ts: '2026-03-10T07:35:00.000Z',
                email: REVIEW_CREDENTIALS.user.subscriptionEmail,
                tokenId: 'review-revoked-token',
                clientIp: '203.0.113.55',
                proxyIp: '',
                ipSource: 'x-forwarded-for',
                cfCountry: '',
                ip: '203.0.113.55',
                userAgent: 'v2rayN/6.40',
                status: 'denied',
                reason: 'revoked',
                serverId: REVIEW_SERVER_IDS.legacy,
                mode: 'native',
                format: 'encoded',
            },
        ],
    };
}

function buildReviewJobs() {
    return [
        {
            id: '60000000-0000-4000-8000-000000000001',
            type: 'clients',
            action: 'add',
            status: 'partial_success',
            createdAt: '2026-03-09T09:00:00.000Z',
            updatedAt: '2026-03-09T09:01:00.000Z',
            actor: REVIEW_CREDENTIALS.admin.username,
            summary: {
                total: 3,
                success: 2,
                failed: 1,
            },
            results: [
                {
                    success: true,
                    serverId: REVIEW_SERVER_IDS.healthy,
                    serverName: 'Review Healthy Node',
                    inboundId: 101,
                    email: 'alice@example.com',
                    msg: 'Client added',
                },
                {
                    success: false,
                    serverId: REVIEW_SERVER_IDS.authFail,
                    serverName: 'Review Auth Failure',
                    inboundId: 101,
                    email: 'alice@example.com',
                    msg: '3x-ui auth failed',
                },
            ],
            request: {
                action: 'add',
                concurrency: 2,
            },
            retryOf: null,
            canceledAt: null,
            risk: {
                level: 'medium',
                targetCount: 3,
            },
            retryStrategy: null,
            failureGroups: [
                {
                    key: `${REVIEW_SERVER_IDS.authFail}|3x-ui auth failed`,
                    serverId: REVIEW_SERVER_IDS.authFail,
                    serverName: 'Review Auth Failure',
                    error: '3x-ui auth failed',
                    count: 1,
                },
            ],
        },
        {
            id: '60000000-0000-4000-8000-000000000002',
            type: 'inbounds',
            action: 'update',
            status: 'success',
            createdAt: '2026-03-08T11:00:00.000Z',
            updatedAt: '2026-03-08T11:01:00.000Z',
            actor: REVIEW_CREDENTIALS.admin.username,
            summary: {
                total: 2,
                success: 2,
                failed: 0,
            },
            results: [
                {
                    success: true,
                    serverId: REVIEW_SERVER_IDS.healthy,
                    serverName: 'Review Healthy Node',
                    inboundId: 101,
                    msg: 'Inbound updated',
                },
            ],
            request: {
                action: 'update',
                concurrency: 1,
            },
            retryOf: null,
            canceledAt: null,
            risk: null,
            retryStrategy: null,
            failureGroups: [],
        },
    ];
}

function buildReviewTraffic() {
    return {
        samples: [
            {
                ts: '2026-03-09T06:00:00.000Z',
                serverId: REVIEW_SERVER_IDS.healthy,
                inboundId: '101',
                email: 'alice@example.com',
                upBytes: 33554432,
                downBytes: 67108864,
                totalBytes: 100663296,
            },
            {
                ts: '2026-03-09T12:00:00.000Z',
                serverId: REVIEW_SERVER_IDS.healthy,
                inboundId: '101',
                email: 'alice@example.com',
                upBytes: 67108864,
                downBytes: 100663296,
                totalBytes: 167772160,
            },
            {
                ts: '2026-03-10T06:00:00.000Z',
                serverId: REVIEW_SERVER_IDS.healthy,
                inboundId: '102',
                email: 'ops@example.com',
                upBytes: 16777216,
                downBytes: 33554432,
                totalBytes: 50331648,
            },
            {
                ts: '2026-03-10T06:30:00.000Z',
                serverId: REVIEW_SERVER_IDS.legacy,
                inboundId: '201',
                email: 'alice@example.com',
                upBytes: 8388608,
                downBytes: 12582912,
                totalBytes: 20971520,
            },
        ],
        counters: {
            [`${REVIEW_SERVER_IDS.healthy}|101|email:alice@example.com`]: {
                up: 100663296,
                down: 167772160,
                lastSeenAt: '2026-03-10T06:30:00.000Z',
            },
            [`${REVIEW_SERVER_IDS.healthy}|102|email:ops@example.com`]: {
                up: 16777216,
                down: 33554432,
                lastSeenAt: '2026-03-10T06:30:00.000Z',
            },
        },
        meta: {
            lastCollectionAt: '2026-03-10T06:30:00.000Z',
        },
    };
}

function buildReviewOverrides() {
    return {
        records: {
            [`${REVIEW_SERVER_IDS.healthy}::101::11111111-1111-1111-1111-111111111111`]: {
                key: `${REVIEW_SERVER_IDS.healthy}::101::11111111-1111-1111-1111-111111111111`,
                serverId: REVIEW_SERVER_IDS.healthy,
                inboundId: '101',
                clientIdentifier: '11111111-1111-1111-1111-111111111111',
                email: 'alice@example.com',
                expiryTime: 1767225600000,
                limitIp: 1,
                trafficLimitBytes: 2147483648,
                updatedAt: '2026-03-09T06:20:00.000Z',
                updatedBy: REVIEW_CREDENTIALS.admin.username,
            },
        },
    };
}

function buildSystemSettings(apiBaseUrl) {
    return {
        settings: {
            security: {
                requireHighRiskConfirmation: true,
                mediumRiskMinTargets: 5,
                highRiskMinTargets: 20,
                riskTokenTtlSeconds: 180,
            },
            jobs: {
                retentionDays: 90,
                maxPageSize: 200,
                maxRecords: 2000,
                maxConcurrency: 10,
                defaultConcurrency: 3,
            },
            audit: {
                retentionDays: 365,
                maxPageSize: 200,
            },
            subscription: {
                publicBaseUrl: String(apiBaseUrl || 'http://127.0.0.1:3101'),
            },
            auditIpGeo: {
                enabled: false,
                provider: 'ip_api',
                endpoint: 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=en',
                timeoutMs: 3000,
                cacheTtlSeconds: 21600,
            },
            inboundOrder: {
                [REVIEW_SERVER_IDS.healthy]: ['102', '101', '103'],
                [REVIEW_SERVER_IDS.legacy]: ['201', '202'],
            },
            updatedAt: '2026-03-10T07:40:00.000Z',
        },
    };
}

function buildTokenRecords(jwtSecret, includeTokens) {
    if (!includeTokens) return [];
    return TOKEN_FIXTURES.map((item) => ({
        id: item.id,
        publicId: item.publicId,
        email: item.email,
        name: item.name,
        tokenSecretHash: hashTokenSecret(item.secret, jwtSecret),
        tokenSecretEnc: encryptTokenSecret(item.secret, jwtSecret),
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        expiresAt: item.expiresAt,
        lastUsedAt: item.lastUsedAt,
        revokedAt: item.revokedAt,
        revokedReason: item.revokedReason,
    }));
}

function buildScenarioData(options = {}) {
    const scenario = REVIEW_SCENARIOS.includes(options.scenario) ? options.scenario : 'review';
    const serverRecords = buildServerRecords(options);
    const apiBaseUrl = String(options.apiBaseUrl || 'http://127.0.0.1:3101').trim() || 'http://127.0.0.1:3101';
    const jwtSecret = String(options.jwtSecret || 'default-secret-change-me');

    if (scenario === 'empty') {
        return {
            users: [baseUsers()[0]],
            servers: [],
            subscriptionTokens: [],
            userPolicies: {},
            audit: {
                events: [],
                subscriptionAccess: [],
            },
            jobs: [],
            traffic: {
                samples: [],
                counters: {},
                meta: { lastCollectionAt: null },
            },
            overrides: { records: {} },
            systemSettings: buildSystemSettings(apiBaseUrl),
        };
    }

    return {
        users: baseUsers(),
        servers: deepClone(serverRecords[scenario] || serverRecords.review),
        subscriptionTokens: buildTokenRecords(jwtSecret, true),
        userPolicies: buildReviewPolicies(),
        audit: buildReviewAudit(),
        jobs: buildReviewJobs(),
        traffic: buildReviewTraffic(),
        overrides: buildReviewOverrides(),
        systemSettings: buildSystemSettings(apiBaseUrl),
    };
}

export function buildReviewHarnessSnapshot(options = {}) {
    const scenario = REVIEW_SCENARIOS.includes(options.scenario) ? options.scenario : 'review';
    const snapshot = buildScenarioData(options);
    const files = {
        'users.json': snapshot.users,
        'servers.json': snapshot.servers,
        'subscription_tokens.json': snapshot.subscriptionTokens,
        'user_policies.json': snapshot.userPolicies,
        'audit_events.json': snapshot.audit.events,
        'subscription_access_logs.json': snapshot.audit.subscriptionAccess,
        'jobs.json': snapshot.jobs,
        'traffic_samples.json': snapshot.traffic.samples,
        'traffic_counters.json': snapshot.traffic.counters,
        'traffic_meta.json': snapshot.traffic.meta,
        'client_entitlement_overrides.json': snapshot.overrides.records,
        'system_settings.json': snapshot.systemSettings.settings,
    };

    return {
        scenario,
        files,
        summary: {
            adminLogin: {
                username: REVIEW_CREDENTIALS.admin.username,
                password: REVIEW_CREDENTIALS.admin.password,
            },
            userLogin: {
                username: REVIEW_CREDENTIALS.user.username,
                password: REVIEW_CREDENTIALS.user.password,
            },
            serverIds: snapshot.servers.map((item) => item.id),
            fakePanels: buildReviewPanelDefinitions(options).map((item) => ({
                key: item.key,
                url: item.url,
                username: item.credentials.username,
                password: item.credentials.password,
            })),
        },
    };
}
