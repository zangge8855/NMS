const fs = require('fs');
const file = '/root/NMS/server/routes/subscriptions.ts';
let code = fs.readFileSync(file, 'utf8');

// The original buildSingboxConfigObject takes (links, options)
// Inside it, it generates outbounds.

// We will replace 'rules' with 'routingPolicy' from options.
// Let's replace the outbound logic.
// Find `outbounds: [` array block and `route: {` block. 
