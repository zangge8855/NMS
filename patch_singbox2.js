const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

// we need to replace the outbounds array in buildSingboxConfigObject.
// Since it's quite large, let's just do string replacement for the static `outbounds: [` parts.

let newOutbounds = `outbounds: []`;

// let's do this: we'll redefine buildSingboxConfigObject.
// It's probably easier to modify the options before creating the object, or dynamically create the proxyGroups for outbounds.
