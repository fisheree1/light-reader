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
returns a `LibraryBook` domain object, including `progress` (the saved
`reading_states.progression`, 0–1, or `null` when the reader reported none). It
supports local title, author, tag, and series-name matching (SQLite reads the
series with `json_extract`), an optional favorites filter, a reading-status
filter, and three deterministic orders.

Reading status comes from `readingStatus` (`domain/reading-status.ts`): no
reading state means not started, and progress at or above `FINISHED_PROGRESS`
(0.98, since paginated readers rarely report exactly 1 on the last page) means
finished. Everything else is "reading". Cards show the floored percentage with
a progress bar, or "已读完". The orders are:

- `recent`: books with reading state first, newest read first; unread books use
  newest-added order.
- `added`: newest `books.created_at` first.
- `title`: Unicode title order using SQLite `NOCASE`, with added time as a
  deterministic tie breaker.

## Editing details and series

`LibraryRepository.updateDetails` changes the shelf title, author, and series.
The file and the metadata parsed from it (`metadata.title`, `creators`, and so
on) stay unchanged. On desktop it is a single `UPDATE books` statement that
rewrites `metadata_json`, so it needs no transaction. On the Web it is one
IndexedDB `put`. No migration is involved: the series lives in
`metadata_json` as `series: { title, index } | null`.

`series` is set in three ways:

- **Import:** read from an EPUB 3 `belongs-to-collection` of type `series`
  (with `group-position`), otherwise from Calibre's `calibre:series` and
  `calibre:series_index`. Online discovery writes both for every fetched
  volume, using the work title and the volume's catalogue position.
- **User edits:** clearing the series name stores `null`, which means "no
  series".
- **Older fetched volumes:** these have no `series` key at all. They join the
  series of other volumes from the same source work, or are grouped by
  `source:novelId`, with the work title taken from the volume title.

`groupBySeries` (`domain/book-series.ts`) runs on the already sorted list and
places each series where its first member appears. Names match ignoring width,
case, punctuation, and spaces. Volumes are ordered by position, then source
volume ID, then numeric-aware title. A series with only one book on the shelf
shows as a plain book. The shelf's "按系列分组" toggle (on by default, not
persisted) turns grouping off. Each series is collapsed by default, counts its
finished volumes, and offers "continue": the most recently read volume, or the
next unfinished volume once that one is finished, else the first volume.

## Delete modes

Both modes remove the managed EPUB or PDF and its cover, then delete the `books` record. SQLite
foreign keys then remove book-owned reading state, reader overrides,
annotations, tags, and indexed EPUB chapters.

- `delete-all` additionally walks versioned Tiptap JSON and removes only
  `bookQuote` nodes whose `bookId` matches. Other note text and references are
  retained. The changed note JSON, derived plain text, and book deletion are
  committed in one SQLite transaction.
- `keep-note-references` leaves independent note JSON unchanged, so quote,
  chapter, and locator snapshots remain available. Since the book is gone,
  those snapshots can no longer navigate to the original book.

The dialog first asks the user to choose one of these effects. A separate
confirmation view explains the exact impact and requires a second click.

## File and database failure protocol

Deletion never trusts a user-supplied target path. The stored path must exactly
match `light-reader/books/<book-id>/book.epub` or
`light-reader/books/<book-id>/book.pdf`; an optional cover must match
`light-reader/covers/<book-id>.(gif|jpeg|png|webp)`.

1. Write a validated `deletion.json` journal containing only the generated book
   ID and managed cover path.
2. Rename the managed book directory and cover into
   `light-reader/trash/<deletion-id>/`.
3. Execute note-reference updates and book deletion in one SQLite transaction
   on one native connection. This avoids leaving `BEGIN IMMEDIATE` on one SQL
   plugin pool connection while a later statement waits on another connection.
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
