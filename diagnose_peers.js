// Quick diagnostic script to check DISCOVERED_PEERS on all nodes
const https = require('https');
const process = require('process');

// Disable SSL verification for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function queryNode(nodeNum) {
    const port = 9002 + nodeNum;
    const query = encodeURIComponent('SELECT publickey, alias, source FROM DISCOVERED_PEERS ORDER BY last_seen DESC');
    const url = `https://127.0.0.1:${port}/mds?command=sql query:"${query}"`;

    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ nodeNum, port, data: json });
                } catch (e) {
                    resolve({ nodeNum, port, error: e.message, raw: data });
                }
            });
        }).on('error', (e) => {
            resolve({ nodeNum, port, error: e.message });
        });
    });
}

async function main() {
    console.log('========================================');
    console.log('MetaChain Peer Discovery Diagnostic');
    console.log('========================================\n');

    for (let i = 1; i <= 3; i++) {
        console.log(`Node ${i}:`);
        console.log('-------------------------------------------');

        const result = await queryNode(i);

        if (result.error) {
            console.log(`  ✗ Error: ${result.error}`);
        } else if (result.data && result.data.response && result.data.response.rows) {
            const rows = result.data.response.rows;
            console.log(`  Found ${rows.length} peers:`);
            rows.forEach(row => {
                const pk = row.PUBLICKEY || row.publickey;
                const alias = row.ALIAS || row.alias;
                const source = row.SOURCE || row.source;
                console.log(`    - ${alias} (${pk.substring(0, 16)}...) from ${source}`);
            });
        } else {
            console.log(`  Unexpected response:`, result.raw || result.data);
        }

        console.log('');
    }

    console.log('========================================');
}

main().catch(console.error);
