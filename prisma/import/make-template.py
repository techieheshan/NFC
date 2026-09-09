"""Build the course sheet as a real .xlsx workbook.

Staff at the institute are not going to hand-edit a CSV, so the sheet they get
is an Excel file with dropdowns on every column that must match something
already in the system. An .xlsx is a zip of XML, so this needs no third-party
package on our side either.

  python3 prisma/import/make-template.py <reference-values.csv> <out.xlsx>

The reference CSV comes from `npx tsx prisma/import-courses.ts <file> --reference`.
"""
import csv, sys, zipfile
from xml.sax.saxutils import escape

COLUMNS = [
    ("teacher", "Teacher", 26), ("subject", "Subject", 18), ("grade", "Grade", 12),
    ("stream", "Stream", 14), ("class_type", "Class type", 13), ("fee", "Fee", 10),
    ("institute_share_percent", "Institute %", 13), ("day", "Day", 9),
    ("start_time", "Start (HH:mm)", 13), ("end_time", "End (HH:mm)", 13),
    ("hall", "Hall", 16), ("course_name", "Course name (optional)", 26),
]
DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
EXAMPLES = [
    ["EXAMPLE - delete this row", "ICT", "AL2027", "AL Tech", "THEORY", "2500", "25", "MON", "15:00", "17:00", "Blue Sky", ""],
    ["EXAMPLE - delete this row", "ICT", "AL2027", "AL Tech", "THEORY", "2500", "25", "THU", "15:00", "17:00", "Blue Sky", ""],
]
ROWS = 600  # how far down the dropdowns and formats reach

def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def cell(ref, value, style=0):
    if value == "":
        return f'<c r="{ref}" s="{style}"/>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'

def sheet_xml(rows, *, widths=None, validations="", freeze=True):
    cols = ""
    if widths:
        cols = "<cols>" + "".join(
            f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths)
        ) + "</cols>"
    body = ""
    for r, row in enumerate(rows, start=1):
        cells = "".join(cell(f"{col_letter(c)}{r}", v, 1 if r == 1 else 0) for c, v in enumerate(row))
        body += f'<row r="{r}">{cells}</row>'
    pane = ('<sheetViews><sheetView workbookViewId="0" tabSelected="1">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>") if freeze else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"{pane}{cols}<sheetData>{body}</sheetData>{validations}</worksheet>")

def main():
    ref_path, out_path = sys.argv[1], sys.argv[2]
    with open(ref_path, newline="", encoding="utf-8") as fh:
        ref_rows = list(csv.reader(fh))
    ref_head, ref_body = ref_rows[0], ref_rows[1:]
    ref = {name: [r[i] for r in ref_body if i < len(r) and r[i].strip()] for i, name in enumerate(ref_head)}
    ref["day"] = DAYS

    # Reference sheet: one column per list, so a dropdown can point at a range.
    ref_names = list(ref.keys())
    depth = max(len(v) for v in ref.values())
    ref_sheet_rows = [ref_names] + [
        [ref[n][i] if i < len(ref[n]) else "" for n in ref_names] for i in range(depth)
    ]

    # A dropdown for every column whose value must already exist in the system.
    validations = []
    for i, (key, _, _) in enumerate(COLUMNS):
        if key not in ref or not ref[key]:
            continue
        src_col = col_letter(ref_names.index(key))
        target = f"{col_letter(i)}2:{col_letter(i)}{ROWS}"
        validations.append(
            f'<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="{target}">'
            f"<formula1>Reference!${src_col}$2:${src_col}${len(ref[key]) + 1}</formula1></dataValidation>"
        )
    dv = f'<dataValidations count="{len(validations)}">' + "".join(validations) + "</dataValidations>"

    courses = [[label for _, label, _ in COLUMNS]] + EXAMPLES
    sheets = {
        "xl/worksheets/sheet1.xml": sheet_xml(courses, widths=[w for _, _, w in COLUMNS], validations=dv),
        "xl/worksheets/sheet2.xml": sheet_xml(ref_sheet_rows, widths=[24] * len(ref_names), freeze=False),
    }

    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
              '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
              '<fills count="3"><fill><patternFill patternType="none"/></fill>'
              '<fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/><bgColor indexed="64"/></patternFill></fill></fills>'
              '<borders count="1"><border/></borders>'
              '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
              '<cellXfs count="2"><xf xfId="0"/>'
              '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs>'
              "</styleSheet>")

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>")
        z.writestr("_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>")
        z.writestr("xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Courses" sheetId="1" r:id="rId1"/>'
            '<sheet name="Reference" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>")
        z.writestr("xl/styles.xml", styles)
        for name, xml in sheets.items():
            z.writestr(name, xml)

    print(f"Wrote {out_path}: Courses sheet + Reference sheet, dropdowns on "
          + ", ".join(k for k, _, _ in COLUMNS if k in ref and ref[k]))

main()
