import { upgradeRequired } from '@/lib/vault-api';

// Retired. Portfolios are client-side encrypted and live at /api/v2/portfolio. This route never reads a
// portfolio and never accepts one: old clients get an upgrade-required answer for every method, so no old
// client, offline retry, import or reset path can recreate plaintext on the server.
export const GET = () => upgradeRequired();
export const PUT = () => upgradeRequired();
export const POST = () => upgradeRequired();
export const DELETE = () => upgradeRequired();
export const PATCH = () => upgradeRequired();
