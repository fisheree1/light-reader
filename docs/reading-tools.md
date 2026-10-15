# Reading stats, dictionary, and read-aloud

These features build on data LightReader already keeps locally. None of them
needs an account or a network connection.

## Reading stats (`/stats`)

Reading sessions are recorded while a book is open (`reading_sessions` in
SQLite, `readingSessions` in IndexedDB). The stats page derives everything from
them:

- **Totals**: reading time, session count, and books read.
- **Heatmap**: the last 26 weeks, one square per local calendar day, Monday
  first. A session counts on the day it starts. Colour levels are relative to
  the busiest day in the window.
- **Per-book time**: totals for books still in the library, most read first.
- **Daily goal**: 5–600 minutes per day, stored as `reading_goal_v1` in
  `app_meta` (desktop) or the `reading-goal` settings record (Web). With a
  goal, the streak counts consecutive days that met it; without one, any
  reading day counts. Not having read yet today does not break a streak.

Repository queries are bounded: the page reads only sessions from the heatmap
window plus aggregate totals.

## Offline dictionary

Users import StarDict dictionaries in **Settings → Offline dictionaries** by
selecting the `.ifo`, `.idx`, and `.dict.dz` files together (`.syn` is
optional). The import:

1. checks the `.ifo` header: it must name the dictionary, declare at least two
   words, and use a single `sametypesequence` of `m`, `t`, `y`, `h`, `g`, or
   `x`;
2. opens the files with foliate-js `StarDict` (DictZip chunks are inflated with
   fflate) to reject damaged files;
3. copies the files to managed storage — `AppData/light-reader/dictionaries/<id>/`
   on desktop, the existing IndexedDB file store on the Web — and adds the
   dictionary to a small registry (`dictionaries_v1` in `app_meta`, or the
   `dictionaries` settings record).

Lookups normalize the selection (trim punctuation, at most 4 words and 64
characters), try simple English base forms (`studies` → `study`), and include
`.syn` synonyms. HTML, Pango, and XDXF definitions are reduced to plain text so
dictionary content never becomes live DOM. A malformed synonym index or entry
in one dictionary does not hide results from the others.

Known limitation: dictionary files are not part of full backups. After a
restore on a new device, re-import the dictionaries; a registry entry whose
files are missing reports a read error in the lookup panel.

## Read-aloud

The selection toolbar and the dictionary panel can read text aloud with the
system voices through `speechSynthesis`. Text is split into sentence-sized
utterances because some engines stop long utterances silently. The language
comes from the book metadata, otherwise from the script of the text. When the
platform has no speech synthesis, the buttons are hidden.
