import { upgradeRequired } from '@/lib/vault-api';

// Old clients cannot safely write a portfolio collection. Keep this barrier during rollback.
export const GET = () => upgradeRequired();
export const PUT = () => upgradeRequired();
