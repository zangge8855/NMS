import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDashboardPresenceFromPanelSnapshots,
} from '../lib/dashboardSnapshotService.js';

test('online count — traffic-inferred sessions dedupe across servers (no double count)', () => {
    const users = [
        { id: 'u1', role: 'user', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
    ];
    const snapshots = [
        {
            server: { id: 'sv-1', name: 'Node 1' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: { clients: [{ email: 'alice@example.com' }] },
                    clientStats: [{ email: 'alice@example.com', up: 0, down: 0 }],
                },
            ],
            onlines: [],
        },
        {
            server: { id: 'sv-2', name: 'Node 2' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: { clients: [{ email: 'alice@example.com' }] },
                    clientStats: [{ email: 'alice@example.com', up: 0, down: 0 }],
                },
            ],
            onlines: [],
        },
    ];
    const activeTrafficEmails = new Set(['alice@example.com']);

    const result = buildDashboardPresenceFromPanelSnapshots(users, snapshots, activeTrafficEmails);

    assert.equal(result.onlineSessionCount, 1, 'cross-server traffic-inferred online session must collapse to 1');
    const alice = result.onlineRows.find((r) => r.email === 'alice@example.com');
    assert.ok(alice, 'alice should appear in onlineRows');
    assert.equal(alice.sessions, 1, 'alice sessions count must be 1, not 2');
});

test('online count — no traffic-delta input means session=0 when /onlines is empty', () => {
    const users = [
        { id: 'u1', role: 'user', email: 'alice@example.com', enabled: true },
    ];
    const snapshots = [
        {
            server: { id: 'sv-1', name: 'Node 1' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: { clients: [{ email: 'alice@example.com' }] },
                    clientStats: [{ email: 'alice@example.com', up: 0, down: 0 }],
                },
            ],
            onlines: [],
        },
    ];

    const result = buildDashboardPresenceFromPanelSnapshots(users, snapshots);
    assert.equal(result.onlineSessionCount, 0, 'without activeTrafficEmails, traffic-inferred fallback must NOT trigger');
});

test('online count — panel /onlines hit still counted per-server (real distinct sessions stay separate)', () => {
    const users = [
        { id: 'u1', role: 'user', email: 'alice@example.com', enabled: true },
    ];
    const snapshots = [
        {
            server: { id: 'sv-1', name: 'Node 1' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: { clients: [{ email: 'alice@example.com' }] },
                    clientStats: [{ email: 'alice@example.com', up: 100, down: 100 }],
                },
            ],
            onlines: [{ email: 'alice@example.com' }],
        },
        {
            server: { id: 'sv-2', name: 'Node 2' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: { clients: [{ email: 'alice@example.com' }] },
                    clientStats: [{ email: 'alice@example.com', up: 100, down: 100 }],
                },
            ],
            onlines: [{ email: 'alice@example.com' }],
        },
    ];

    const result = buildDashboardPresenceFromPanelSnapshots(users, snapshots);
    // Real panel-reported sessions remain scoped by serverId, so two distinct nodes = 2 sessions
    assert.equal(result.onlineSessionCount, 2, 'real panel-reported sessions on two different servers should count as 2');
});

test('online count — official 3x-ui /clients/onlines email strings match managed users', () => {
    const users = [
        { id: 'u1', role: 'user', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
        { id: 'u2', role: 'user', email: 'bob@example.com', subscriptionEmail: 'bob@example.com', enabled: true },
    ];
    const snapshots = [
        {
            server: { id: 'sv-1', name: 'Node 1' },
            inbounds: [
                {
                    protocol: 'vless',
                    settings: {
                        clients: [
                            { id: 'uuid-a', email: 'alice@example.com' },
                            { id: 'uuid-b', email: 'bob@example.com' },
                        ],
                    },
                    clientStats: [
                        { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                        { id: 'uuid-b', email: 'bob@example.com', up: 300, down: 400 },
                    ],
                },
            ],
            onlines: ['alice@example.com'],
        },
    ];

    const result = buildDashboardPresenceFromPanelSnapshots(users, snapshots);

    assert.equal(result.onlineRows.length, 1);
    assert.equal(result.onlineRows[0].email, 'alice@example.com');
    assert.equal(result.onlineSessionCount, 1);
});
