// backend/src/services/fileAnalyzer.ts
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { logInfo, logError } from '../utils/logger'

/**
 * Column schema information extracted from spreadsheet
 */
export interface ColumnSchema {
  name: string
  dataType: 'text' | 'number' | 'date' | 'boolean' | 'currency' | 'percentage' | 'formula' | 'mixed'
  isEmpty?: boolean
  sampleCount?: number
}

/**
 * Sheet schema with accurate structural information
 */
export interface SheetSchema {
  sheetName: string
  columns: ColumnSchema[]
  rowCount: number // Actual data rows (excluding header)
  headerRowIndex?: number // Which row the header starts at (0-based)
  hasFormulas?: boolean
  isEmpty?: boolean
}

/**
 * Spreadsheet analysis result with accurate counts
 */
export interface SpreadsheetAnalysis {
  sheets: SheetSchema[]
  totalDataRows: number
  totalColumns: number
  hasFormulas: boolean
  hasPivotTables: boolean
  hasCharts: boolean
  sheetNames: string[]
  allColumns: string[] // Unique column names across all sheets
}

/**
 * Detects if a row looks like a header row (mostly text, not too many empty cells)
 */
function looksLikeHeader(row: any[]): boolean {
  if (!row || row.length === 0) return false
  
  const nonEmpty = row.filter(cell => cell !== null && cell !== undefined && cell !== '')
  
  // Header should have at least 40% non-empty cells (was 50%, more lenient now)
  if (nonEmpty.length < row.length * 0.4) return false
  
  // Header cells are usually text strings
  const textCount = nonEmpty.filter(cell => typeof cell === 'string' && cell.length > 0).length
  
  // At least 60% should be text (was 70%, more lenient now)
  return textCount >= nonEmpty.length * 0.6
}

/**
 * Finds the most likely header row in a dataset
 * Returns the row index or -1 if not found
 */
function findHeaderRow(data: any[][]): number {
  if (data.length === 0) return -1
  
  // Look at first 20 rows for header
  const searchLimit = Math.min(data.length, 20)
  let bestHeaderIndex = 0
  let bestScore = 0
  
  for (let i = 0; i < searchLimit; i++) {
    const row = data[i]
    if (!row) continue
    
    const nonEmpty = row.filter(cell => cell !== null && cell !== undefined && cell !== '')
    if (nonEmpty.length === 0) continue
    
    let score = 0
    
    // Check if this looks like a header
    if (looksLikeHeader(row)) {
      score += 10
      
      // Bonus points if next row has similar number of columns with data
      if (i + 1 < data.length) {
        const nextRow = data[i + 1]
        const nonEmptyNext = nextRow.filter(cell => cell !== null && cell !== undefined && cell !== '').length
        
        // If next row has some data in similar positions, this is likely the header
        if (nonEmptyNext >= Math.min(nonEmpty.length * 0.5, 3)) {
          score += 20
        }
        
        // Bonus if multiple data rows follow
        let consecutiveDataRows = 0
        for (let j = i + 1; j < Math.min(i + 6, data.length); j++) {
          const testRow = data[j]
          const testNonEmpty = testRow.filter(cell => cell !== null && cell !== undefined && cell !== '').length
          if (testNonEmpty >= 2) {
            consecutiveDataRows++
          }
        }
        if (consecutiveDataRows >= 3) {
          score += 15
        }
      }
      
      // Penalty for being too far down (headers are usually near the top)
      score -= i * 2
      
      if (score > bestScore) {
        bestScore = score
        bestHeaderIndex = i
      }
    }
  }
  
  if (bestScore > 0) {
    logInfo(`[FILE-ANALYZER] Found header row at index ${bestHeaderIndex} (score: ${bestScore})`)
    return bestHeaderIndex
  }
  
  logInfo(`[FILE-ANALYZER] No clear header row found, using row 0 as fallback`)
  return 0
}

/**
 * Detects the data type of a column based on sample values and cell metadata
 */
