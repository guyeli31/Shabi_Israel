/**
 * mountMFTable.js — Re-export shim.
 *
 * The canonical MF renderer now lives at table-lab/formats/mf/mount.js
 * (the lab is the single source of truth for table rendering).
 * This shim preserves production import paths during the migration.
 */
export { mountMFTable, listMountedMFTables } from '../../table-lab/formats/mf/mount.js';
