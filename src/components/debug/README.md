# SQL Debug Panel

## Activació

Prem **`Ctrl + Shift + D`** per obrir/tancar el panell de debug SQL.

## Funcionalitats

### Queries Predefinides
- **Messages**: Veure tots els missatges, missatges pendents
- **Queue**: Comprovar la cua offline
- **Sync**: Comptadors de seqüència per contacte
- **Chats**: Estat de tots els xats
- **Contacts**: Peers descoberts, sol·licituds de contacte
- **Profile**: Perfil de l'usuari actual

### Editor SQL
- Escriu queries SQL personalitzades
- Usa `{CONTACT_PUBKEY}` com a placeholder per al contacte actual
- **`Ctrl + Enter`** per executar la query

### Resultats
- Visualització en taula
- Exportació a JSON
- Historial de queries recents

## Exemples de Queries

```sql
-- Veure tots els missatges d'un xat
SELECT * FROM CHAT_MESSAGES 
WHERE publickey = '0x...' 
ORDER BY sender_seq ASC;

-- Missatges pendents
SELECT * FROM CHAT_MESSAGES 
WHERE state = 'pending';

-- Cua offline
SELECT * FROM OFFLINE_QUEUE;

-- Comptadors de seqüència
SELECT * FROM MESSAGE_COUNTERS;
```
