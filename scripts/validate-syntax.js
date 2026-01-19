const fs = require('fs');
const vm = require('vm');

const files = [
    "public/service-workers/utils/global-vars.js",
    "public/service-workers/utils/hex-utf8.js",
    "public/service-workers/utils/helpers.js",
    "public/service-workers/utils/sql-params.js",
    "public/service-workers/db-init.js",
    "public/service-workers/handlers/chat.handler.js",
    "public/service-workers/handlers/contact.handler.js",
    "public/service-workers/handlers/group.handler.js",
    "public/service-workers/handlers/transaction.handler.js",
    "public/service-workers/utils/maxima-sender.js",
    "public/service-workers/main.js"
];

console.log("🔍 Checking syntax of each file...");

files.forEach(f => {
    try {
        const content = fs.readFileSync(f, 'utf8');
        // Wrap in a function to allow return statements, though module wrapping is also fine
        // Just checking for syntax errors
        new vm.Script(content);
        console.log(`✅ ${f} is valid`);
    } catch (e) {
        console.error(`❌ ${f} FAILED`);
        console.error(e.message);
        if (e.stack) console.error(e.stack.split('\n')[0]);
    }
});
