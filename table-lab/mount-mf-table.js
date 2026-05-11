/**
 * mount-mf-table.js — Re-export shim.
 *
 * The canonical MF renderer now lives at js/render/mountMFTable.js so the
 * main app can use it. This file remains as a back-compat re-export so the
 * lab keeps importing from its old path.
 */
export { mountMFTable, listMountedMFTables } from '../js/render/mountMFTable.js';