function detectColumnType(values: any[], worksheet: XLSX.WorkSheet, colIdx: number, startRow: number): ColumnSchema['dataType'] {
  if (values.length === 0) return 'text'
  
  const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '')
  if (nonEmpty.length === 0) return 'text'
  
  let numberCount = 0
  let dateCount = 0
  let boolCount = 0
  let formulaCount = 0
  let currencyCount = 0
  let percentCount = 0
  let textCount = 0
  
  // Sample up to 100 rows for type detection
  const sampleSize = Math.min(nonEmpty.length, 100)
  
  for (let i = 0; i < sampleSize; i++) {
    const val = values[i]
    if (val === null || val === undefined || val === '') continue
    
    // Get cell reference to check formatting
    const cellRef = XLSX.utils.encode_cell({ r: startRow + i, c: colIdx })
    const cell = worksheet[cellRef]
    
    // Check cell type and format if available
    if (cell) {
      // Check for formula
      if (cell.f) {
        formulaCount++
        continue
      }
      
      // Check cell type (xlsx library sets this)
      // n = number, s = string, b = boolean, d = date, z = stub (empty)
      if (cell.t === 'b') {
        boolCount++
        continue
      }
      
      if (cell.t === 'd') {
        dateCount++
        continue
      }
      
      if (cell.t === 'n') {
        // Check number format for currency or percentage
        const fmt = cell.z || cell.w || ''
        
        if (fmt.includes('$') || fmt.includes('£') || fmt.includes('€') || fmt.includes('¥') || 
            fmt.includes('USD') || fmt.includes('GBP') || fmt.includes('EUR')) {
          currencyCount++
          continue
        }
        
        if (fmt.includes('%')) {
          percentCount++
          continue
        }
        
        // Check if value looks like a date serial number (Excel dates are numbers)
        if (typeof val === 'number' && val > 25569 && val < 70000) { // Rough date range 1970-2090
          // Check if format suggests it's a date
          if (fmt.match(/[dmy]/i) || fmt.includes('/') || fmt.includes('-')) {
            dateCount++
            continue
          }
        }
        
        numberCount++
        continue
      }
    }
    
    // Fallback to value-based detection if no cell metadata
    if (typeof val === 'boolean') {
      boolCount++
      continue
    }
    
    if (val instanceof Date) {
      dateCount++
      continue
    }
    
    if (typeof val === 'number' && !isNaN(val)) {
      numberCount++
      continue
    }
    
    if (typeof val === 'string') {
      // Check string patterns
      if (val.startsWith('=')) {
        formulaCount++
        continue
      }
      
      if (val.match(/^\d+\.?\d*%$/)) {
        percentCount++
        continue
      }
      
      if (val.match(/^[$£€¥]\s?[\d,]+\.?\d*$/)) {
        currencyCount++
        continue
      }
      
      if (['true', 'false', 'yes', 'no'].includes(val.toLowerCase())) {
        boolCount++
        continue
      }
      
      // Try parsing as date
      const dateVal = new Date(val)
      if (!isNaN(dateVal.getTime()) && val.match(/\d{4}|\d{1,2}\/\d{1,2}/)) {
        dateCount++
        continue
      }
      
      // Check if it's a number string
      const numVal = parseFloat(val.replace(/,/g, ''))
      if (!isNaN(numVal) && val.match(/^[\d,.-]+$/)) {
        numberCount++
        continue
      }
      
      textCount++
    }
  }
  
  const total = sampleSize
  const threshold = 0.7 // 70% of values must be same type
  
  // Log type distribution for debugging
  logInfo(`[FILE-ANALYZER] Column ${colIdx} type distribution: text=${textCount}, number=${numberCount}, date=${dateCount}, currency=${currencyCount}, percent=${percentCount}, bool=${boolCount}, formula=${formulaCount}`)
  
  if (formulaCount / total >= threshold) return 'formula'
  if (percentCount / total >= threshold) return 'percentage'
  if (currencyCount / total >= threshold) return 'currency'
  if (boolCount / total >= threshold) return 'boolean'
  if (dateCount / total >= threshold) return 'date'
  if (numberCount / total >= threshold) return 'number'
  if (textCount / total >= threshold) return 'text'
  
  // Check for mixed types
  const typeCount = [numberCount, dateCount, boolCount, formulaCount, currencyCount, percentCount, textCount]
    .filter(c => c > total * 0.15).length // Count types that appear in at least 15% of values
  
  if (typeCount > 1) return 'mixed'
  
  return 'text'
}

