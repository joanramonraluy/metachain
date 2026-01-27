#!/bin/bash

# Script to diagnose DISCOVERED_PEERS state on all nodes
# This helps understand if beacons are being saved but not displayed

echo "========================================="
echo "MetaChain Peer Discovery Diagnostic"
echo "========================================="
echo ""

# Function to query a node's DISCOVERED_PEERS table
query_node() {
    local node_num=$1
    local port=$((9002 + node_num))
    
    echo "Node $node_num (port $port):"
    echo "-------------------------------------------"
    
    # Query DISCOVERED_PEERS
    curl -k -s "https://127.0.0.1:$port/sql?query=SELECT%20publickey,%20alias,%20source,%20last_seen%20FROM%20DISCOVERED_PEERS%20ORDER%20BY%20last_seen%20DESC" | jq -r '
        if .response and .response.rows then
            .response.rows[] | 
            "  \(.ALIAS // .alias) (\(.PUBLICKEY // .publickey | .[0:16])...) - Source: \(.SOURCE // .source) - Last seen: \(.LAST_SEEN // .last_seen)"
        else
            "  Error or no data"
        end
    '
    
    echo ""
}

# Check all three nodes
for i in 1 2 3; do
    query_node $i
done

echo "========================================="
echo "Checking if nodes can reach each other:"
echo "========================================="
echo ""

# Test connectivity
for i in 1 2 3; do
    port=$((9002 + i))
    echo -n "Node $i (port $port): "
    if curl -k -s "https://127.0.0.1:$port/status" > /dev/null 2>&1; then
        echo "✓ Reachable"
    else
        echo "✗ Not reachable"
    fi
done

echo ""
echo "========================================="
echo "Diagnostic complete"
echo "========================================="
