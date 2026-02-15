
// Simulation of data from user logs
const mockPeers = [
    {
        "publickey": "0x30819F300D06092A864886F70D010101050003818D0030818902818100C9BBE4D844B8DF52C625B7D908A17CCDCD70BC20D36333B8B04B8D61EE07201E7A5CF20EDC282E18C587A90030B4FBF39EE874343AB248A329025F0E905A7E639185AA05B23032EC3BB1BAAA17C8DA49E8F747EEC4EB1F2F72E834F791CD55DE63BCC0E40E8321F155FBA9027A6FC5C1A4A1EDB296B66825E25B2EB39380D1AB0203010001",
        "alias": "user1",
        "last_updated": 1771162031991,
        "is_online": true
    },
    {
        "publickey": "0x30819F300D06092A864886F70D010101050003818D0030818902818100BAB9C7467C9FB2120763233990A98F62C96DA6D56B5F6FE0C5FDCE4468C81A7D2A039B22B37BD46EBF611C6ED1617D85DE19EFD12C4AA079C5D8470609EA3AEE1FEDF0C050A4A26402837474F3C2CB91655D26D53DB11956A739D65D2473537F3E7531328516561FFADE39B24C5371388F6668AA636A2617EEC4A79150E59AFF0203010001",
        "alias": "user2",
        "last_updated": 1771162032160,
        "is_online": false // Make one offline to test preference
    },
    {
        "publickey": "0x30819F300D06092A864886F70D010101050003818D00308189028181008928AF397E6669B5DA6EB415CD01E89455C9CDBCB06CBCE5D9562E4E7B0A3724CF5E437522CCDCBFD9918D4840614FDAF5F4FA1A6220144018A46F15B4C28876A84E1A191D7C6798C12593E4C5CDDD4F19A43AFACE8490D8C3FE626D25CC7B32E8FE2D4CB9D2CAE7AE06E96892B1D8D0910CA677989FB71EBFD95595606350470203010001",
        "alias": "user2", // COMPETING ALIAS
        "last_updated": 1771162032166, // NEWER
        "is_online": true // ONLINE
    }
];

// Current Logic (Simplified)
function currentLogic(users) {
    // Just returns the list effectively
    return users.sort((a, b) => b.last_updated - a.last_updated);
}

// Proposed Logic
function newLogic(users) {
    // 1. Sort by Priority (Online > Offline, Newer > Older)
    const sorted = [...users].sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return b.last_updated - a.last_updated;
    });

    // 2. Map aliases to first occurrence (which is the best one due to sort)
    const aliasMap = new Map();
    const finalUsers = [];

    for (const user of sorted) {
        // Normalize alias for comparison
        const aliasKey = (user.alias || '').toLowerCase().trim();

        // Skip invalid/empty
        if (!aliasKey) {
            finalUsers.push(user);
            continue;
        }

        // Allow duplicates for generic names
        if (aliasKey === 'anonymous' || aliasKey === 'unknown') {
            finalUsers.push(user);
            continue;
        }

        if (!aliasMap.has(aliasKey)) {
            aliasMap.set(aliasKey, true);
            finalUsers.push(user);
        } else {
            console.log(`[Dedupe] Dropping duplicate for alias "${user.alias}" (Key: ${user.publickey.substring(0, 10)}...)`);
        }
    }

    return finalUsers;
}

console.log("--- TEST RUN ---");
console.log(`Input count: ${mockPeers.length}`);

console.log("\n--- Current Logic Output ---");
const currentOutput = currentLogic(mockPeers);
console.log(currentOutput.map(u => `${u.alias} (${u.is_online ? 'ON' : 'OFF'}) - ${u.publickey.substring(0, 10)}...`));

console.log("\n--- New Logic Output ---");
const newOutput = newLogic(mockPeers);
console.log(newOutput.map(u => `${u.alias} (${u.is_online ? 'ON' : 'OFF'}) - ${u.publickey.substring(0, 10)}...`));


if (newOutput.length === 2 && newOutput.find(u => u.alias === 'user2' && u.is_online === true)) {
    console.log("\n✅ SUCCESS: Duplicate 'user2' removed, kept the ONLINE/NEWER one.");
} else {
    console.log("\n❌ FAILED: Deduplication logic incorrect.");
    console.log("Expected 2 users, got " + newOutput.length);
}
