// The vault session shared by the web app and the mobile app: unlock, encrypted load/save, password change,
// recovery, lock. Transport (fetch / the mobile API client) and the ciphertext cache are injected, so this runs
// unchanged in browsers, Hermes and Node tests. Nothing here talks to a server about plaintext: every request
// body is key material or an envelope.
//
// Safety rules enforced here (the UIs rely on them):
//  - Keys live only in this object's memory. `lock()` zeroes the data key and invalidates every in-flight call:
//    a request that finishes after a lock rejects with VaultLockedError instead of handing data back or writing.
//  - A save encrypts for revision+1 and the server applies it only if the revision is still current (409 otherwise).
//    There is no queued/offline write path: an unreachable server is an error the caller must show.
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
import { blankPortfolio, type Portfolio } from './portfolio.ts';
import { createBackupPackage, type BackupPackage } from './vault-backup.ts';
import {
  VaultError,
  createVaultKeys,
  decodeRecoverySecret,
  decryptPortfolio,
  encryptPortfolio,
  unwrapWithPassword,
  unwrapWithRecovery,
  wrapWithPassword,
  wrapWithRecovery,
  type PortfolioEnvelope,
  type RecoveryWrapper,
  type VaultKeyMaterial,
} from './vault-crypto.ts';

/** HTTP-level failure from the transport. `status` 0 means the server could not be reached. */
export class TransportError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
    this.code = code;
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('The vault was locked. Unlock it to continue.');
    this.name = 'VaultLockedError';
  }
}

