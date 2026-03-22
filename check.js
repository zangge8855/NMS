const fs = require('fs');
let content = fs.readFileSync('/root/NMS/client/src/components/Inbounds/InboundModal.jsx', 'utf8');

let selects = content.match(/<Select[\s\S]*?>/g) || [];
console.log("Found Select tags: ", selects.length);

let options = content.match(/<option[\s\S]*?>/g) || [];
console.log("Found option tags: ", options.length);

let inputs = content.match(/<input[\s\S]*?>/g) || [];
console.log("Found lowercase input tags: ", inputs.length);
