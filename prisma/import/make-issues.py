"""Build the "please fix these rows" workbook for the institute.

  python3 prisma/import/make-issues.py <problems.json> <out.xlsx>

The import refuses to guess: a row whose grade does not exist, whose teacher is
spelled a way nobody in the system is, or whose time is not a time, comes back
here instead. Staff get one sheet with the offending rows, what is wrong with
each, and empty columns to write the right answer in — so nothing is invented
on our side and nothing has to be explained twice.
"""
import json, sys, zipfile
from xml.sax.saxutils import escape

SHOW = [("row", "Row in your file", 9), ("status", "STATUS", 26), ("name", "Course Name", 30),
        ("teacher", "Teacher", 22), ("subject", "Subject", 13), ("grade", "Grade", 9),
        ("day", "Day", 7), ("start", "Start", 11), ("end", "End", 11),
        ("problem", "WHAT IS WRONG / WHAT WE NEED", 60)]
FIX = [("Correct Teacher", 22), ("Correct Grade", 13), ("Correct Day", 11),
       ("Correct Start", 13), ("Correct End", 13)]

def col_letter(i):
    s = ""; i += 1
    while i:
        i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s

def cell(ref, value, style=0):
    if value == "": return f'<c r="{ref}" s="{style}"/>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'

def sheet(rows, widths, styles):
    cols = "<cols>" + "".join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
                              for i, w in enumerate(widths)) + "</cols>"
    body = ""
    for r, row in enumerate(rows, start=1):
        body += f'<row r="{r}">' + "".join(
            cell(f"{col_letter(c)}{r}", v, styles(r, c)) for c, v in enumerate(row)) + "</row>"
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0" tabSelected="1">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            f"</sheetView></sheetViews>{cols}<sheetData>{body}</sheetData></worksheet>")

def main():
    problems = json.load(open(sys.argv[1]))
    header = [label for _, label, _ in SHOW] + [label for label, _ in FIX]
    rows = [header] + [
        [str(p.get(k, "")) for k, _, _ in SHOW] + ["" for _ in FIX] for p in problems
    ]
    widths = [w for _, _, w in SHOW] + [w for _, w in FIX]
    fix_from = len(SHOW)
    # 1 = header, 2 = status and the problem text, 3 = the columns they fill in.
    def styles(r, c):
        if r == 1: return 1
        if c in (1, fix_from - 1): return 2
        if c >= fix_from: return 3
        return 0

    styles_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        '<font><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font></fonts>'
        '<fills count="4"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/><bgColor indexed="64"/></patternFill></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="4"><xf xfId="0"/>'
        '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/>'
        '<xf xfId="0" fontId="2" applyFont="1"/>'
        '<xf xfId="0" fillId="3" applyFill="1"/></cellXfs></styleSheet>')

    with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
        z.writestr("_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Rows to fix" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr("xl/styles.xml", styles_xml)
        z.writestr("xl/worksheets/sheet1.xml", sheet(rows, widths, styles))
    print(f"Wrote {sys.argv[2]}: {len(problems)} row(s) to fix.")

main()
