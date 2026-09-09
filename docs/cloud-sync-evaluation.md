# Cloud sync evaluation

Status: evaluation complete; implementation is not started.

This document records the architecture decision for optional cloud sync.
LightReader must remain fully usable without an account or network connection.
This evaluation does not select a vendor, add an SDK, create network
capabilities, or change the database schema. AI product and architecture work
is tracked separately in [`ai-agent-development.md`](ai-agent-development.md).

## Decision summary

| Capability                      | Decision              | Reason                                                                                                                                                         |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud sync                      | Conditional go        | Existing domain IDs and Repository boundaries are reusable, but revisions, tombstones, atomic change capture, key recovery, and conflict UX are prerequisites. |
| Encrypted book-file sync        | Defer to sync phase 2 | It needs resumable encrypted chunks, capacity controls, and local path reconstruction. Metadata and user data should prove reliable first.                     |
| Collaborative rich-text editing | Out of scope          | Whole-document conflict copies are safer and much cheaper than introducing a CRDT before real-time collaboration is a product requirement.                     |

The first cloud release must be opt-in, end-to-end encrypted, and metadata-only
for managed book binaries.

## Current readiness

LightReader already has useful foundations:

- books, notes, annotations, bookmarks, and reading sessions are created with
  `crypto.randomUUID()` and keep their IDs after creation;
- EPUB and PDF locators and Tiptap note documents are versioned;
- syncable user records generally have `createdAt` and `updatedAt` values;
- SQLite access is isolated behind domain Repositories, while filesystem and
  native operations are isolated behind services and platform adapters;
- full backups already model managed book and cover assets separately from the
  database; and
- local search tables are derived data and can be rebuilt instead of synced.

The current model is not yet safe to sync:

- `updatedAt` is a device wall-clock value and cannot prove causal order;
- updates do not carry an expected base revision, so a late offline write could
  silently overwrite a newer remote write;
- deletes are hard deletes, including cascades from books, so another device
  could resurrect removed data;
- no durable outbox records a local mutation in the same SQLite transaction;
- reading sessions have a stable ID but no general revision field;
- tags use `(bookId, tag)` as their identity and replacement currently appears
  as a delete followed by inserts;
- managed `filePath` and `coverPath` values are device-local and must never be
  treated as cross-device identifiers; and
- browser-only note recovery drafts are crash-recovery state, not canonical
  data, and should remain device-local.

### Entity policy

| Entity                 | Stable identity                                                                      | Initial sync policy                                                                                  | Conflict policy                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Book metadata          | Existing opaque book ID; encrypted file hash assists client-side duplicate detection | Sync metadata; keep managed paths local; book bytes are opt-in later                                 | Three-way merge non-overlapping fields; surface same-field conflicts                                   |
| Tags                   | `(bookId, normalizedTag)`                                                            | Sync set membership and tombstones                                                                   | Merge independent additions/removals from their common base                                            |
| Notes                  | Existing note ID                                                                     | Sync canonical Tiptap JSON, title, and timestamps; do not sync recovery drafts or derived plain text | Three-way merge only when changes do not overlap; otherwise preserve both as an explicit conflict copy |
| Annotations            | Existing annotation ID plus parent book ID                                           | Sync source snapshot, locator, color, and comment                                                    | Merge different fields; retain both versions when the same comment field diverges                      |
| Bookmarks              | Existing bookmark ID plus parent book ID                                             | Sync name and versioned locator                                                                      | Merge different fields; retain an explicit conflict for divergent names/locators                       |
| Reader settings        | `global` or existing book ID                                                         | Sync canonical settings, not UI store state                                                          | Last accepted revision wins; keep the previous value in sync history                                   |
| Reading position       | `(bookId, deviceId)`                                                                 | Keep a per-device position and derive the most recently active position                              | Do not overwrite another device's row; choose at read time using accepted activity order               |
| Reading sessions       | Existing session ID                                                                  | Append a start, then allow one idempotent finish transition                                          | Union by ID; reject a second incompatible finish                                                       |
| FTS indexes and caches | Rebuildable                                                                          | Never sync                                                                                           | Rebuild after remote apply                                                                             |

The production-generated UUIDs are already suitable opaque identifiers. Before
sync is enabled, write validation should consistently enforce the same maximum
length for every syncable ID. Existing development fixtures such as `book-1`
do not need a destructive rewrite. If the same file was independently imported
on two devices, deduplication must compare the decrypted file hash locally and
perform an explicit transactional ID/reference merge; the server must not see
the plaintext hash.

## Sync version and conflict model

`updatedAt` remains useful for display and audit, but it must not decide whether
a write is safe. The synchronization protocol needs three separate concepts:

