import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDataDir = path.resolve(__dirname, '../../data');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex');
}

function tokenEncryptionKey(secret) {
    return crypto.createHash('sha256').update(String(secret || 'default-secret-change-me')).digest();
}

function encryptTokenSecret(secret, keySecret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey(keySecret), iv);
    const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `subtok:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function hashTokenSecret(secret, keySecret) {
    return crypto
        .createHmac('sha256', String(keySecret || 'default-secret-change-me'))
        .update(String(secret || ''))
        .digest('hex');
}

export function seedDemoData(targetDir = rootDataDir) {
    ensureDir(targetDir);

    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 86400000);
    const twoDaysAgo = new Date(Date.now() - 172800000);
    const subTokenSecret = String(
        process.env.SUBSCRIPTION_TOKEN_SECRET
        || process.env.CREDENTIALS_SECRET
        || process.env.JWT_SECRET
        || 'default-secret-change-me'
    ).trim() || 'default-secret-change-me';

    // 1. Users
    const adminSalt = 'a876118a350d662627fc472ba593cdee';
    const userSalt1 = 'b789118a350d662627fc472ba593cdef';
    const userSalt2 = 'c901118a350d662627fc472ba593cde0';
    const userSalt3 = 'd012118a350d662627fc472ba593cde1';

    const users = [
        {
            id: '9625e73b-8588-4914-855f-4b19461aee7e',
            username: 'admin',
            passwordHash: hashPassword('admin', adminSalt),
            passwordSalt: adminSalt,
            pbkdf2Iterations: 210000,
            role: 'admin',
            enabled: true,
            emailVerified: true,
            email: 'admin@nms.cluster',
            subscriptionEmail: 'admin@nms.cluster',
            subscriptionAliasPath: 'admin-sub-key',
            groupId: 'grp-vip',
            createdAt: twoDaysAgo.toISOString(),
            lastLoginAt: now.toISOString(),
            passkeys: []
        },
        {
            id: 'u-10000001-0000-4000-8000-000000000001',
            username: 'alex.chen',
            passwordHash: hashPassword('AlexPass123!', userSalt1),
            passwordSalt: userSalt1,
            pbkdf2Iterations: 210000,
            role: 'user',
            enabled: true,
            emailVerified: true,
            email: 'alex.chen@enterprise.io',
            subscriptionEmail: 'alex.chen@enterprise.io',
            subscriptionAliasPath: 'alex-vip-access',
            groupId: 'grp-vip',
            createdAt: twoDaysAgo.toISOString(),
            lastLoginAt: oneDayAgo.toISOString(),
            passkeys: []
        },
        {
            id: 'u-10000001-0000-4000-8000-000000000002',
            username: 'sarah.lin',
            passwordHash: hashPassword('SarahPass123!', userSalt2),
            passwordSalt: userSalt2,
            pbkdf2Iterations: 210000,
            role: 'user',
            enabled: true,
            emailVerified: true,
            email: 'sarah.lin@tokyo-lab.jp',
            subscriptionEmail: 'sarah.lin@tokyo-lab.jp',
            subscriptionAliasPath: 'sarah-dev-sub',
            groupId: 'grp-dev',
            createdAt: twoDaysAgo.toISOString(),
            lastLoginAt: now.toISOString(),
            passkeys: []
        },
        {
            id: 'u-10000001-0000-4000-8000-000000000003',
            username: 'ops.cluster',
            passwordHash: hashPassword('OpsPass123!', userSalt3),
            passwordSalt: userSalt3,
            pbkdf2Iterations: 210000,
            role: 'user',
            enabled: true,
            emailVerified: true,
            email: 'ops@cloudinfra.net',
            subscriptionEmail: 'ops@cloudinfra.net',
            subscriptionAliasPath: 'ops-monitoring-sub',
            groupId: 'grp-ops',
            createdAt: oneDayAgo.toISOString(),
            lastLoginAt: now.toISOString(),
            passkeys: []
        }
    ];
    writeJson(path.join(targetDir, 'users.json'), users);

    // 2. User Groups
    const userGroups = [
        {
            id: 'grp-vip',
            name: 'VIP Premium Enterprise',
            description: 'Ultra low-latency premium CN2-GIA & Direct BGP routing with unmetered rate-limits',
            enabled: true,
            allowedServerIds: [],
            blockedServerIds: [],
            allowedProtocols: [],
            allowedInboundKeys: [],
            blockedInboundKeys: [],
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
            expiryTime: 0,
            trafficLimitBytes: 1099511627776, // 1 TB
            speedLimitUp: 1000,
            speedLimitDown: 1000,
            limitIp: 10,
            trafficResetCycle: 'monthly',
            ipLimitPolicy: 'first-wins',
            createdAt: twoDaysAgo.toISOString(),
            updatedAt: now.toISOString(),
            updatedBy: 'admin'
        },
        {
            id: 'grp-dev',
            name: 'Development & Testing',
            description: 'Standard cluster nodes with global routing for developers and CI/CD agents',
            enabled: true,
            allowedServerIds: [],
            blockedServerIds: [],
            allowedProtocols: [],
            allowedInboundKeys: [],
            blockedInboundKeys: [],
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
            expiryTime: 0,
            trafficLimitBytes: 536870912000, // 500 GB
            speedLimitUp: 300,
            speedLimitDown: 300,
            limitIp: 5,
            trafficResetCycle: 'monthly',
            ipLimitPolicy: 'first-wins',
            createdAt: twoDaysAgo.toISOString(),
            updatedAt: now.toISOString(),
            updatedBy: 'admin'
        },
        {
            id: 'grp-ops',
            name: 'Infrastructure Operations',
            description: 'Dedicated egress proxies for infrastructure monitoring and system heartbeat probes',
            enabled: true,
            allowedServerIds: [],
            blockedServerIds: [],
            allowedProtocols: [],
            allowedInboundKeys: [],
            blockedInboundKeys: [],
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
            expiryTime: 0,
            trafficLimitBytes: 2147483648000, // 2 TB
            speedLimitUp: 2500,
            speedLimitDown: 2500,
            limitIp: 25,
            trafficResetCycle: 'monthly',
            ipLimitPolicy: 'first-wins',
            createdAt: oneDayAgo.toISOString(),
            updatedAt: now.toISOString(),
            updatedBy: 'admin'
        }
    ];
    writeJson(path.join(targetDir, 'user_groups.json'), userGroups);

    // 3. User Policies (keyed by normalized email or ID)
    const userPolicies = {
        'alex.chen@enterprise.io': {
            allowedServerIds: ['srv-hk-01', 'srv-jp-02', 'srv-us-03', 'srv-sg-04'],
            blockedServerIds: [],
            allowedProtocols: ['vless', 'vmess', 'trojan', 'shadowsocks'],
            allowedInboundKeys: [],
            blockedInboundKeys: [],
            serverScopeMode: 'all',
            protocolScopeMode: 'all',
            expiryTime: 0,
            limitIp: 10,
            trafficLimitBytes: 1099511627776,
            speedLimitUp: 1000,
            speedLimitDown: 1000,
            trafficResetCycle: 'monthly',
            ipLimitPolicy: 'first-wins',
            tgId: 0,
            group: 'VIP Premium Enterprise',
            comment: 'Auto-provisioned VIP policy',
            reset: 0,
            inheritGroup: true,
            overrideFields: [],
            updatedAt: now.toISOString(),
            updatedBy: 'admin'
        }
    };
    writeJson(path.join(targetDir, 'user_policies.json'), userPolicies);

    // 4. Servers (Cluster Nodes)
    const servers = [
        {
            id: 'srv-hk-01',
            name: 'HK-BGP-CN2-01',
            url: 'https://hk01.cluster.nms.internal:20530',
            basePath: '/',
            panelType: '3x-ui',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            group: 'Hong Kong',
            tags: ['BGP', 'CN2-GIA', 'Direct'],
            environment: 'production',
            health: 'healthy',
            region: 'Hong Kong (HKG)',
            countryCode: 'HK',
            latencyMs: 18,
            cpuUsage: 14.2,
            memUsage: 32.8,
            uptimeSeconds: 1245000,
            xrayVersion: '1.8.24',
            inboundCount: 6,
            clientCount: 142,
            totalUpBytes: 429496729600,  // 400 GB
            totalDownBytes: 1288490188800, // 1.2 TB
            createdAt: twoDaysAgo.toISOString(),
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-jp-02',
            name: 'JP-Tokyo-Direct-02',
            url: 'https://jp02.cluster.nms.internal:20531',
            basePath: '/',
            panelType: '3x-ui',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            group: 'Japan',
            tags: ['Tokyo', 'NTT', '4K-Streaming'],
            environment: 'production',
            health: 'healthy',
            region: 'Tokyo, Japan (NRT)',
            countryCode: 'JP',
            latencyMs: 34,
            cpuUsage: 22.5,
            memUsage: 45.1,
            uptimeSeconds: 890400,
            xrayVersion: '1.8.24',
            inboundCount: 4,
            clientCount: 98,
            totalUpBytes: 214748364800, // 200 GB
            totalDownBytes: 858993459200, // 800 GB
            createdAt: twoDaysAgo.toISOString(),
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-us-03',
            name: 'US-Silicon-Valley-01',
            url: 'https://us01.cluster.nms.internal:20532',
            basePath: '/',
            panelType: '3x-ui',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            group: 'United States',
            tags: ['US-West', 'Silicon Valley', 'AI-Endpoints'],
            environment: 'production',
            health: 'healthy',
            region: 'San Jose, CA (SJC)',
            countryCode: 'US',
            latencyMs: 128,
            cpuUsage: 11.0,
            memUsage: 28.4,
            uptimeSeconds: 2450000,
            xrayVersion: '1.8.24',
            inboundCount: 5,
            clientCount: 210,
            totalUpBytes: 644245094400, // 600 GB
            totalDownBytes: 2684354560000, // 2.5 TB
            createdAt: twoDaysAgo.toISOString(),
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-sg-04',
            name: 'SG-SingTel-Tier1',
            url: 'https://sg01.cluster.nms.internal:20533',
            basePath: '/',
            panelType: '3x-ui',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            group: 'Singapore',
            tags: ['Southeast Asia', 'SingTel', 'Ultra-Stable'],
            environment: 'production',
            health: 'healthy',
            region: 'Singapore (SIN)',
            countryCode: 'SG',
            latencyMs: 45,
            cpuUsage: 8.7,
            memUsage: 19.3,
            uptimeSeconds: 640000,
            xrayVersion: '1.8.24',
            inboundCount: 3,
            clientCount: 65,
            totalUpBytes: 107374182400, // 100 GB
            totalDownBytes: 429496729600, // 400 GB
            createdAt: oneDayAgo.toISOString(),
            lastSeenAt: now.toISOString()
        }
    ];
    writeJson(path.join(targetDir, 'servers.json'), servers);

    // 5. Subscription Tokens
    const demoSecret1 = 'demo-vip-token-secret-alpha-001122';
    const demoSecret2 = 'demo-dev-token-secret-beta-334455';
    const subscriptionTokens = [
        {
            id: 'sub-tok-01',
            publicId: 'nms-sub-vip-token-alpha',
            email: 'alex.chen@enterprise.io',
            name: 'Alex Chen (Clash Meta / Mihomo)',
            tokenSecretHash: hashTokenSecret(demoSecret1, subTokenSecret),
            tokenSecretEnc: encryptTokenSecret(demoSecret1, subTokenSecret),
            createdAt: twoDaysAgo.toISOString(),
            createdBy: 'admin',
            expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
            lastUsedAt: now.toISOString(),
            revokedAt: null,
            revokedReason: null
        },
        {
            id: 'sub-tok-02',
            publicId: 'nms-sub-dev-token-beta',
            email: 'sarah.lin@tokyo-lab.jp',
            name: 'Sarah Lin (Sing-Box iOS)',
            tokenSecretHash: hashTokenSecret(demoSecret2, subTokenSecret),
            tokenSecretEnc: encryptTokenSecret(demoSecret2, subTokenSecret),
            createdAt: twoDaysAgo.toISOString(),
            createdBy: 'admin',
            expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
            lastUsedAt: oneDayAgo.toISOString(),
            revokedAt: null,
            revokedReason: null
        }
    ];
    writeJson(path.join(targetDir, 'subscription_tokens.json'), subscriptionTokens);

    // 6. Traffic Stats & Samples
    const trafficSamples = [];
    for (let i = 24; i >= 0; i--) {
        const ts = new Date(Date.now() - i * 3600000).toISOString();
        const upBytes = Math.max(5000000, 25000000 + Math.floor(Math.sin(i / 3) * 12000000));
        const downBytes = Math.max(20000000, 120000000 + Math.floor(Math.sin(i / 2) * 55000000));
        trafficSamples.push({
            kind: 'server_snapshot',
            ts,
            serverId: 'srv-hk-01',
            serverName: 'HK-BGP-CN2-01',
            upBytes,
            downBytes,
            totalBytes: upBytes + downBytes,
        });
    }
    writeJson(path.join(targetDir, 'traffic_samples.json'), trafficSamples);

    const trafficCounters = {
        'srv-hk-01|101|alex.chen@enterprise.io': {
            up: 42949672960,
            down: 128849018880,
            lastSeenAt: now.toISOString(),
        },
        'srv-jp-02|102|sarah.lin@tokyo-lab.jp': {
            up: 21474836480,
            down: 85899345920,
            lastSeenAt: oneDayAgo.toISOString(),
        },
    };
    writeJson(path.join(targetDir, 'traffic_counters.json'), trafficCounters);

    // 7. Audit Events
    const auditEvents = [
        {
            id: 'aud-001',
            ts: now.toISOString(),
            eventType: 'auth_login_success',
            actor: 'admin',
            actorRole: 'admin',
            ip: '192.168.1.100',
            method: 'POST',
            path: '/api/auth/login',
            outcome: 'success',
            details: {
                message: 'Admin successfully authenticated via Master Key & Passkey',
                geo: { country: 'Hong Kong', city: 'Central', isp: 'HKT BGP Enterprise' },
            },
        },
        {
            id: 'aud-002',
            ts: new Date(Date.now() - 15 * 60000).toISOString(),
            eventType: 'server_cluster_sync',
            actor: 'system-agent',
            actorRole: 'admin',
            ip: '127.0.0.1',
            method: 'POST',
            path: '/api/servers/sync',
            outcome: 'success',
            details: {
                message: 'Cluster synchronized 4 active nodes and 18 protocol inbounds',
                geo: { country: 'Localhost', city: 'Internal', isp: 'Loopback' },
            },
        },
        {
            id: 'aud-003',
            ts: new Date(Date.now() - 45 * 60000).toISOString(),
            eventType: 'subscription_token_issued',
            actor: 'alex.chen',
            actorRole: 'user',
            ip: '118.143.12.88',
            method: 'POST',
            path: '/api/subscriptions/alex.chen%40enterprise.io/issue',
            outcome: 'success',
            details: {
                message: 'Subscription profile "Clash Meta / Mihomo" fetched with 4 node endpoints',
                geo: { country: 'Hong Kong', city: 'Kowloon', isp: 'PCCW Global' },
            },
        },
        {
            id: 'aud-004',
            ts: new Date(Date.now() - 120 * 60000).toISOString(),
            eventType: 'user_policy_updated',
            actor: 'sarah.lin',
            actorRole: 'user',
            ip: '133.242.18.5',
            method: 'PUT',
            path: '/api/user-policy/sarah.lin%40tokyo-lab.jp',
            outcome: 'success',
            details: {
                message: 'Client session verified: bandwidth 300 Mbps, IP limit compliant',
                geo: { country: 'Japan', city: 'Tokyo', isp: 'SAKURA Internet' },
            },
        }
    ];
    writeJson(path.join(targetDir, 'audit_events.json'), auditEvents);

    console.log('✅ Demo test data generated successfully in /data directory:');
    console.log('   - 4 User Accounts (admin, alex.chen, sarah.lin, ops.cluster)');
    console.log('   - 3 User Groups (VIP, Dev, Operations)');
    console.log('   - 4 Cluster Nodes (HK, JP, US, SG)');
    console.log('   - 2 Active Subscriptions, 24h Traffic Curves, & Audit Logs');
    return { success: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    seedDemoData();
}
