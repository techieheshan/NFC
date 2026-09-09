"""Turn the institute's filled-in workbook into the CSV the importer reads.

  python3 prisma/import/xlsx-to-csv.py <filled.xlsx> <out.csv>

Staff send an Excel file; the importer takes CSV. That conversion is our job,
not theirs, so it happens here — no add-in, no "save as", nothing for them to
get wrong. An .xlsx is a zip of XML, so this needs no third-party package.
Only the first sheet is read; the Reference sheet is ignored.
"""
import csv, re, sys, zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

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

def main():
    src, out = sys.argv[1], sys.argv[2]
    rows = read(src)
    # The workbook's headers are human labels; the importer wants its own keys.
    KEYS = ["teacher", "subject", "grade", "stream", "class_type", "fee",
            "institute_share_percent", "day", "start_time", "end_time", "hall", "course_name"]
    body = [r for r in rows[1:] if any(c.strip() for c in r)]
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(KEYS)
        for r in body:
            w.writerow([(r[i] if i < len(r) else "") for i in range(len(KEYS))])
    print(f"Wrote {out}: {len(body)} row(s) from {src}")

main()
