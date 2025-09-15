import ExcelJS from 'exceljs'

export type ExcelCellSpec = {
  ref: string;
  v: string | number | boolean | Date | null;
  numFmt?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string; // hex like #RRGGBB or RRGGBB or ARGB
  bg?: string; // background fill hex
  align?: 'left'|'center'|'right';
  wrap?: boolean;
}
export type ExcelRangeSpec = { start: string; values: any[][]; numFmt?: string }
export type ExcelInsertRowsSpec = { at: number; count: number; copyStyleFromRow?: number }
export type ExcelSheetSpec = { name: string; insertRows?: ExcelInsertRowsSpec[]; cells?: ExcelCellSpec[]; ranges?: ExcelRangeSpec[] }
export type ExcelOps = { sheets: ExcelSheetSpec[] }

function colRowFromA1(a1: string): { c: number; r: number } {
  const m = String(a1).toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!m) return { c: 1, r: 1 }
  const letters = m[1]!
  const r = parseInt(m[2]!, 10)
  let c = 0
  for (let i = 0; i < letters.length; i++) {
    c = c * 26 + (letters.charCodeAt(i) - 64)
  }
  return { c, r }
}

function hexToArgb(hex?: string): string | undefined {
  if (!hex) return undefined
  let s = String(hex).trim()
  if (!s) return undefined
  if (s.startsWith('#')) s = s.slice(1)
  // Allow 6 or 8 hex; default alpha FF
  if (s.length === 6) return `FF${s.toUpperCase()}`
  if (s.length === 8) return s.toUpperCase()
  return undefined
}

function applyCellFormatting(cell: ExcelJS.Cell, spec: ExcelCellSpec) {
  if (spec.numFmt) {
    cell.numFmt = spec.numFmt
  }
  const font: Partial<ExcelJS.Font> = {}
  if (spec.bold != null) font.bold = !!spec.bold
  if (spec.italic != null) font.italic = !!spec.italic
  if (spec.underline != null) (font as any).underline = !!spec.underline as any
  if (spec.strike != null) font.strike = !!spec.strike
  const argb = hexToArgb(spec.color)
  if (argb) font.color = { argb }
  if (Object.keys(font).length) cell.font = { ...(cell.font || {}), ...font }
  if (spec.align) {
    cell.alignment = { ...(cell.alignment || {}), horizontal: spec.align as any }
  }
  if (spec.wrap != null) {
    cell.alignment = { ...(cell.alignment || {}), wrapText: !!spec.wrap }
  }
  const bgArgb = hexToArgb(spec.bg)
  if (bgArgb) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgArgb }
    } as any
  }
}

// Accept broad input buffer types to avoid typing friction across Node versions
export async function mergeOpsIntoExcelTemplate(templateBuffer: ArrayBuffer | Uint8Array | any, ops: ExcelOps | any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  // exceljs typings vary; cast to any to satisfy both Buffer/ArrayBuffer/Uint8Array
  await workbook.xlsx.load(templateBuffer as any)
  const sheets: ExcelSheetSpec[] = Array.isArray((ops && ops.sheets)) ? ops.sheets : []

  for (const s of sheets) {
    if (!s || !s.name) continue
    let ws = workbook.getWorksheet(String(s.name))
    if (!ws) ws = workbook.addWorksheet(String(s.name))

    // Row insertions (with optional style copy)
    if (Array.isArray(s.insertRows) && s.insertRows.length) {
      for (const ins of s.insertRows) {
        if (!ins || !isFinite(ins.at) || !isFinite(ins.count)) continue
        const at = Math.max(1, Math.floor(Number(ins.at)))
        const count = Math.max(1, Math.floor(Number(ins.count)))
        // Insert empty rows
        try {
          const blanks: any[][] = new Array(count).fill([])
          // spliceRows shifts down existing rows from `at`
          ;(ws as any).spliceRows(at, 0, ...blanks)
        } catch {
          try { (ws as any).insertRows(at, new Array(count).fill([])) } catch {}
        }
        // Copy styles from reference row if provided
        if (ins.copyStyleFromRow && isFinite(ins.copyStyleFromRow)) {
          const srcIdx = Math.max(1, Math.floor(Number(ins.copyStyleFromRow)))
          const srcRow = ws.getRow(srcIdx)
          for (let i = 0; i < count; i++) {
            const dstIdx = at + i
            const dstRow = ws.getRow(dstIdx)
            // Copy row-level props
            try { dstRow.height = srcRow.height } catch {}
            const maxCol = (ws as any).actualColumnCount || Math.max(srcRow.cellCount, ws.columnCount || 0)
            for (let col = 1; col <= maxCol; col++) {
              const srcCell = srcRow.getCell(col)
              const dstCell = dstRow.getCell(col)
              try {
                // Copy common style fragments
                if (srcCell.numFmt != null) dstCell.numFmt = srcCell.numFmt
                if (srcCell.font) dstCell.font = { ...(srcCell.font as any) }
                if (srcCell.alignment) dstCell.alignment = { ...(srcCell.alignment as any) }
                if ((srcCell as any).border) (dstCell as any).border = { ...((srcCell as any).border) }
                if (srcCell.fill) dstCell.fill = { ...(srcCell.fill as any) } as any
              } catch {}
            }
            try { dstRow.commit?.() } catch {}
          }
        }
      }
    }

    // Cells
    if (Array.isArray(s.cells)) {
      for (const cellSpec of s.cells) {
        if (!cellSpec || !cellSpec.ref) continue
        const cell = ws.getCell(String(cellSpec.ref))
        // Assign value
        if (cellSpec.v instanceof Date) cell.value = cellSpec.v
        else if (typeof cellSpec.v === 'number' || typeof cellSpec.v === 'boolean') cell.value = cellSpec.v as any
        else if (cellSpec.v == null) cell.value = null
        else cell.value = String(cellSpec.v)
        applyCellFormatting(cell, cellSpec)
      }
    }

    // Ranges
    if (Array.isArray(s.ranges)) {
      for (const range of s.ranges) {
        if (!range || !range.start || !Array.isArray(range.values)) continue
        const { c: startC, r: startR } = colRowFromA1(String(range.start))
        for (let i = 0; i < range.values.length; i++) {
          const rowVals = range.values[i] || []
          for (let j = 0; j < rowVals.length; j++) {
            const cell = ws.getCell(startR + i, startC + j)
            const v = rowVals[j]
            if (v instanceof Date) cell.value = v
            else if (typeof v === 'number' || typeof v === 'boolean') cell.value = v as any
            else if (v == null) cell.value = null
            else cell.value = String(v)
            if (range.numFmt) cell.numFmt = range.numFmt
          }
        }
      }
    }
  }

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
}

export default { mergeOpsIntoExcelTemplate }