- stable entity ID: identity for the lifetime of the entity;
- stable mutation ID: generated once and reused for every retry; and
- opaque remote revision: returned after an accepted compare-and-swap write.

A version 1 encrypted mutation can have this conceptual shape:

```ts
interface SyncMutationV1 {
  version: 1;
  mutationId: string;
  deviceId: string;
  entityType: SyncEntityType;
  entityId: string;
  parentEntityId?: string;
  baseRevision: string | null;
  operation: 'upsert' | 'delete';
  encryption: {
    algorithm: 'AES-256-GCM';
    keyVersion: number;
    nonce: string;
    ciphertext: string;
  };
}
```

The encrypted payload contains the domain schema version, `createdAt`,
`updatedAt`, and canonical domain data. Associated authenticated data binds the
account, entity type, entity ID, parent ID, operation, protocol version, and key
version to the ciphertext. Exact serialization and nonce construction must be
owned by a reviewed crypto module and covered by published test vectors; nonce
reuse with the same key is forbidden.

The server accepts a write only when `baseRevision` matches its current opaque
revision. It assigns the next revision and treats `mutationId` as an idempotency
key. A lost response can therefore be retried without applying the mutation
twice. A mismatch returns both encrypted revisions for client-side resolution;
the server never attempts to merge plaintext.

Conflict handling is deliberately conservative:

1. Compare both versions with their common base after decryption.
2. Auto-merge only disjoint fields or set operations with unambiguous intent.
3. Never use wall-clock `updatedAt` alone as last-writer-wins.
4. Preserve divergent note or annotation text as a conflict record or copy.
5. Require a user choice before discarding either meaningful text version.
6. Re-encrypt the resolved value as a new mutation based on the current remote
   revision.

Deletes require tombstones. A tombstone includes the stable entity ID,
encrypted deletion intent, deletion time, and accepted revision. A book
tombstone dominates stale mutations for its book-scoped children. Tombstones
remain until every active registered device has acknowledged them; devices
that have been inactive past the retention window must perform a full resync
before uploading. This prevents an old device from reviving deleted content.

## Boundary that keeps Repository local

Do not add methods such as `sync`, `pushRemote`, `remoteRevision`, or
`resolveConflict` to `BookRepository`, `NoteRepository`, or the other domain
Repository interfaces. Do not let React components call a sync provider.

```text
React feature
  -> existing application service
    -> existing domain Repository -> canonical local tables
                                \-> transactional local change journal

SyncCoordinator
  -> SyncStore -> outbox, inbox, checkpoints, conflicts, tombstones
  -> SyncCrypto -> encrypt/decrypt and key rotation
  -> RemoteSyncGateway -> push/pull opaque envelopes
  -> SyncApplyService -> validate, resolve, apply, rebuild derived indexes
```

The local change journal is a persistence concern adjacent to SQLite, not a
remote-provider concern. A schema-level change-capture mechanism or a local
mutation coordinator must record the entity ID and operation atomically with
the canonical write. If the process crashes, both changes commit or neither
does. The journal stores no provider-specific fields.

`SyncStore` owns only synchronization state. `RemoteSyncGateway` owns the
provider protocol. `SyncApplyService` decrypts data, parses it through the same
domain schemas, applies it through a narrowly tested data-platform boundary,
and suppresses upload echoes inside the same transaction. This maintenance
path is analogous to restore: it may apply validated projections without
changing normal Repository contracts, but it must never become a second casual
write path for UI features.

Recommended local synchronization tables are:

- `sync_devices`: device identity, key version, acknowledgement checkpoint,
  and revocation status;
- `sync_entity_state`: entity ID, local version, accepted remote revision, and
  dirty/conflict state;
- `sync_outbox`: ordered mutations with stable mutation IDs and retry state;
- `sync_inbox`: durable pulled envelopes pending validation/apply;
- `sync_conflicts`: both encrypted/source revisions and resolution state; and
- `sync_tombstones`: durable deletion state and device acknowledgements.

These tables are excluded from domain Repository results, FTS indexing, and
portable database-only backups. Credentials and unwrapped encryption keys are
never included in any backup.

## Encryption and authentication

Cloud storage should use end-to-end encryption in addition to TLS:

- generate a random 256-bit account master key locally;
- encrypt record payloads with an authenticated-encryption algorithm such as
  AES-256-GCM, using unique nonces and authenticated metadata;
- use versioned data-encryption keys so rotation can proceed incrementally;
- keep unwrapped keys and refresh tokens in the operating-system credential
  store, not SQLite, localStorage, logs, or backups;
- enroll a new device by approval from an existing trusted device or by a
  separately displayed recovery secret;
- derive a recovery wrapping key with Argon2id and stored parameters; and
- make it explicit that account-password reset cannot magically recover
  end-to-end encrypted content without a trusted device or recovery secret.

