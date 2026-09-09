# Course import — how the institute fills this in

Send the institute TWO files: `courses-template.csv` to fill in, and a
`reference-values.csv` generated from the live database so they copy the
spellings the system already uses (teachers, subjects, grades and streams are
already entered — a retyped name creates a duplicate teacher, not a match):

```bash
npx tsx prisma/import-courses.ts ~/reference-values.csv --reference   # regenerate the companion sheet
npx tsx prisma/import-courses.ts <filled.csv>                         # dry run — reads only, writes NOTHING
npx tsx prisma/import-courses.ts <filled.csv> --commit                # writes, once the dry run looks right
```

Keep the filled sheet and the reference sheet OUT of this repository — it is
public, and both carry real teacher names. `.gitignore` covers the obvious
filenames, but the safe habit is to keep them in your home directory.

Both runs print the same report. Re-running `--commit` on the same file creates
nothing new — courses are matched on teacher + subject + grade + class type
(+ course name), schedules on the course + day + start time.

## The columns

| Column | Required | What it means |
|---|---|---|
| `teacher` | yes | Copy from the `teacher` column of the reference sheet. A name not already there creates a NEW teacher — which is right for a new hire and wrong for a typo. |
| `subject` | yes | Copy from the reference sheet (ICT, Chemistry, Sinhala …). Created if genuinely new. |
| `grade` | yes | Copy from the reference sheet (`AL2027`, `G11`, `OL` …). Created if genuinely new. |
| `stream` | yes | Copy from the reference sheet (`AL Tech`, `AL Maths`, `6-11` …). Created if genuinely new. |
| `class_type` | yes | `THEORY`, `PAPER` or `REVISION`. |
| `fee` | yes | The monthly fee, numbers only (`2500`, not `Rs. 2,500`). |
| `institute_share_percent` | yes | The institute's cut of this course, e.g. `25`. Per course — it is genuinely different per teacher. |
| `day` | no | `MON`…`SUN` (or `Monday`). Leave the day/time columns blank for a course with no fixed slot yet. |
| `start_time` / `end_time` | with `day` | 24-hour `HH:mm` — `15:00`, not `3.00 pm`. |
| `hall` | no | One of the eleven hall names. Blank = no room yet; staff assign it later. |
| `course_name` | no | Only when two courses would otherwise look identical (e.g. two batches of the same class). |

## Rules that matter

- **One row per slot.** A class that meets Monday and Thursday is TWO rows with
  everything else identical — that becomes one course with two schedules.
- **Delete the three `EXAMPLE - …` rows** before filling it in. The importer
  skips them, but they are there to show the shape, not to be imported.
- **Nothing is invented.** A row missing something required is reported and
  skipped, never guessed at. Blank optional cells stay blank.
- **Watch the spelling report.** The importer lists every new teacher, subject,
  grade and stream it would create, flags names inside the file that differ
  only by case or spacing (`E-Tech` vs `E- Tech`), and flags a new name that
  looks like one already in the system (`Tech` arriving where `AL Tech`
  exists). That is where duplicates come from.
- **A dry run refuses nothing and writes nothing.** `--commit` refuses outright
  while any row still has a problem, so a partly-broken sheet cannot go in half
  imported.
- Attendance windows default to 30 minutes before the start and 30 before the
  end; adjust them per schedule in Setup → Schedules afterwards.
