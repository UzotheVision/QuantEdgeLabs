/**
 * Re-export so server code keeps its existing import path while the client uses
 * the same implementation. The math is pure (no DB, no fetch, no node built-ins),
 * so it belongs in shared/ — duplicating it would guarantee the UI and the API
 * eventually disagree about whether a contract is cheap.
 */
export * from '@shared/contract-value';
