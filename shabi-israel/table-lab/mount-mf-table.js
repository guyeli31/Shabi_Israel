/**
 * mount-mf-table.js — Re-export shim.
 *
 * The canonical MF renderer lives at table-lab/formats/mf/mount.js.
 * Kept as a back-compat re-export for any caller still using this path.
 */
export { mountMFTable, listMountedMFTables } from './formats/mf/mount.js';
