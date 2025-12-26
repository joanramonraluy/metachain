-- Verificar beacons rebuts (descoberta efímera)
SELECT * FROM DISCOVERED_PEERS;

-- Verificar usuaris registrats (registre persistent)
SELECT * FROM METACHAIN_USERS;

-- Verificar si el Service Worker està actiu
-- Busca a la consola del navegador:
-- [Discovery] Beacon sent via L1
-- [Discovery] Beacon received from L1 network
