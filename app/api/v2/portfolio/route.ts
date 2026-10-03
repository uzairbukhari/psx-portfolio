import { failure, identity, vaultDb } from '@/lib/server';
import { getCiphertext, putCiphertext } from '@/lib/vault-api';

// Ciphertext only. The server never loads, merges or enriches portfolio content.
export async function GET(req: Request) {
  try {
    return await getCiphertext(vaultDb(), await identity(req));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    return await putCiphertext(vaultDb(), await identity(req, true), req);
  } catch (e) {
    return failure(e);
  }
}
