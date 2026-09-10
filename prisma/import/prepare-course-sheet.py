"""Turn the institute's course workbook into the importer's CSV.

  python3 prisma/import/prepare-course-sheet.py <sheet.xlsx> <out.csv> [--hold 11,40,69]

Two jobs, both of which must never guess:

  * TIMES. The sheet is filled by hand, so times arrive as "3.00 pm", "10.30
    am", and occasionally as things that are not times at all ("30.30 pm",
    "6.30. pm"). The clean ones are converted to 24-hour; a row whose time
    cannot be read keeps the COURSE but loses the slot — day and times are
    cleared, so it imports as a course with no timetable yet rather than a
    class that meets at an invented hour. Every one of those is listed.
  * HOLD. Rows whose teacher, grade or subject is still in question are left
    out entirely with `--hold`, because importing one would create the wrong
    teacher or the wrong grade and quietly look finished.

Column ORDER is what matters, not the header text: the institute renames
headers, and the template's order has been stable.
"""
import csv, re, sys, zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
KEYS = ["teacher", "subject", "grade", "stream", "class_type", "fee",
        "institute_share_percent", "day", "start_time", "end_time", "hall", "course_name"]

def col_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def read(path, sheet_index=0):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    sheets = sorted(n for n in z.namelist()
                    if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
    rows = []
    for row in ET.fromstring(z.read(sheets[sheet_index])).iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            t, v, inline = c.get("t"), c.find(f"{NS}v"), c.find(f"{NS}is")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif inline is not None:
                val = "".join(x.text or "" for x in inline.iter(f"{NS}t"))
            elif v is not None:
                val = v.text
            else:
                val = ""
            cells[col_index(c.get("r"))] = (val or "").strip()
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows

def parse_time(raw):
    """'3.00 pm' -> '15:00'. Returns None for anything it cannot read exactly."""
    # Trailing punctuation is noise, not ambiguity: "6.30. pm" and "1.00 pm,"
    # each have exactly one reading. A value that is genuinely unreadable
    # ("30.30 pm") still falls through to None.
    s = raw.strip().lower().replace(" ", "").strip(",.;")
    if not s:
        return None
    m = re.fullmatch(r"(\d{1,2})[.:](\d{2})[.,]?(am|pm)?", s) or re.fullmatch(r"(\d{1,2})(am|pm)", s)
    if not m:
        return None
    groups = m.groups()
    hour = int(groups[0])
    minute = int(groups[1]) if len(groups) == 3 else 0
    meridiem = groups[-1]
    if minute > 59:
        return None
    if meridiem == "pm" and hour < 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    if hour > 23:
        return None
    return f"{hour:02d}:{minute:02d}"

def main():
    src, out = sys.argv[1], sys.argv[2]
    hold = set()
    if "--hold" in sys.argv:
        hold = {int(x) for x in sys.argv[sys.argv.index("--hold") + 1].split(",") if x.strip()}

    rows = read(src)
    body = [r for r in rows[1:] if any(c.strip() for c in r)]

    kept, held, unslotted = [], [], []
    for n, r in enumerate(body, start=2):  # line numbers as the sheet shows them
        cell = lambda i: (r[i] if i < len(r) else "").strip()
        if n in hold:
            held.append((n, cell(11) or cell(0)))
            continue
        record = {k: cell(i) for i, k in enumerate(KEYS)}
        record["fee"] = record["fee"].replace(",", "")
        record["institute_share_percent"] = record["institute_share_percent"].replace("%", "").strip()
        start = parse_time(record["start_time"])
        end = parse_time(record["end_time"])
        if not (start and end and end > start):
            # A course we can create, but not a class time we can state.
            unslotted.append((n, record["course_name"] or record["teacher"],
                              f'{record["start_time"] or "(blank)"} – {record["end_time"] or "(blank)"}'))
            record["day"] = record["start_time"] = record["end_time"] = ""
        else:
            record["start_time"], record["end_time"] = start, end
        kept.append(record)

    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=KEYS)
        w.writeheader()
        w.writerows(kept)

    print(f"{len(body)} rows in the sheet")
    print(f"  {len(kept)} written to {out}")
    print(f"  {len(held)} held back (--hold): " + ", ".join(f"line {n} {name}" for n, name in held))
    print(f"  {len(unslotted)} imported WITHOUT a class time:")
    for n, name, times in unslotted:
        print(f"      line {n:>3}  {name[:38]:<38} {times}")

main()
