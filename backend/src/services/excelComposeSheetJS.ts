import * as XLSX from 'xlsx'

export type ExcelCellSpec = {
  ref: string;
  v: string | number | boolean | Date | null;
  numFmt?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string; // hex like #RRGGBB or ARGB
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

function a1FromColRow(c: number, r: number): string {
  let col = ''
  let n = c
  while (n > 0) {
    const rem = (n - 1) % 26
    col = String.fromCharCode(65 + rem) + col
    n = Math.floor((n - 1) / 26)
  }
  return col + r
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

function applyCellFormatting(cell: XLSX.CellObject, spec: ExcelCellSpec) {
  // Initialize cell style if not present
  if (!cell.s) cell.s = {}
  
  // Number format
  if (spec.numFmt) {
    cell.z = spec.numFmt
  }
  
  // Font styling
  const font: any = cell.s.font || {}
  if (spec.bold != null) font.bold = !!spec.bold
  if (spec.italic != null) font.italic = !!spec.italic
  if (spec.underline != null) font.underline = !!spec.underline
  if (spec.strike != null) font.strike = !!spec.strike
  
  const argb = hexToArgb(spec.color)
  if (argb) {
    font.color = { rgb: argb }
  }
  if (Object.keys(font).length) cell.s.font = font
  
  // Alignment
  if (spec.align || spec.wrap != null) {
    const alignment: any = cell.s.alignment || {}
    if (spec.align) alignment.horizontal = spec.align
    if (spec.wrap != null) alignment.wrapText = !!spec.wrap
    cell.s.alignment = alignment
  }
  
  // Background fill
  const bgArgb = hexToArgb(spec.bg)
  if (bgArgb) {
    cell.s.fill = {
      patternType: 'solid',
      fgColor: { rgb: bgArgb }
    }
  }
}

// Accept broad input buffer types to avoid typing friction across Node versions
export async function mergeOpsIntoExcelTemplate(templateBuffer: ArrayBuffer | Uint8Array | any, ops: ExcelOps | any): Promise<Buffer> {
  try {
    console.log('[SheetJS] Loading workbook from template buffer')
    
    // Read the workbook - SheetJS preserves the raw XML structure including tables/AutoFilter
    const workbook = XLSX.read(templateBuffer, { 
      type: 'buffer',
      cellStyles: true, // Preserve cell styles
      cellFormula: true, // Preserve formulas
      cellNF: true, // Preserve number formats
      cellHTML: false,
      bookVBA: true // Preserve VBA and other binary structures
    })
    
    const sheets: ExcelSheetSpec[] = Array.isArray((ops && ops.sheets)) ? ops.sheets : []

    for (const s of sheets) {
      const sheetName = String(s.name || '')
      if (!sheetName) {
        console.warn(`[SheetJS] Skipping sheet with no name`)
        continue
      }

      let ws = workbook.Sheets[sheetName]
      
      // Create new sheet if it doesn't exist in template
      if (!ws) {
        console.log(`[SheetJS] Creating new worksheet: "${sheetName}"`)
        ws = {}
        ws['!ref'] = 'A1'
        workbook.Sheets[sheetName] = ws
        
        // Add to SheetNames array if not already there
        if (!workbook.SheetNames.includes(sheetName)) {
          workbook.SheetNames.push(sheetName)
        }
      } else {
        console.log(`[SheetJS] Processing existing worksheet: "${sheetName}"`)
      }

      // SheetJS uses a different data structure - cells are stored in the sheet object by ref
      // The '!ref' property defines the used range
      
      // Row insertions
      if (Array.isArray(s.insertRows) && s.insertRows.length) {
        for (const ins of s.insertRows) {
          if (!ins || !isFinite(ins.at) || !isFinite(ins.count)) continue
          const at = Math.max(1, Math.floor(Number(ins.at)))
          const count = Math.max(1, Math.floor(Number(ins.count)))
          
          console.log(`[SheetJS] Inserting ${count} row(s) at row ${at}`)
          
          // Get the current range
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
          
          // Shift all cells down from the insertion point
          const cellsToMove: Array<{ from: string; to: string; cell: XLSX.CellObject }> = []
          
          // Collect all cells that need to be moved
          for (let R = range.e.r; R >= at - 1; R--) {
            for (let C = range.s.c; C <= range.e.c; C++) {
              const fromAddr = XLSX.utils.encode_cell({ r: R, c: C })
              const toAddr = XLSX.utils.encode_cell({ r: R + count, c: C })
              const cell = ws[fromAddr]
              if (cell) {
                cellsToMove.push({ from: fromAddr, to: toAddr, cell: { ...cell } })
              }
            }
          }
          
          // Move cells
          for (const move of cellsToMove) {
            delete ws[move.from]
            ws[move.to] = move.cell
          }
          
          // Update the range
          range.e.r += count
          ws['!ref'] = XLSX.utils.encode_range(range)
          
          // Copy styles from reference row if provided
          if (ins.copyStyleFromRow && isFinite(ins.copyStyleFromRow)) {
            const srcRow = Math.max(1, Math.floor(Number(ins.copyStyleFromRow)))
            
            for (let i = 0; i < count; i++) {
              const dstRow = at + i
              for (let C = range.s.c; C <= range.e.c; C++) {
                const srcAddr = XLSX.utils.encode_cell({ r: srcRow - 1, c: C })
                const dstAddr = XLSX.utils.encode_cell({ r: dstRow - 1, c: C })
                const srcCell = ws[srcAddr]
                
                if (srcCell && srcCell.s) {
                  if (!ws[dstAddr]) {
                    ws[dstAddr] = { t: 's', v: '' }
                  }
                  // Copy the style object
                  ws[dstAddr].s = JSON.parse(JSON.stringify(srcCell.s))
                }
              }
            }
          }
        }
      }

      // Cells
      if (Array.isArray(s.cells)) {
        console.log(`[SheetJS] Processing ${s.cells.length} cell(s) in worksheet "${sheetName}"`)
        for (const cellSpec of s.cells) {
          if (!cellSpec || !cellSpec.ref) continue
          
          const addr = String(cellSpec.ref)
          let cell = ws[addr]
          
          // Create cell if it doesn't exist
          if (!cell) {
            cell = {}
            ws[addr] = cell
          }
          
          // Set value and type - SheetJS needs both v and w properties
          if (cellSpec.v instanceof Date) {
            cell.t = 'd'
            cell.v = cellSpec.v
            cell.w = cellSpec.v.toLocaleDateString()
          } else if (typeof cellSpec.v === 'number') {
            cell.t = 'n'
            cell.v = cellSpec.v
            cell.w = String(cellSpec.v)
          } else if (typeof cellSpec.v === 'boolean') {
            cell.t = 'b'
            cell.v = cellSpec.v
            cell.w = cellSpec.v ? 'TRUE' : 'FALSE'
          } else if (cellSpec.v == null || cellSpec.v === '') {
            cell.t = 'z'
            delete cell.v
            delete cell.w
          } else {
            cell.t = 's'
            cell.v = String(cellSpec.v)
            cell.w = String(cellSpec.v)
          }
          
          console.log(`[SheetJS]   Cell ${addr}: type=${cell.t}, value="${cell.v}"`)
          
          // Apply formatting
          applyCellFormatting(cell, cellSpec)
          
          // Update range if needed
          const { c, r } = colRowFromA1(addr)
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
          let updated = false
          if (c - 1 > range.e.c) { range.e.c = c - 1; updated = true }
          if (r - 1 > range.e.r) { range.e.r = r - 1; updated = true }
          if (c - 1 < range.s.c) { range.s.c = c - 1; updated = true }
          if (r - 1 < range.s.r) { range.s.r = r - 1; updated = true }
          if (updated) {
            ws['!ref'] = XLSX.utils.encode_range(range)
          }
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
              const addr = a1FromColRow(startC + j, startR + i)
              let cell = ws[addr]
              
              if (!cell) {
                cell = {}
                ws[addr] = cell
              }
              
              const v = rowVals[j]
              // Set value and type - SheetJS needs both v and w properties
              if (v instanceof Date) {
                cell.t = 'd'
                cell.v = v
                cell.w = v.toLocaleDateString()
              } else if (typeof v === 'number') {
                cell.t = 'n'
                cell.v = v
                cell.w = String(v)
              } else if (typeof v === 'boolean') {
                cell.t = 'b'
                cell.v = v
                cell.w = v ? 'TRUE' : 'FALSE'
              } else if (v == null || v === '') {
                cell.t = 'z'
                delete cell.v
                delete cell.w
              } else {
                cell.t = 's'
                cell.v = String(v)
                cell.w = String(v)
              }
              
              if (range.numFmt) {
                cell.z = range.numFmt
              }
              
              // Update worksheet range
              const wsRange = XLSX.utils.decode_range(ws['!ref'] || 'A1')
              let updated = false
              const cellCol = startC + j - 1
              const cellRow = startR + i - 1
              if (cellCol > wsRange.e.c) { wsRange.e.c = cellCol; updated = true }
              if (cellRow > wsRange.e.r) { wsRange.e.r = cellRow; updated = true }
              if (cellCol < wsRange.s.c) { wsRange.s.c = cellCol; updated = true }
              if (cellRow < wsRange.s.r) { wsRange.s.r = cellRow; updated = true }
              if (updated) {
                ws['!ref'] = XLSX.utils.encode_range(wsRange)
              }
            }
          }
        }
      }
      
      console.log(`[SheetJS] Completed processing worksheet "${sheetName}". Final range: ${ws['!ref']}"`)
      
      // Log a sample of cells for debugging
      const cellCount = Object.keys(ws).filter(k => !k.startsWith('!')).length
      console.log(`[SheetJS] Worksheet "${sheetName}" has ${cellCount} cells`)
      if (cellCount > 0 && cellCount <= 10) {
        Object.keys(ws).filter(k => !k.startsWith('!')).forEach(addr => {
          const cell = ws[addr]
          console.log(`[SheetJS]   ${addr}: type=${cell.t}, v="${cell.v}", w="${cell.w}"`)
        })
      }
    }

    // Write the workbook back - SheetJS preserves the original XML structure
    // This means tables and AutoFilter remain intact without corruption
    console.log('[SheetJS] Writing workbook to buffer')
    const out = XLSX.write(workbook, { 
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true,
      bookVBA: true // Preserve VBA and other structures
    })
    
    console.log('[SheetJS] Successfully created output buffer')
    return Buffer.isBuffer(out) ? out : Buffer.from(out)
    
  } catch (error) {
    console.error('[SheetJS] Merge error:', error)
    throw new Error(`Excel template merge failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default { mergeOpsIntoExcelTemplate }