/**
 * Quick helper to get the number of sheets in an Excel file without full analysis
 */
export function getExcelSheetCount(filePath: string): number {
  try {
    const buffer = fs.readFileSync(filePath)
    const workbook = XLSX.read(buffer, { type: 'buffer', bookSheets: true })
    return workbook.SheetNames.length
  } catch (err) {
    logError('[FILE-ANALYZER] Failed to read Excel sheet count:', err)
    return 0
  }
}

/**
 * Analyzes a spreadsheet file and extracts accurate structural information
 */
export async function analyzeSpreadsheet(filePath: string): Promise<SpreadsheetAnalysis> {
  logInfo(`[FILE-ANALYZER] Analyzing spreadsheet: ${filePath}`)
  
  try {
    // Read the file
    const buffer = fs.readFileSync(filePath)
    const workbook = XLSX.read(buffer, { 
      type: 'buffer',
      cellFormula: true, // Parse formulas
      cellDates: true     // Parse dates
    })
    
    logInfo(`[FILE-ANALYZER] Found ${workbook.SheetNames.length} sheets`)
    
    const sheets: SheetSchema[] = []
    let totalDataRows = 0
    let hasFormulas = false
    let hasPivotTables = false
    let hasCharts = false
    const allColumns = new Set<string>()
    
    // Analyze each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      
      // Check if sheet is empty
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
      if (range.e.r === 0 && range.e.c === 0) {
        logInfo(`[FILE-ANALYZER] Sheet "${sheetName}" is empty, skipping`)
        sheets.push({
          sheetName,
          columns: [],
          rowCount: 0,
          isEmpty: true
        })
        continue
      }
      
      // Convert to array of arrays for easier processing
      const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })
      
      if (data.length === 0) {
        logInfo(`[FILE-ANALYZER] Sheet "${sheetName}" has no data`)
        sheets.push({
          sheetName,
          columns: [],
          rowCount: 0,
          isEmpty: true
        })
        continue
      }
      
      // Find the actual header row (might not be first row due to summaries/titles)
      const headerRowIndex = findHeaderRow(data)
      if (headerRowIndex === -1) {
        logInfo(`[FILE-ANALYZER] Sheet "${sheetName}" has no identifiable header row`)
        sheets.push({
          sheetName,
          columns: [],
          rowCount: 0,
          isEmpty: true
        })
        continue
      }
      
      const headers = data[headerRowIndex] || []
      const dataRows = data.slice(headerRowIndex + 1)
      
      logInfo(`[FILE-ANALYZER] Sheet "${sheetName}": ${headers.length} columns, ${dataRows.length} data rows`)
      
      // Analyze each column
      const columns: ColumnSchema[] = []
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const colName = String(headers[colIdx] || `Column ${colIdx + 1}`)
        allColumns.add(colName)
        
        // Extract sample values from this column (up to 100 rows for type detection)
        const sampleSize = Math.min(dataRows.length, 100)
        const columnValues = dataRows.slice(0, sampleSize).map(row => row[colIdx])
        
        // Detect data type (pass worksheet for cell metadata)
        const dataType = detectColumnType(columnValues, worksheet, colIdx, headerRowIndex + 1)
        
        // Check if column is empty
        const nonEmpty = columnValues.filter(v => v !== null && v !== undefined && v !== '').length
        
        columns.push({
          name: colName,
          dataType,
          isEmpty: nonEmpty === 0,
          sampleCount: nonEmpty
        })
        
        // Check for formulas
        if (dataType === 'formula') {
          hasFormulas = true
        }
      }
      
      // Count actual data rows (rows with at least one non-empty cell)
      const actualDataRows = dataRows.filter(row => 
        row.some(cell => cell !== null && cell !== undefined && cell !== '')
      ).length
      
      totalDataRows += actualDataRows
      
      sheets.push({
        sheetName,
        columns,
        rowCount: actualDataRows,
        headerRowIndex,
        hasFormulas: columns.some(c => c.dataType === 'formula')
      })
    }
    
    // Check for pivot tables (they appear in workbook.Workbook.Sheets metadata if present)
    if (workbook.Workbook?.Sheets) {
      hasPivotTables = workbook.Workbook.Sheets.some((sheet: any) => sheet.Hidden === 2)
    }
    
    // Check for charts (stored in worksheet['!charts'] if present)
    hasCharts = workbook.SheetNames.some(sheetName => {
      const ws = workbook.Sheets[sheetName]
      return ws['!charts'] !== undefined
    })
    
    const analysis: SpreadsheetAnalysis = {
      sheets,
      totalDataRows,
      totalColumns: allColumns.size,
      hasFormulas,
      hasPivotTables,
      hasCharts,
      sheetNames: workbook.SheetNames,
      allColumns: Array.from(allColumns)
    }
    
    logInfo(`[FILE-ANALYZER] Analysis complete: ${totalDataRows} total data rows across ${sheets.length} sheets`)
    return analysis
    
  } catch (err) {
    logError(`[FILE-ANALYZER] Failed to analyze spreadsheet:`, err)
    throw err
  }
}

