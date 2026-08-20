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

export function seedDemoData(targetDir = rootDataDir) {
    ensureDir(targetDir);

    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 86400000);
    const twoDaysAgo = new Date(Date.now() - 172800000);

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
            trafficLimitBytes: 1099511627776, // 1 TB
            speedLimitMbps: 1000,
            simultaneousIpLimit: 10,
            createdAt: twoDaysAgo.toISOString(),
            updatedAt: now.toISOString()
        },
        {
            id: 'grp-dev',
            name: 'Development & Testing',
            description: 'Standard cluster nodes with global routing for developers and CI/CD agents',
            trafficLimitBytes: 536870912000, // 500 GB
            speedLimitMbps: 300,
            simultaneousIpLimit: 5,
            createdAt: twoDaysAgo.toISOString(),
            updatedAt: now.toISOString()
        },
        {
            id: 'grp-ops',
            name: 'Infrastructure Operations',
            description: 'Dedicated egress proxies for infrastructure monitoring and system heartbeat probes',
            trafficLimitBytes: 2147483648000, // 2 TB
            speedLimitMbps: 2500,
            simultaneousIpLimit: 25,
            createdAt: oneDayAgo.toISOString(),
            updatedAt: now.toISOString()
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
            overrideFields: []
        }
    };
    writeJson(path.join(targetDir, 'user_policies.json'), userPolicies);

    // 4. Servers (Cluster Nodes)
    const servers = [
        {
            id: 'srv-hk-01',
            name: 'HK-BGP-CN2-01',
            host: 'hk01.cluster.nms.internal',
            port: 20530,
            protocol: 'https',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            region: 'Hong Kong (HKG)',
            countryCode: 'HK',
            latencyMs: 18,
            cpuUsage: 14.2,
            memUsage: 32.8,
            uptimeSeconds: 1245000,
            tags: ['BGP', 'CN2-GIA', 'Direct'],
            xrayVersion: '1.8.24',
            inboundCount: 6,
            clientCount: 142,
            totalUpBytes: 429496729600,  // 400 GB
            totalDownBytes: 1288490188800, // 1.2 TB
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-jp-02',
            name: 'JP-Tokyo-Direct-02',
            host: 'jp02.cluster.nms.internal',
            port: 20531,
            protocol: 'https',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            region: 'Tokyo, Japan (NRT)',
            countryCode: 'JP',
            latencyMs: 34,
            cpuUsage: 22.5,
            memUsage: 45.1,
            uptimeSeconds: 890400,
            tags: ['Tokyo', 'NTT', '4K-Streaming'],
            xrayVersion: '1.8.24',
            inboundCount: 4,
            clientCount: 98,
            totalUpBytes: 214748364800, // 200 GB
            totalDownBytes: 858993459200, // 800 GB
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-us-03',
            name: 'US-Silicon-Valley-01',
            host: 'us01.cluster.nms.internal',
            port: 20532,
            protocol: 'https',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            region: 'San Jose, CA (SJC)',
            countryCode: 'US',
            latencyMs: 128,
            cpuUsage: 11.0,
            memUsage: 28.4,
            uptimeSeconds: 2450000,
            tags: ['US-West', 'Silicon Valley', 'AI-Endpoints'],
            xrayVersion: '1.8.24',
            inboundCount: 5,
            clientCount: 210,
            totalUpBytes: 644245094400, // 600 GB
            totalDownBytes: 2684354560000, // 2.5 TB
            lastSeenAt: now.toISOString()
        },
        {
            id: 'srv-sg-04',
            name: 'SG-SingTel-Tier1',
            host: 'sg01.cluster.nms.internal',
            port: 20533,
            protocol: 'https',
            username: 'nmsadmin',
            password: 'EncryptedFixturePassword!',
            status: 'online',
            enabled: true,
            region: 'Singapore (SIN)',
            countryCode: 'SG',
            latencyMs: 45,
            cpuUsage: 8.7,
            memUsage: 19.3,
            uptimeSeconds: 640000,
            tags: ['Southeast Asia', 'SingTel', 'Ultra-Stable'],
            xrayVersion: '1.8.24',
            inboundCount: 3,
            clientCount: 65,
            totalUpBytes: 107374182400, // 100 GB
            totalDownBytes: 429496729600, // 400 GB
            lastSeenAt: now.toISOString()
        }
    ];
    writeJson(path.join(targetDir, 'servers.json'), servers);

    // 5. Subscription Tokens
    const subscriptionTokens = [
        {
            id: 'sub-tok-01',
            publicId: 'nms-sub-vip-token-alpha',
            email: 'alex.chen@enterprise.io',
            name: 'Alex Chen (Clash Meta / Mihomo)',
            secret: 'subtok:v1:99a8b7c6d5e4f3a2:11223344556677889900aabbccddeeff:0123456789abcdef',
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
            secret: 'subtok:v1:88b7c6d5e4f3a2b1:223344556677889900aabbccddeeff11:fedcba9876543210',
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
        const time = new Date(Date.now() - i * 3600000).toISOString();
        const baseUpload = 25000000 + Math.floor(Math.sin(i / 3) * 12000000);
        const baseDownload = 120000000 + Math.floor(Math.sin(i / 2) * 55000000);
        trafficSamples.push({
            timestamp: time,
            uploadBytes: Math.max(5000000, baseUpload),
            downloadBytes: Math.max(20000000, baseDownload),
            activeClients: 35 + Math.floor(Math.random() * 20),
            tcpConnections: 480 + Math.floor(Math.random() * 250),
            udpConnections: 120 + Math.floor(Math.random() * 80)
        });
    }
    writeJson(path.join(targetDir, 'traffic_samples.json'), trafficSamples);

    const trafficCounters = {
        totalUploadBytes: 1395864506400,
        totalDownloadBytes: 5261292775600,
        dailyUploadBytes: 85899345920,
        dailyDownloadBytes: 429496729600,
        lastResetAt: oneDayAgo.toISOString()
    };
    writeJson(path.join(targetDir, 'traffic_counters.json'), trafficCounters);

    // 7. Audit Events
    const auditEvents = [
        {
            id: 'aud-001',
            type: 'auth.login.success',
            operator: 'admin',
            ip: '192.168.1.100',
            geo: { country: 'Hong Kong', city: 'Central', isp: 'HKT BGP Enterprise' },
            detail: 'Admin successfully authenticated via Master Key & Passkey',
            createdAt: now.toISOString()
        },
        {
            id: 'aud-002',
            type: 'server.cluster.sync',
            operator: 'system-agent',
            ip: '127.0.0.1',
            geo: { country: 'Localhost', city: 'Internal', isp: 'Loopback' },
            detail: 'Cluster synchronized 4 active nodes and 18 protocol inbounds',
            createdAt: new Date(Date.now() - 15 * 60000).toISOString()
        },
        {
            id: 'aud-003',
            type: 'subscription.pull.success',
            operator: 'alex.chen',
            ip: '118.143.12.88',
            geo: { country: 'Hong Kong', city: 'Kowloon', isp: 'PCCW Global' },
            detail: 'Subscription profile "Clash Meta / Mihomo" fetched with 4 node endpoints',
            createdAt: new Date(Date.now() - 45 * 60000).toISOString()
        },
        {
            id: 'aud-004',
            type: 'policy.enforcement.pass',
            operator: 'sarah.lin',
            ip: '133.242.18.5',
            geo: { country: 'Japan', city: 'Tokyo', isp: 'SAKURA Internet' },
            detail: 'Client session verified: bandwidth 300 Mbps, single IP presence compliant',
            createdAt: new Date(Date.now() - 120 * 60000).toISOString()
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
