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
  try {
    const workbook = new ExcelJS.Workbook()
    // exceljs typings vary; cast to any to satisfy both Buffer/ArrayBuffer/Uint8Array
    await workbook.xlsx.load(templateBuffer as any)
    const sheets: ExcelSheetSpec[] = Array.isArray((ops && ops.sheets)) ? ops.sheets : []

    for (const s of sheets) {
      if (!s || !s.name) continue
      let ws = workbook.getWorksheet(String(s.name))
      if (!ws) ws = workbook.addWorksheet(String(s.name))

      // Capture and manage Excel tables to preserve them through data insertion
      let preservedTables: any[] = []
      try {
        // Capture existing table definitions before clearing
        if ((ws as any).tables && Array.isArray((ws as any).tables)) {
          preservedTables = (ws as any).tables.map((table: any) => ({
            name: table.name,
            displayName: table.displayName,
            ref: table.ref,
            headerRow: table.headerRow !== false, // default to true
            totalsRow: table.totalsRow === true,
            style: table.style || { theme: 'TableStyleMedium2', showRowStripes: true },
            columns: table.columns ? [...table.columns] : [],
            // Store original range info for adjustment
            _originalRef: table.ref
          }))
          
          if (preservedTables.length > 0) {
            console.log(`[EXCEL] Preserved ${preservedTables.length} table definition(s) from worksheet "${s.name}"`)
          }
        }
        
        // Remove autoFilter and tables temporarily to prevent conflicts during data insertion
        if ((ws as any).autoFilter) {
          (ws as any).autoFilter = undefined
        }
        
        if ((ws as any).tables) {
          (ws as any).tables = []
        }
        
        if ((ws as any)._tables) {
          (ws as any)._tables = []
        }
      } catch (autoFilterError) {
        console.warn('Warning: Failed to preserve/clear autoFilter/tables:', autoFilterError)
      }

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

      // Recreate tables after data insertion to preserve table functionality
      if (preservedTables.length > 0) {
        try {
          console.log(`[EXCEL] Recreating ${preservedTables.length} table(s) in worksheet "${s.name}"`)
          
          for (const tableInfo of preservedTables) {
            try {
              // Adjust table range if rows were inserted
              let adjustedRef = tableInfo.ref
              
              if (Array.isArray(s.insertRows) && s.insertRows.length) {
                // Calculate total rows inserted before the table
                const tableStartRow = parseInt(tableInfo.ref.match(/(\d+)/)?.[1] || '1', 10)
                let rowsInsertedBefore = 0
                
                for (const ins of s.insertRows) {
                  if (ins && isFinite(ins.at) && isFinite(ins.count)) {
                    const insertAt = Math.floor(Number(ins.at))
                    const insertCount = Math.floor(Number(ins.count))
                    // If rows were inserted before or at the table start, adjust the range
                    if (insertAt <= tableStartRow) {
                      rowsInsertedBefore += insertCount
                    }
                  }
                }
                
                // Adjust the table reference if needed
                if (rowsInsertedBefore > 0) {
                  // Parse the range (e.g., "A1:D10")
                  const rangeMatch = tableInfo.ref.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/)
                  if (rangeMatch) {
                    const [, startCol, startRow, endCol, endRow] = rangeMatch
                    const newStartRow = parseInt(startRow, 10) + rowsInsertedBefore
                    const newEndRow = parseInt(endRow, 10) + rowsInsertedBefore
                    adjustedRef = `${startCol}${newStartRow}:${endCol}${newEndRow}`
                    console.log(`[EXCEL] Adjusted table "${tableInfo.name}" range from ${tableInfo.ref} to ${adjustedRef}`)
                  }
                }
              }
              
              // Create the table with adjusted range
              // ExcelJS addTable requires reading data from the worksheet
              // IMPORTANT: Disable filterButton to prevent AutoFilter corruption issues
              const tableData: any = {
                name: tableInfo.name,
                ref: adjustedRef,
                headerRow: tableInfo.headerRow,
                totalsRow: tableInfo.totalsRow,
                style: tableInfo.style,
                columns: tableInfo.columns.map((col: any) => ({
                  name: col.name || 'Column',
                  filterButton: false, // DISABLE filter buttons to prevent AutoFilter errors in Excel
                  ...(col.totalsRowLabel && { totalsRowLabel: col.totalsRowLabel }),
                  ...(col.totalsRowFunction && { totalsRowFunction: col.totalsRowFunction })
                }))
              }
              
              // Try to add the table - ExcelJS will read rows from the worksheet
              try {
                (ws as any).addTable(tableData)
              } catch (addErr) {
                // If addTable fails, try alternative approach without rows property
                console.warn(`[EXCEL] Standard addTable failed for "${tableInfo.name}", trying alternative:`, addErr)
                // Directly manipulate the tables array
                if (!(ws as any).tables) {
                  (ws as any).tables = []
                }
                (ws as any).tables.push(tableData)
              }
              
              console.log(`[EXCEL] Successfully recreated table "${tableInfo.name}" at ${adjustedRef} (AutoFilter disabled)`)
            } catch (tableError) {
              console.error(`[EXCEL] Failed to recreate table "${tableInfo.name}":`, tableError)
            }
          }
        } catch (recreateError) {
          console.error('[EXCEL] Error recreating tables:', recreateError)
        }
      }
    }

  // Write the modified workbook with error handling for AutoFilter/Table issues
  try {
    const out = await workbook.xlsx.writeBuffer()
    return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
  } catch (writeError) {
    // If writing fails due to AutoFilter/Table issues, try to fix and retry
    console.warn('First writeBuffer attempt failed, trying to fix worksheet properties:', writeError)
    
    // Try to clear all problematic properties from all worksheets
    workbook.worksheets.forEach(ws => {
      try {
        // Remove autoFilter
        if ((ws as any).autoFilter) {
          (ws as any).autoFilter = undefined
        }
        
        // Remove all tables (both public and internal properties)
        if ((ws as any).tables) {
          (ws as any).tables = []
        }
        if ((ws as any)._tables) {
          (ws as any)._tables = []
        }
        
        // Clear any filter buttons
        if ((ws as any).filterButton !== undefined) {
          delete (ws as any).filterButton
        }
        
        // Clear any table refs in the model
        if ((ws as any).model && (ws as any).model.tables) {
          (ws as any).model.tables = []
        }
      } catch (cleanupError) {
        console.warn('Failed to clean worksheet properties:', cleanupError)
      }
    })
    
    // Retry the write operation
    const out = await workbook.xlsx.writeBuffer()
    return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
  }
  } catch (error) {
    console.error('ExcelJS merge error:', error)
    throw new Error(`Excel template merge failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default { mergeOpsIntoExcelTemplate }