/** A save lost the race with another tab or device. Reload before changing anything. */
export class ConflictError extends Error {
  constructor(message = 'Your portfolio changed in another tab or device. Reload before saving.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export type VaultTransport = {
  getVault(): Promise<VaultResponse>;
  postVault(request: VaultSetupRequest): Promise<VaultSetupResponse>;
  putWrappers(request: VaultWrappersRequest): Promise<VaultWrappersResponse>;
  deleteVault(): Promise<void>;
  getPortfolio(): Promise<EncryptedPortfolioResponse>;
  putPortfolio(request: SaveEncryptedPortfolioRequest): Promise<SaveEncryptedPortfolioResponse>;
};

/** What a device may keep to unlock offline: ciphertext and wrappers only. Never keys, passwords or plaintext. */
export type CachedVault = { vault: VaultResponse['vault']; portfolio: EncryptedPortfolioResponse | null };
export type VaultCache = {
  read(): Promise<CachedVault | null>;
  write(value: CachedVault): void | Promise<void>;
  clear(): void | Promise<void>;
};

const memoryCache = (): VaultCache => ({ read: async () => null, write() {}, clear() {} });

export const isOffline = (error: unknown) => error instanceof TransportError && error.status === 0;

export type VaultStatus =
  | { state: 'none' }
  | { state: 'locked'; vault: NonNullable<VaultResponse['vault']>; portfolio: EncryptedPortfolioResponse | null; offline: boolean };

/** Reads the vault metadata (and the ciphertext) the client needs to unlock. Falls back to the device cache offline. */
export async function loadVaultStatus(transport: VaultTransport, cache: VaultCache = memoryCache()): Promise<VaultStatus> {
  try {
    const { vault } = await transport.getVault();
    if (!vault) {
      await cache.clear();
      return { state: 'none' };
    }
    let portfolio: EncryptedPortfolioResponse | null = null;
    try {
      portfolio = await transport.getPortfolio();
    } catch (error) {
      if (!(error instanceof TransportError && error.code === 'no-vault')) throw error;
    }
    await cache.write({ vault, portfolio });
    return { state: 'locked', vault, portfolio, offline: false };
  } catch (error) {
    if (!isOffline(error)) throw error;
    const cached = await cache.read();
    if (cached?.vault) return { state: 'locked', vault: cached.vault, portfolio: cached.portfolio, offline: true };
    throw error;
  }
}

export type PreparedVault = {
  /** Show once, make the person confirm they saved it, and never persist it. */
  recoverySecret: string;
  /** Nothing has been sent to the server yet. */
  finish(): Promise<VaultSession>;
  /** Drops the generated keys without creating anything. */
  discard(): void;
};

/**
 * Generates a vault locally: keys, wrappers, recovery secret and the encrypted blank portfolio. Nothing is uploaded
 * until `finish()`, which the UI calls only after the person confirmed the recovery secret.
 */
export async function prepareVault(transport: VaultTransport, password: string, cache: VaultCache = memoryCache()): Promise<PreparedVault> {
  const keys = await createVaultKeys(password);
  const material: VaultKeyMaterial = { ...keys.material, wrapperVersion: 1 };
  const portfolio = blankPortfolio();
  const envelope = await encryptPortfolio(keys.dataKey, material.vaultId, material.keyVersion, 1, JSON.stringify(portfolio));
  let done = false;
  return {
    recoverySecret: keys.recoverySecret,
    async finish() {
      if (done) throw new Error('This vault was already created.');
      done = true;
      let created: VaultSetupResponse;
      try {
        created = await transport.postVault({ material, envelope });
      } catch (error) {
        keys.dataKey.fill(0);
        throw error;
      }
      const session = new VaultSession(transport, cache, created.vault, keys.dataKey, { revision: 1, portfolio });
      await cache.write({ vault: created.vault, portfolio: { vaultId: material.vaultId, revision: 1, envelope, updatedAt: created.vault.createdAt } });
      return session;
    },
    discard() {
      done = true;
      keys.dataKey.fill(0);
    },
  };
}

/** Opens a vault with the password, or (recovery) with the recovery key. Authentication alone never opens one. */
export async function unlockVault(
  transport: VaultTransport,
  status: Extract<VaultStatus, { state: 'locked' }>,
  secret: { password: string } | { recovery: string },
  cache: VaultCache = memoryCache(),
): Promise<VaultSession> {
  const dataKey = 'password' in secret ? await unwrapWithPassword(status.vault, secret.password) : await unwrapWithRecovery(status.vault, secret.recovery);
  return openWithKey(transport, status, dataKey, cache);
}

/**
 * Opens a vault with an already-unwrapped data key (the opt-in "stay unlocked in this tab" path). Takes ownership of
 * `dataKey`: it is zeroed if the stored portfolio does not decrypt with it.
 */
export async function openWithKey(
  transport: VaultTransport,
  status: Extract<VaultStatus, { state: 'locked' }>,
  dataKey: Uint8Array,
  cache: VaultCache = memoryCache(),
): Promise<VaultSession> {
  try {
    const stored = status.portfolio;
    if (!stored) throw new VaultError('invalid', 'No encrypted portfolio was found for this vault.');
    const plain = await decryptPortfolio(dataKey, stored.envelope, { vaultId: status.vault.vaultId, keyVersion: status.vault.keyVersion, revision: stored.revision });
    const portfolio = parsePortfolio(plain);
    return new VaultSession(transport, cache, status.vault, dataKey, { revision: stored.revision, portfolio }, status.offline);
  } catch (error) {
    dataKey.fill(0);
    throw error;
  }
}

function parsePortfolio(text: string): Portfolio {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VaultError('tampered', 'The decrypted portfolio is not readable.');
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as Portfolio).companies))
    throw new VaultError('tampered', 'The decrypted portfolio is not readable.');
  return value as Portfolio;
}

type State = { revision: number; portfolio: Portfolio };

export class VaultSession {
  private key: Uint8Array | null;
  private epoch = 0;
  private listeners = new Set<() => void>();
  private material: NonNullable<VaultResponse['vault']>;
  /** True while the session was opened from the device cache because the server was unreachable. */
  offline: boolean;
  revision: number;
  portfolio: Portfolio;

  private transport: VaultTransport;
  private cache: VaultCache;