AES-GCM is an authenticated-encryption mode specified by
[NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final). Recovery-key
derivation should follow an audited Argon2id implementation and the parameter
guidance in [RFC 9106](https://datatracker.ietf.org/doc/html/rfc9106), rather
than custom cryptography. The final library and parameter choices require a
focused security review and device benchmarks.

LightReader is a native public client and cannot safely embed a client secret.
Authentication should use the system browser with OAuth 2.0 authorization code
flow and PKCE, short-lived access tokens held in memory, and revocable refresh
tokens held in the OS credential store. This follows the native-app guidance in
[RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) and PKCE definition in
[RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636). Logout stops workers
and removes local credentials and unwrapped keys; deleting local books or
deleting the remote account remains a separate, explicit decision.

End-to-end encryption protects remote content, not the current local SQLite
file or local full-backup archive. Local-at-rest encryption and encrypted
portable backups are separate product decisions and must not be implied by the
cloud privacy message.

The service necessarily sees limited metadata: account and device identifiers,
opaque entity and parent IDs, entity type, operation, ciphertext size,
revisions, and request timing. This leakage must be described in the privacy
notice. File hashes, titles, authors, quotes, notes, locators, search terms, and
book bytes remain inside encrypted payloads.

## Offline queue behavior

Local writes complete without waiting for the network. A durable outbox worker
coalesces safe repeated updates to the same entity, encrypts bounded batches,
and retries with exponential backoff and jitter. It must support:

- offline, paused, syncing, conflict, authentication-required, and error states;
- idempotent retry after a timeout or lost response;
- bounded batch size, queue size, and encrypted-file chunk size;
- restart-safe push and pull checkpoints;
- token expiry, device revocation, key rotation, and corrupted-ciphertext states;
- cancellation and resumable uploads for future book assets; and
- a visible last-success time, pending-item count, and actionable error without
  blocking local reading or editing.

Logging may include mutation IDs, entity types, byte counts, status codes, and
durations. It must not include plaintext payloads, tokens, keys, titles, quotes,
notes, search queries, or full filesystem paths.

## Delivery plan

### P0 — synchronization prerequisites

- Define versioned `SyncMutation`, encrypted payload, conflict, tombstone, and
  checkpoint schemas with strict size limits.
- Add `sync_*` tables in one numbered migration without changing domain
  Repository interfaces.
- Add atomic local change capture and prove crash safety around create, update,
  cascade delete, and note-reference cleanup.
- Add opaque remote revision compare-and-swap and mutation idempotency to a fake
  `RemoteSyncGateway` before choosing a provider.
- Define the key hierarchy, recovery flow, OS credential-store adapter, threat
  model, metadata disclosure, and key-loss UX.
- Build conflict copies and resolution UI for notes and annotation comments.

Acceptance: a process interruption cannot produce an unjournaled committed
domain write; clock skew cannot silently win a conflict; a deleted book cannot
be resurrected by a stale device; and all existing Repository contract tests
pass unchanged.

### P1 — encrypted metadata and user-data sync

- Add explicit account setup, device enrollment/revocation, pause, logout, and
  remote-account deletion flows.
- Sync notes, annotations, bookmarks, settings, positions, sessions, book
  metadata, and tag membership; exclude FTS data, caches, note recovery drafts,
  managed paths, and book binaries.
- Rebuild derived search indexes after applying remote data.
- Add status, pending count, last-success time, retry, and conflict surfaces.
- Test two-device offline edit/delete conflicts, duplicate imports, response
  loss, restart, token expiry, key rotation, corrupt ciphertext, and a queue of
  at least 10,000 coalescible mutations.

Acceptance: the app remains fully usable offline; every remote request is
encrypted; repeated delivery is idempotent; meaningful text is never silently
discarded; and disabling sync requires no domain Repository replacement.

### P2 — opt-in encrypted book assets

- Add capacity preflight, user-selectable books, resumable bounded chunks,
  authenticated manifests, checksum verification, and local managed-path
  reconstruction.
- Reuse full-backup asset validation rules where possible, without sharing
  credentials or remote protocol code with backup.
- Handle same-hash imports, unsupported formats, interrupted transfers,
  conflicts with existing local assets, and explicit remote-file deletion.

Acceptance: a new device can restore a readable library without receiving an
absolute path; corrupt or incomplete assets never replace a valid local file.

## Go/no-go gates

Cloud sync must not ship until all of the following are demonstrated:

- atomic local mutation capture, revisions, tombstones, idempotency, and full
  two-device conflict tests;
- reviewed cryptographic design, recovery flow, token/key storage, device
  revocation, and metadata disclosure;
- no provider or sync concept in a domain Repository interface; and
- offline reading, editing, import, export, and backup remain available with no
  account.
