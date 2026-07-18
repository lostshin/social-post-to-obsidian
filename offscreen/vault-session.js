// Keep one extension page alive so Chrome retains the active Vault grant.
new Worker('vault-session-worker.js');
