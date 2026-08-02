# Library management

Library management stays behind `LibraryManagementService`. React owns only
query controls, pending state, confirmation state, and notices; it does not
issue SQL or filesystem calls.

## Persistent model

Migration `0008_library_management.sql` adds a checked `books.favorite`
integer and `book_tags(book_id, tag, created_at)`. A tag is trimmed, contains
1–40 characters, and is unique per book. The TypeScript boundary validates and
normalizes a maximum of 20 tags, including case-insensitive duplicate removal.
The `book_tags` foreign key cascades when its book is deleted.

`LibraryRepository.list` joins the latest `reading_states.updated_at` value and
returns a `LibraryBook` domain object. It supports local title, author, and tag
matching, an optional favorites filter, and three deterministic orders:

- `recent`: books with reading state first, newest read first; unread books use
  newest-added order.
- `added`: newest `books.created_at` first.
- `title`: Unicode title order using SQLite `NOCASE`, with added time as a
  deterministic tie breaker.

## Delete modes

Both modes remove the managed EPUB/cover and delete the `books` record. SQLite
foreign keys then remove book-owned reading state, reader overrides,
annotations, tags, and indexed EPUB chapters.

- `delete-all` additionally walks versioned Tiptap JSON and removes only
  `bookQuote` nodes whose `bookId` matches. Other note text and references are
  retained. The changed note JSON, derived plain text, and book deletion are
  committed in one SQLite transaction.
- `keep-note-references` leaves independent note JSON unchanged, so quote,
  chapter, and locator snapshots remain available. Since the book is gone,
  those snapshots can no longer navigate to the original EPUB.

The dialog first asks the user to choose one of these effects. A separate
confirmation view explains the exact impact and requires a second click.

## File and database failure protocol

Deletion never trusts a user-supplied target path. The stored path must exactly
match `light-reader/books/<book-id>/book.epub`; an optional cover must match
`light-reader/covers/<book-id>.(gif|jpeg|png|webp)`.

1. Write a validated `deletion.json` journal containing only the generated book
   ID and managed cover path.
2. Rename the managed book directory and cover into
   `light-reader/trash/<deletion-id>/`.
3. Execute note-reference updates and book deletion in one SQLite transaction.
4. If SQLite fails, rename every staged file back and report a safe error.
5. If SQLite commits, recursively remove the quarantine directory.

This order keeps database failure recoverable without making an already
committed database record point at a user-visible EPUB. If final quarantine
cleanup fails, the book remains deleted and the service reports a cleanup
warning; quarantined files are outside every active book path.

Before the SQL plugin runs migrations on the next process start, Rust scans
only this controlled trash directory. A journal whose book row still exists is
rolled back to the generated live paths; a journal whose book row is gone is a
committed deletion and is removed. Unsafe/corrupt journals never supply a
filesystem target and block reconciliation instead of guessing. This closes
the process-exit window between file staging and the SQLite commit.

The official Tauri single-instance plugin is registered before every other
plugin on desktop platforms. This prevents a second Windows/Linux process from
reconciling another live process's quarantine operation; a second launch simply
focuses the existing main window. The plugin has no JavaScript API and requires
no capability entry.

Existing Tauri capabilities already permit only the app-owned
`$APPDATA/light-reader/**` scope and the specific `exists`, `mkdir`, `rename`,
`remove`, `read-file`, and `write-file` operations. No capability expansion is
needed for this feature.
