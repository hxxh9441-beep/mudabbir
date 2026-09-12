// src/utils/xlsx.ts
// **كاتب xlsx صغير ومكتفٍ بذاته** — بلا مكتبات ثقيلة وبلا ثغرات.
//
// لماذا لا SheetJS/ExcelJS؟ جرّبنا ExcelJS فجلب **ثغرتين** (`npm audit`)، ومعيار
// هذا المشروع صفر ثغرات. وملفّ xlsx ما هو إلا **حزمة ZIP** فيها XML قليل،
// فبنيناه بأنفسنا: التحكّم كامل (عرض الأعمدة، رؤوس عريضة بخلفيّة، حدود،
// وتخطيط RTL للورقة)، والحجم لا يُذكَر (fflate ≈ ٢ كيلوبايت).
import { zipSync, strToU8 } from 'fflate';

/** خليّة: نصّ + نمط */
export interface XCell {
  v: string | number;
  /** 0 افتراضيّ · 1 عنوان · 2 رأس جدول · 3 بيانات · 4 يوم/تاريخ (عريض) */
  s?: number;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const colName = (i: number) => {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/**
 * الأنماط (xl/styles.xml). كل `cellXfs` هنا له اسمٌ في التعليق، والترتيب هو
 * الفهرس الذي تشير إليه الخلايا في الورقة:
 *   0 افتراضيّ · 1 عنوان كبير · 2 رأس جدول · 3 بيانات · 4 يوم (عريض)
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="4">
  <font><sz val="11"/><name val="Arial"/></font>
  <font><b/><sz val="15"/><color rgb="FF1E140A"/><name val="Arial"/></font>
  <font><b/><sz val="11"/><color rgb="FF2D241C"/><name val="Arial"/></font>
  <font><b/><sz val="11"/><color rgb="FF2D1F17"/><name val="Arial"/></font>
 </fonts>
 <fills count="3">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
 </fills>
 <borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
   <left style="thin"><color rgb="FFB9A58F"/></left>
   <right style="thin"><color rgb="FFB9A58F"/></right>
   <top style="thin"><color rgb="FFB9A58F"/></top>
   <bottom style="thin"><color rgb="FFB9A58F"/></bottom>
   <diagonal/>
  </border>
 </borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="10">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
   <alignment horizontal="right" vertical="center" readingOrder="2"/>
  </xf>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
   <alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
   <alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
   <alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
  <!-- 5: عنوان مُوسَّط كبير (البسملة) -->
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
   <alignment horizontal="center" vertical="center" readingOrder="2"/>
  </xf>
  <!-- 6: تسمية مُوسَّطة عريضة (تقرير شهر / حلقة / اسم الطالب) -->
  <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
   <alignment horizontal="center" vertical="center" readingOrder="2"/>
  </xf>
  <!-- 7: رأس المجموعة (الحفظ / المراجعة) — مدمج، خلفيّةٌ ناعمة، توسيط -->
  <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
   <alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
  <!-- 8: بيانات مُوسَّطة بحدود (من/إلى/التقييم) -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
   <alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
  <!-- 9: سطر تفاصيل وسطيّ بخطٍّ عاديّ (الطالب · الحلقة · الشهر · المقدار) -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
   <alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/>
  </xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export interface SheetSpec {
  name: string;
  /** عرض كل عمود (بوحدة Excel ≈ عدد المحارف) */
  widths: number[];
  rows: XCell[][];
  /** ارتفاع الصفوف بالنقاط (pt) */
  rowHeightPt?: number;
  /** خلايا مدمجة بصيغة A1 (مثل «A2:J2») */
  merges?: string[];
  /** ارتفاعات صفوف مخصّصة: { '2': 34 } */
  heights?: Record<string, number>;
}

function sheetXml(spec: SheetSpec): string {
  const cols = spec.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const rows = spec.rows
    .map((row, r) => {
      const custom = spec.heights?.[String(r + 1)];
      const h = custom
        ? ` ht="${custom}" customHeight="1"`
        : spec.rowHeightPt
          ? ` ht="${spec.rowHeightPt}" customHeight="1"`
          : '';
      const cells = row
        .map((c, i) => {
          const ref = `${colName(i)}${r + 1}`;
          const s = c.s ? ` s="${c.s}"` : '';
          if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
          if (c.v === '') return `<c r="${ref}"${s}/>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}"${h}>${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <sheetViews>
  <!-- التخطيط من اليمين إلى اليسار: العربيّة تُعرض طبيعيّاً في Excel -->
  <sheetView rightToLeft="1" workbookViewId="0" showGridLines="0" tabSelected="1"/>
 </sheetViews>
 <sheetFormatPr defaultRowHeight="18"/>
 <cols>${cols}</cols>
 <sheetData>${rows}</sheetData>${
   spec.merges?.length ? `<mergeCells count="${spec.merges.length}">${spec.merges
     .map((m) => `<mergeCell ref="${m}"/>`)
     .join('')}</mergeCells>` : ''
  }
</worksheet>`;
}

/** يبني ملفّ xlsx صالحاً (Uint8Array) من ورقةٍ واحدة منسّقة. */
export function buildXlsx(spec: SheetSpec): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets><sheet name="${esc(spec.name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(spec)),
  };
  // بلا ضغط (level 0) — الملفّ صغير، وأبسط وأضمن لكل قارئ جداول
  return zipSync(files, { level: 6 });
}
