const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Add req.query.policy parsing in GET routes
// In router.get('/sub/:token')
code = code.replace(
    `const format = normalizeSubscriptionFormat(firstNonEmpty(req.query.format, req.query.target));`,
    `const format = normalizeSubscriptionFormat(firstNonEmpty(req.query.format, req.query.target));\n    const routingPolicy = String(req.query.policy || 'rules').toLowerCase();`
);
// In router.get('/public/:email/:sig')
code = code.replace(
    `const format = normalizeSubscriptionFormat(firstNonEmpty(req.query.format, req.query.target));`,
    `const format = normalizeSubscriptionFormat(firstNonEmpty(req.query.format, req.query.target));\n    const routingPolicy = String(req.query.policy || 'rules').toLowerCase();`
);
// In router.get('/:email/raw')
code = code.replace(
    `const serverId = normalizeServerId(req.query.serverId);`,
    `const serverId = normalizeServerId(req.query.serverId);\n    const routingPolicy = String(req.query.policy || 'rules').toLowerCase();`
);

// We need to pass `routingPolicy` to generators.
// Actually, it's easier to modify `buildMergedLinksByEmail` and `handlePublicTokenRequest` to pass routingPolicy.
// Let's first search for handlePublicTokenRequest definition.
