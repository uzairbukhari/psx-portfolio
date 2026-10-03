import { failure, identity, vaultDb } from '@/lib/server';
import { deleteOwnVault, getVault, postVault, putVaultWrappers } from '@/lib/vault-api';

// Key material only: public KDF parameters, nonces and wrapped keys. The owner is always the verified session.
export async function GET(req: Request) {
  try {
    return await getVault(vaultDb(), await identity(req));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    return await postVault(vaultDb(), await identity(req, true), req);
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    return await putVaultWrappers(vaultDb(), await identity(req, true), req);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    return await deleteOwnVault(vaultDb(), await identity(req, true), req);
  } catch (e) {
    return failure(e);
  }
}
