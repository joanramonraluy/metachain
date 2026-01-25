#!/usr/bin/env bash
set -e

echo "🔓 Restaurant comunicació entre nodea i nodeb..."

sudo firewall-cmd --permanent --remove-rich-rule='rule family="ipv4" source address="127.0.0.1" port port="9001" protocol="tcp" drop'
sudo firewall-cmd --permanent --remove-rich-rule='rule family="ipv4" destination address="127.0.0.1" port port="10001" protocol="tcp" drop'

sudo firewall-cmd --reload

echo "✅ Comunicació restaurada"