/**
 * Analyzes CSV file (simpler format)
 */
export async function analyzeCSV(filePath: string): Promise<SpreadsheetAnalysis> {
  logInfo(`[FILE-ANALYZER] Analyzing CSV: ${filePath}`)
  
  try {
    const buffer = fs.readFileSync(filePath)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    
    // CSV files have a single sheet
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })
    
    if (data.length === 0) {
      return {
        sheets: [],
        totalDataRows: 0,
        totalColumns: 0,
        hasFormulas: false,
        hasPivotTables: false,
        hasCharts: false,
        sheetNames: [],
        allColumns: []
      }
    }
    
    // Find the actual header row
    const headerRowIndex = findHeaderRow(data)
    if (headerRowIndex === -1) {
      logInfo(`[FILE-ANALYZER] CSV has no identifiable header row, treating as data-only`)
      return {
        sheets: [],
        totalDataRows: 0,
        totalColumns: 0,
        hasFormulas: false,
        hasPivotTables: false,
        hasCharts: false,
        sheetNames: [],
        allColumns: []
      }
    }
    
    const headers = data[headerRowIndex] || []
    const dataRows = data.slice(headerRowIndex + 1)
    
    // Analyze columns
    const columns: ColumnSchema[] = []
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const colName = String(headers[colIdx] || `Column ${colIdx + 1}`)
      const sampleSize = Math.min(dataRows.length, 100)
      const columnValues = dataRows.slice(0, sampleSize).map(row => row[colIdx])
      const dataType = detectColumnType(columnValues, worksheet, colIdx, headerRowIndex + 1)
      const nonEmpty = columnValues.filter(v => v !== null && v !== undefined && v !== '').length
      
      columns.push({
        name: colName,
        dataType,
        isEmpty: nonEmpty === 0,
        sampleCount: nonEmpty
      })
    }
    
    const actualDataRows = dataRows.filter(row => 
      row.some(cell => cell !== null && cell !== undefined && cell !== '')
    ).length
    
    const analysis: SpreadsheetAnalysis = {
      sheets: [{
        sheetName: path.basename(filePath, path.extname(filePath)),
        columns,
        rowCount: actualDataRows,
        headerRowIndex
      }],
      totalDataRows: actualDataRows,
      totalColumns: headers.length,
      hasFormulas: false,
      hasPivotTables: false,
      hasCharts: false,
      sheetNames: [path.basename(filePath, path.extname(filePath))],
      allColumns: headers.map(h => String(h))
    }
    
    logInfo(`[FILE-ANALYZER] CSV analysis complete: ${actualDataRows} data rows, ${headers.length} columns`)
    return analysis
    
  } catch (err) {
    logError(`[FILE-ANALYZER] Failed to analyze CSV:`, err)
    throw err
  }
}