  constructor(
    transport: VaultTransport,
    cache: VaultCache,
    material: NonNullable<VaultResponse['vault']>,
    dataKey: Uint8Array,
    state: State,
    offline = false,
  ) {
    this.transport = transport;
    this.cache = cache;
    this.key = dataKey;
    this.material = material;
    this.revision = state.revision;
    this.portfolio = state.portfolio;
    this.offline = offline;
  }

  get vaultId() {
    return this.material.vaultId;
  }
  get wrapperVersion() {
    return this.material.wrapperVersion;
  }
  get active() {
    return this.key !== null;
  }
  /** Calls `fn` when the session locks. Returns the unsubscribe function. */
  onLock(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Zeroes the key (best effort in a JavaScript runtime), drops decrypted state, and invalidates in-flight calls. */
  lock() {
    if (!this.key) return;
    this.key.fill(0);
    this.key = null;
    this.epoch++;
    this.portfolio = blankPortfolio();
    this.revision = 0;
    for (const fn of [...this.listeners]) fn();
    this.listeners.clear();
  }

  /** A copy of the data key, only for the opt-in tab keep-alive (lib/vault-tab-keep.ts). The caller must zero it. */
  exportKey(): Uint8Array {
    return new Uint8Array(this.requireKey());
  }

  private requireKey(): Uint8Array {
    if (!this.key) throw new VaultLockedError();
    return this.key;
  }

  /** Runs `work`; if the session locked (or was replaced) meanwhile, its result is discarded. */
  async guarded<T>(work: () => Promise<T>): Promise<T> {
    this.requireKey();
    const epoch = this.epoch;
    let result: T;
    try {
      result = await work();
    } catch (error) {
      // Work that was cut off by a lock fails in odd ways (the key was zeroed under it): report the lock.
      if (this.epoch !== epoch || !this.key) throw new VaultLockedError();
      throw error;
    }
    if (this.epoch !== epoch || !this.key) throw new VaultLockedError();
    return result;
  }

  /** Throws if the session locked since `epoch` was read, so a late callback can never write state. */
  private assertCurrent(epoch: number) {
    if (this.epoch !== epoch || !this.key) throw new VaultLockedError();
  }

  /** Re-reads and decrypts the stored portfolio (a reload). Never merges with local state. */
  async reload(): Promise<{ portfolio: Portfolio; revision: number }> {
    return this.guarded(async () => {
      const key = this.requireKey();
      const epoch = this.epoch;
      let stored: EncryptedPortfolioResponse;
      try {
        stored = await this.transport.getPortfolio();
      } catch (error) {
        if (!isOffline(error)) throw error;
        // Offline: keep what is already open rather than failing the whole screen.
        this.offline = true;
        return { portfolio: this.portfolio, revision: this.revision };
      }
      const plain = await decryptPortfolio(key, stored.envelope, { vaultId: this.material.vaultId, keyVersion: this.material.keyVersion, revision: stored.revision });
      const portfolio = parsePortfolio(plain);
      this.assertCurrent(epoch);
      this.offline = false;
      this.portfolio = portfolio;
      this.revision = stored.revision;
      await this.cache.write({ vault: this.material, portfolio: stored });
      return { portfolio, revision: stored.revision };
    });
  }

  /**
   * Encrypts `next` for `expectedRevision + 1` and stores it only if the server still has `expectedRevision`.
   * Throws ConflictError on a lost race (nothing is written), VaultLockedError if locked meanwhile.
   */
  async save(next: Portfolio, expectedRevision: number): Promise<number> {
    return this.guarded(async () => {
      const key = this.requireKey();
      const epoch = this.epoch;
      const envelope = await encryptPortfolio(key, this.material.vaultId, this.material.keyVersion, expectedRevision + 1, JSON.stringify(next));
      try {
        const saved = await this.transport.putPortfolio({ envelope, expectedRevision });
        this.assertCurrent(epoch);
        this.portfolio = next;
        this.revision = saved.revision;
        await this.cache.write({ vault: this.material, portfolio: { vaultId: this.material.vaultId, revision: saved.revision, envelope, updatedAt: new Date().toISOString() } });
        return saved.revision;
      } catch (error) {
        if (error instanceof TransportError && error.status === 409) throw new ConflictError();
        throw error;
      }
    });
  }

  private async putWrappers(update: { password?: VaultKeyMaterial['password']; recovery?: RecoveryWrapper }) {
    const epoch = this.epoch;
    const { wrapperVersion } = await this.transport.putWrappers({ expectedWrapperVersion: this.material.wrapperVersion, ...update });
    this.assertCurrent(epoch);
    this.material = {
      ...this.material,
      wrapperVersion,
      password: update.password ?? this.material.password,
      recovery: update.recovery ?? this.material.recovery,
    };
    const stored = (await this.cache.read())?.portfolio ?? null;
    await this.cache.write({ vault: this.material, portfolio: stored });
  }

  /**
   * Ordinary password change: rewraps the SAME data key with a fresh salt and nonce. It does not revoke wrapper
   * copies or keys already disclosed to someone, so it is not a response to a compromised key.
   */
  async changePassword(currentPassword: string, newPassword: string) {
    return this.guarded(async () => {
      // Re-verify the current password so a borrowed unlocked session cannot silently change it.
      const check = await unwrapWithPassword(this.material, currentPassword);
      check.fill(0);
      const wrapper = await wrapWithPassword(this.requireKey(), this.material.vaultId, this.material.keyVersion, newPassword);
      await this.putWrappers({ password: wrapper });
    });
  }

  /** Replaces the password wrapper after a recovery-key unlock (the current password is unknown). */
  async replacePasswordAfterRecovery(newPassword: string) {
    return this.guarded(async () => {
      const wrapper = await wrapWithPassword(this.requireKey(), this.material.vaultId, this.material.keyVersion, newPassword);
      await this.putWrappers({ password: wrapper });
    });
  }

  /**
   * The encrypted backup package: the vault's wrapped keys and the stored ciphertext, readable without the server
   * by anyone holding the password or recovery key. Falls back to the device's cached ciphertext when offline.
   */
  async backupPackage(): Promise<BackupPackage> {
    return this.guarded(async () => {
      let stored: EncryptedPortfolioResponse | null = null;
      try {
        stored = await this.transport.getPortfolio();
      } catch (error) {
        if (!isOffline(error)) throw error;
        stored = (await this.cache.read())?.portfolio ?? null;
      }
      if (!stored) throw new Error('No encrypted portfolio is available to back up yet.');
      return createBackupPackage(this.material, stored);
    });
  }

  /** Step 1 of replacing the recovery key: generate it locally. Nothing changes until `commitRecovery`. */
  async prepareRecovery() {
    return this.guarded(async () => {
      const { wrapper, recoverySecret } = await wrapWithRecovery(this.requireKey(), this.material.vaultId, this.material.keyVersion);
      return { recoverySecret, wrapper };
    });
  }
  /** Step 2, after the person confirmed they saved the new secret. */
  async commitRecovery(prepared: { wrapper: RecoveryWrapper }) {
    return this.guarded(() => this.putWrappers({ recovery: prepared.wrapper }));
  }
}

/**
 * Forgotten password: open with the recovery key, then replace the password wrapper locally. The recovery secret
 * keeps working afterwards (replacing it is a separate, confirmed step).
 */
export async function recoverWithKey(
  transport: VaultTransport,
  status: Extract<VaultStatus, { state: 'locked' }>,
  recoverySecret: string,
  newPassword: string,
  cache: VaultCache = memoryCache(),
): Promise<VaultSession> {
  decodeRecoverySecret(recoverySecret);
  if (status.offline) throw new TransportError('Reconnect to the internet to reset your password.', 0);
  const session = await unlockVault(transport, status, { recovery: recoverySecret }, cache);
  try {
    await session.replacePasswordAfterRecovery(newPassword);
    return session;
  } catch (error) {
    session.lock();
    throw error;
  }
}

export type { PortfolioEnvelope };
