// Request handling for /api/vault and /api/v2/portfolio, free of Worker-only imports so it is testable. The route
// files only add authentication (the owner comes from the verified session, never from the request) and bindings.
import type {
  EncryptedPortfolioResponse,
  SaveEncryptedPortfolioRequest,
  SaveEncryptedPortfolioResponse,
  VaultResponse,
  VaultSetupRequest,
  VaultSetupResponse,
  VaultWrappersRequest,
  VaultWrappersResponse,
} from './api-types.ts';
import { MAX_ENCODED_REQUEST_BYTES, VaultError, validateEnvelope, validateVaultKeyMaterial } from './vault-crypto.ts';
import { deleteVault, readCiphertext, readVault, saveCiphertext, setupVault, updateWrappers } from './vault-store.ts';
import { readLimited } from './read-limited.ts';
import { UserError } from './user-error.ts';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** Reads a size-bounded JSON object body. Never decrypts or inspects private content. */
export async function readJsonBody(req: Request, limit = MAX_ENCODED_REQUEST_BYTES): Promise<Record<string, unknown>> {
  const bytes = await readLimited(req, limit, 'Request is too large.');
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UserError('Invalid request body.');
  return value as Record<string, unknown>;
}

/** Maps validation failures from the shared module to a plain 400; other errors keep their own handling. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof VaultError) throw new UserError(error.message, error.code === 'unsupported' ? 422 : 400);
    throw error;
  }
}

/** Old clients (and anything else) hitting the retired plaintext endpoint get this and nothing else. */
export function upgradeRequired(): Response {
  return json({ error: 'This version of the app can no longer open portfolios. Update the app to continue.', code: 'upgrade-required' }, 426);
}

export async function getVault(db: D1Database, owner: string): Promise<Response> {
  return json({ vault: await readVault(db, owner) } satisfies VaultResponse);
}

export async function postVault(db: D1Database, owner: string, req: Request): Promise<Response> {
  const body = (await readJsonBody(req)) as Partial<VaultSetupRequest>;
  guard(() => {
    validateVaultKeyMaterial(body.material);
    validateEnvelope(body.envelope);
  });
  const { material, envelope } = body as VaultSetupRequest;
  if (material.wrapperVersion !== 0 && material.wrapperVersion !== 1) throw new UserError('Invalid vault.');
  if (envelope.vaultId !== material.vaultId || envelope.keyVersion !== material.keyVersion || envelope.revision !== 1)
    throw new UserError('Invalid vault.');
  const result = await setupVault(db, owner, material, envelope);
  if (result === 'exists') throw new UserError('A vault already exists for this account.', 409, 'vault-exists');
  const vault = (await readVault(db, owner))!;
  return json({ vault, revision: 1 } satisfies VaultSetupResponse, 201);
}

export async function putVaultWrappers(db: D1Database, owner: string, req: Request): Promise<Response> {
  const body = (await readJsonBody(req, 64_000)) as Partial<VaultWrappersRequest>;
  if (!Number.isInteger(body.expectedWrapperVersion) || (body.expectedWrapperVersion as number) < 0) throw new UserError('Invalid request.');
  if (!body.password && !body.recovery) throw new UserError('Nothing to update.');
  const current = await readVault(db, owner);
  if (!current) throw new UserError('No vault exists for this account.', 404, 'no-vault');
  // Shape and limit checks on the replacement wrappers, against the stored vault identity.
  guard(() =>
    validateVaultKeyMaterial({
      ...current,
      password: body.password ?? current.password,
      recovery: body.recovery ?? current.recovery,
    }),
  );
  const version = await updateWrappers(db, owner, body as VaultWrappersRequest);
  if (version === null) throw new UserError('Your vault keys changed on another device. Reload and try again.', 409, 'wrapper-conflict');
  return json({ wrapperVersion: version } satisfies VaultWrappersResponse);
}

export async function deleteOwnVault(db: D1Database, owner: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req, 1_000);
  if (body.confirm !== true) throw new UserError('Confirm that you want to permanently erase your vault.');
  await deleteVault(db, owner);
  return json({ deleted: true });
}

export async function getCiphertext(db: D1Database, owner: string): Promise<Response> {
  const [vault, stored] = [await readVault(db, owner), await readCiphertext(db, owner)];
  if (!vault || !stored) throw new UserError('Set up your vault to open your portfolio.', 404, 'no-vault');
  return json({ vaultId: vault.vaultId, revision: stored.revision, envelope: stored.envelope, updatedAt: stored.updatedAt } satisfies EncryptedPortfolioResponse);
}

export async function putCiphertext(db: D1Database, owner: string, req: Request): Promise<Response> {
  const body = (await readJsonBody(req)) as Partial<SaveEncryptedPortfolioRequest>;
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) throw new UserError('Invalid revision.');
  guard(() => validateEnvelope(body.envelope));
  const { envelope, expectedRevision } = body as SaveEncryptedPortfolioRequest;
  if (envelope.revision !== expectedRevision + 1) throw new UserError('Invalid revision.');
  if (!(await saveCiphertext(db, owner, envelope, expectedRevision)))
    throw new UserError('Your portfolio changed in another tab or device. Reload before saving.', 409, 'conflict');
  return json({ revision: envelope.revision } satisfies SaveEncryptedPortfolioResponse);
}
