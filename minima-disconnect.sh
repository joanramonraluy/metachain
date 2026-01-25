#!/usr/bin/env bash
set -e

echo "⛔ Tallant comunicació TCP entre ports 9001 i 10001 (loopback)..."

# Elimina qualsevol qdisc existent (si no existeix, no passa res)
sudo tc qdisc del dev lo root 2>/dev/null || true

# Crea qdisc prio
sudo tc qdisc add dev lo root handle 1: prio

# nodea -> nodeb
sudo tc filter add dev lo protocol ip parent 1:0 prio 1 u32 \
  match ip sport 9001 0xffff \
  match ip dport 10001 0xffff \
  action drop

# nodeb -> nodea
sudo tc filter add dev lo protocol ip parent 1:0 prio 1 u32 \
  match ip sport 10001 0xffff \
  match ip dport 9001 0xffff \
  action drop

echo "✅ Comunicació tallada"
