# Multiple portfolios

Implemented on web and mobile. The account owns one versioned encrypted collection; each named portfolio retains the existing ledger shape. All portfolios is a derived, read-only view. Cost basis, stock splits, oversells and taxes are calculated independently before combining results. Missing prices and unknown costs remain explicitly incomplete. Expected dividends do not count as received income.

## Compatibility and release

No database migration is needed. Legacy decrypted documents are wrapped as My Portfolio without editing their records. The collection is persisted on the next accepted save using the existing ciphertext envelope, vault key and optimistic account revision. Names and financial records stay encrypted. Public lookups receive only the union of ticker symbols.

Deploy the web client and `/api/v3/portfolio` together, and release the updated native app. The previous `/api/v2/portfolio` now returns HTTP 426 for both reads and writes, preventing old clients from replacing a collection with one ledger. An old mobile build must update before it can sync. Do not roll back to a server that permits v2 writes after accounts have saved collections. Preserve the v2 barrier and collection-aware client when reverting unrelated changes.

Back up the encrypted account before rollout. Full-account restores explicitly replace the entire collection. Legacy single-ledger backups ask for a destination. Deleting all portfolio data in web settings still clears the whole account; deleting one portfolio is allowed only when it contains no financial history.

## Verification

- Full root suite: 725 passed, one skipped, zero failed. Includes record-preserving legacy migration, isolated cost basis and sales, missing values, duplicate matching, concurrent device conflicts, ciphertext privacy, offline lock handling and full-account backup restoration.
- Mobile unit suite: 148 passed.
- Web and mobile TypeScript checks pass. Production build passes.
- Isolated local browser account using fictional AHL and Finqalab records: confirmed consolidated totals and per-portfolio cost breakdown, creation, import to a new destination, duplicate warning across portfolios, and cancellation with unchanged records. No production account or remote database was modified.
- Native-device interactions have not been exercised. Finqalab PDF import remains available on web; existing native JSON import support is preserved.

Not deployed by this implementation task.
