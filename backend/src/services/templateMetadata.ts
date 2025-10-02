// backend/src/services/templateMetadata.ts
import fs from 'fs'
import path from 'path'
import { anythingllmRequest } from './anythingllm'
import { getDB } from './storage'
import { logInfo, logError } from '../utils/logger'
import { analyzeSpreadsheet, type SpreadsheetAnalysis } from './fileAnalyzer'

/**
 * Template metadata structure focusing on template characteristics and requirements
 * (HOW/WHY of the template, not the data content)
 */
export interface TemplateMetadata {
  // Database fields
  id?: number
  templateSlug: string
  templateName: string
  uploadedAt: string
  fileSize?: number
  
  // Template characteristics (WHAT this template does)
  templateType?: string  // 'Report', 'Invoice', 'Letter', 'Spreadsheet', 'Dashboard', 'Form'
  purpose?: string       // What this template is designed to generate
  outputFormat?: string  // 'docx', 'xlsx', 'pdf'
  
  // Structure and requirements (WHAT DATA this template needs)
  requiredDataTypes?: string[]      // ['Financial', 'Inventory', 'Customer', 'Timeline']
  expectedEntities?: string[]       // ['Products', 'Orders', 'Customers', 'Employees']
  dataStructureNeeds?: string[]     // ['Tabular data', 'Time series', 'Hierarchical']
  
  // Template content structure (HOW it's organized)
  hasSections?: string[]            // Section names/types
  hasCharts?: boolean
  hasTables?: boolean
  hasFormulas?: boolean
  tableCount?: number
  chartTypes?: string[]             // ['Bar', 'Line', 'Pie']
  
  // Formatting and styling
  styleTheme?: string               // 'Corporate', 'Modern', 'Minimal', 'Formal'
  colorScheme?: string
  fontFamily?: string
  pageOrientation?: string          // 'Portrait', 'Landscape'
  
  // Content requirements (WHAT OPERATIONS needed)
  requiresAggregation?: boolean     // Needs summaries, totals, averages
  requiresTimeSeries?: boolean      // Needs date-based ordering
  requiresComparisons?: boolean     // Needs before/after comparisons
  requiresFiltering?: boolean       // Needs subset of data
  
  // Metadata about the template itself
  complexity?: string               // 'Simple', 'Moderate', 'Complex'
  estimatedGenerationTime?: string
  targetAudience?: string
  useCases?: string[]               // Scenarios where template is appropriate
  
  // Relationships and compatibility
  compatibleDocumentTypes?: string[] // Document types that work well
  recommendedWorkspaceSize?: string
  
  // System metadata
  lastAnalyzed?: string
  analysisVersion?: number
  workspaceSlug?: string
}

/**
 * Database row type with JSON fields as strings
 */
interface TemplateMetadataRow {
  id: number
  templateSlug: string
  templateName: string
  uploadedAt: string
  fileSize: number | null
  templateType: string | null
  purpose: string | null
  outputFormat: string | null
  requiredDataTypes: string | null
  expectedEntities: string | null
  dataStructureNeeds: string | null
  hasSections: string | null
  hasCharts: number
  hasTables: number
  hasFormulas: number
  tableCount: number | null
  chartTypes: string | null
  styleTheme: string | null
  colorScheme: string | null
  fontFamily: string | null
  pageOrientation: string | null
  requiresAggregation: number
  requiresTimeSeries: number
  requiresComparisons: number
  requiresFiltering: number
  complexity: string | null
  estimatedGenerationTime: string | null
  targetAudience: string | null
  useCases: string | null
  compatibleDocumentTypes: string | null
  recommendedWorkspaceSize: string | null
  lastAnalyzed: string | null
  analysisVersion: number
  workspaceSlug: string | null
}

/**
 * Convert database row to TemplateMetadata object
 */
function rowToMetadata(row: TemplateMetadataRow): TemplateMetadata {
  return {
    id: row.id,
    templateSlug: row.templateSlug,
    templateName: row.templateName,
    uploadedAt: row.uploadedAt,
    fileSize: row.fileSize ?? undefined,
    templateType: row.templateType ?? undefined,
    purpose: row.purpose ?? undefined,
    outputFormat: row.outputFormat ?? undefined,
    requiredDataTypes: row.requiredDataTypes ? JSON.parse(row.requiredDataTypes) : undefined,
    expectedEntities: row.expectedEntities ? JSON.parse(row.expectedEntities) : undefined,
    dataStructureNeeds: row.dataStructureNeeds ? JSON.parse(row.dataStructureNeeds) : undefined,
    hasSections: row.hasSections ? JSON.parse(row.hasSections) : undefined,
    hasCharts: row.hasCharts === 1,
    hasTables: row.hasTables === 1,
    hasFormulas: row.hasFormulas === 1,
    tableCount: row.tableCount ?? undefined,
    chartTypes: row.chartTypes ? JSON.parse(row.chartTypes) : undefined,
    styleTheme: row.styleTheme ?? undefined,
    colorScheme: row.colorScheme ?? undefined,
    fontFamily: row.fontFamily ?? undefined,
    pageOrientation: row.pageOrientation ?? undefined,
    requiresAggregation: row.requiresAggregation === 1,
    requiresTimeSeries: row.requiresTimeSeries === 1,
    requiresComparisons: row.requiresComparisons === 1,
    requiresFiltering: row.requiresFiltering === 1,
    complexity: row.complexity ?? undefined,
    estimatedGenerationTime: row.estimatedGenerationTime ?? undefined,
    targetAudience: row.targetAudience ?? undefined,
    useCases: row.useCases ? JSON.parse(row.useCases) : undefined,
    compatibleDocumentTypes: row.compatibleDocumentTypes ? JSON.parse(row.compatibleDocumentTypes) : undefined,
    recommendedWorkspaceSize: row.recommendedWorkspaceSize ?? undefined,
    lastAnalyzed: row.lastAnalyzed ?? undefined,
    analysisVersion: row.analysisVersion,
    workspaceSlug: row.workspaceSlug ?? undefined
  }
}

/**
 * Analyze template characteristics using AI
 * Focuses on template structure, requirements, and capabilities (not data content)
 */
export async function analyzeTemplateMetadata(
  filePath: string,
  templateSlug: string,
  templateName: string,
  workspaceSlug: string
): Promise<TemplateMetadata> {
  logInfo(`[TEMPLATE-METADATA] Starting analysis for template: ${templateSlug}`)
  
  const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  const ext = path.extname(filePath).toLowerCase()
  const isDocx = ext === '.docx'
  const isExcel = ext === '.xlsx'
  
  let structuralAnalysis = ''
  
  // Pre-analyze spreadsheet structure if applicable
  if (isExcel) {
    try {
      const analysis = await analyzeSpreadsheet(filePath)
      structuralAnalysis = `SPREADSHEET STRUCTURAL ANALYSIS:
- Sheet count: ${analysis.sheets.length}
- Sheets: ${analysis.sheetNames.join(', ')}
- Total data rows: ${analysis.totalDataRows}
- Total columns: ${analysis.totalColumns}
- Has formulas: ${analysis.hasFormulas ? 'Yes' : 'No'}
- Has charts: ${analysis.hasCharts ? 'Yes' : 'No'}
- Has pivot tables: ${analysis.hasPivotTables ? 'Yes' : 'No'}

SHEET DETAILS:
${analysis.sheets.map((s, i) => `Sheet ${i + 1} "${s.sheetName}": ${s.rowCount} data rows, ${s.columns.length} columns`).join('\n')}

COLUMN HEADERS (across all sheets):
${analysis.allColumns.slice(0, 20).join(', ')}${analysis.allColumns.length > 20 ? `... (${analysis.allColumns.length} total)` : ''}
`
    } catch (err) {
      logError('[TEMPLATE-METADATA] Spreadsheet pre-analysis failed:', err)
    }
  }
  
  // Build AI analysis prompt focused on TEMPLATE CHARACTERISTICS
  let analysisPrompt = `You are an expert document automation specialist analyzing a TEMPLATE file.

CRITICAL CONTEXT: This is a TEMPLATE, not a data document. Your job is to understand:
1. WHAT this template is designed to generate (type of output)
2. WHAT DATA INPUTS it needs to work with (data types, entities, structure)
3. HOW it's organized (sections, tables, charts, formatting)
4. WHAT PROCESSING is needed (aggregation, filtering, sorting, calculations)
5. WHO will use the output (target audience)

IGNORE placeholder/sample data values in the template. Focus on the TEMPLATE STRUCTURE and DATA REQUIREMENTS.

`

  if (structuralAnalysis) {
    analysisPrompt += structuralAnalysis + '\n\n'
  }

  if (isExcel) {
    analysisPrompt += `This is a SPREADSHEET TEMPLATE. Analyze it thoroughly.

ANALYZE THESE ASPECTS:
1. **Template Type**: What kind of report/dashboard is this? (Financial Report, Inventory Tracker, Sales Dashboard, Project Status, KPI Dashboard, Budget Planner, etc.)
2. **Purpose**: What business problem does this solve? What information does it communicate?
3. **Data Requirements**: 
   - What TYPES of data does it need? (Financial numbers, Inventory quantities, Customer info, Dates/timelines, Product details, etc.)
   - What ENTITIES are central? (Products, Customers, Orders, Projects, Employees, Transactions, Assets, etc.)
   - What STRUCTURE is needed? (Raw transaction lists, Pre-aggregated summaries, Time-series data, Hierarchical data, etc.)
4. **Operations Needed**:
   - Aggregation? (Does it need SUMs, AVERAGEs, COUNTs, totals?)
   - Time-series? (Does it organize data by dates, show trends over time?)
   - Comparisons? (Does it compare periods, show variances, calculate differences?)
   - Filtering? (Does it show subsets, filtered views, specific categories?)
5. **Visual Elements**: Charts (types?), Tables (how many?), Formulas (present?)
6. **Audience & Use Cases**: Who uses this? When? For what decisions?

EXAMPLES:
- A template with product columns, quantity, cost, and SUM formulas → requiredDataTypes: ["Inventory", "Financial"], expectedEntities: ["Products"], requiresAggregation: true
- A template with monthly columns and line charts → requiredDataTypes: ["Timeline", "Financial"], requiresTimeSeries: true
- A template comparing Q1 vs Q2 → requiresComparisons: true

Return ONLY this JSON structure:

{
  "templateType": "string (Report, Dashboard, Invoice, Analysis, Form, Tracker, Budget, Forecast)",
  "purpose": "string (1-2 sentences: what this template generates and its business purpose)",
  "outputFormat": "xlsx",
  "requiredDataTypes": ["Financial", "Inventory", "Sales", "Customer", "Timeline", "Operational", "Personnel", "Project"],
  "expectedEntities": ["Products", "Orders", "Customers", "Employees", "Transactions", "Projects", "Assets", "Departments"],
  "dataStructureNeeds": ["Tabular data", "Time series", "Aggregated summaries", "Hierarchical", "Key-value pairs", "Transaction list"],
  "hasSections": ["Sheet1 Name", "Sheet2 Name", "Summary", "Details"],
  "hasCharts": true/false,
  "hasTables": true/false,
  "hasFormulas": true/false,
  "tableCount": number (count of data tables, not individual cells),
  "chartTypes": ["Bar", "Line", "Pie", "Scatter", "Area"] (if hasCharts is true),
  "styleTheme": "Corporate" or "Modern" or "Minimal" or "Colorful" or "Technical",
  "colorScheme": "Blue/Gray palette" or "Green/White" or "Multi-color" (describe briefly),
  "pageOrientation": "Landscape" or "Portrait",
  "requiresAggregation": true/false (needs SUM, AVG, COUNT, totals?),
  "requiresTimeSeries": true/false (needs date-based ordering/grouping?),
  "requiresComparisons": true/false (needs before/after, period-over-period, variance?),
  "requiresFiltering": true/false (needs filtered subsets of data?),
  "complexity": "Simple" or "Moderate" or "Complex",
  "estimatedGenerationTime": "Fast (<5s)" or "Moderate (5-15s)" or "Slow (>15s)",
  "targetAudience": "Executives" or "Technical Teams" or "Customers" or "Internal Staff" or "Finance Team" or "Operations Team",
  "useCases": ["Monthly reporting", "Budget planning", "Inventory audit", "Sales review"],
  "compatibleDocumentTypes": ["Financial Reports", "Inventory Lists", "Meeting Notes", "Sales Data", "Customer Records"],
  "recommendedWorkspaceSize": "Small (<10 docs)" or "Medium (10-50)" or "Large (>50)"
}`
  } else if (isDocx) {
    analysisPrompt += `This is a WORD DOCUMENT TEMPLATE (DOCX). Analyze it thoroughly.

ANALYZE THESE ASPECTS:
1. **Template Type**: What kind of document is this? (Business Report, Proposal, Invoice, Letter, Contract, Meeting Minutes, Technical Spec, Summary, etc.)
2. **Purpose**: What is this document used for? What information does it convey?
3. **Data Requirements**:
   - What TYPES of information does it need? (Customer details, Financial figures, Timeline/dates, Product info, Project status, etc.)
   - What ENTITIES are mentioned/needed? (Customers, Products, Orders, Projects, Employees, Systems, Vendors, etc.)
   - What STRUCTURE is expected? (Narrative paragraphs, Bullet/numbered lists, Tables of data, Key-value pairs, etc.)
4. **Operations Needed**:
   - Aggregation? (Does it need summaries, totals, counts?)
   - Time-series? (Does it organize info by dates, show chronology?)
   - Comparisons? (Does it compare options, show before/after?)
   - Filtering? (Does it show selected subsets?)
5. **Structural Elements**: Sections (headers?), Tables (how many?), Lists, Images, Charts
6. **Style & Formatting**: Theme (formal/casual?), Colors, Fonts, Layout
7. **Audience & Use Cases**: Who reads this? Internal/external? Decision-making or informational?

EXAMPLES:
- A template with "Customer Name", "Order #", product table → requiredDataTypes: ["Customer", "Sales"], expectedEntities: ["Customers", "Orders", "Products"]
- A template with monthly progress sections → requiredDataTypes: ["Timeline", "Project"], requiresTimeSeries: true
- A template comparing two proposals → requiresComparisons: true

Return ONLY this JSON structure:

{
  "templateType": "string (Report, Letter, Invoice, Proposal, Contract, Form, Summary, Meeting Minutes, Spec)",
  "purpose": "string (1-2 sentences: what this template generates and its business purpose)",
  "outputFormat": "docx",
  "requiredDataTypes": ["Financial", "Customer", "Timeline", "Inventory", "Operational", "Technical", "Project", "Personnel"],
  "expectedEntities": ["Customers", "Products", "Orders", "Projects", "Employees", "Systems", "Vendors", "Assets", "Contracts"],
  "dataStructureNeeds": ["Narrative text", "Tabular data", "Bullet lists", "Numbered lists", "Key-value pairs", "Hierarchical sections"],
  "hasSections": ["Executive Summary", "Introduction", "Data Analysis", "Recommendations", "Appendix"],
  "hasCharts": true/false,
  "hasTables": true/false,
  "hasFormulas": false (usually for Word),
  "tableCount": number (count of tables in document),
  "styleTheme": "Corporate" or "Modern" or "Formal" or "Minimal" or "Technical",
  "colorScheme": "Blue corporate" or "Neutral grayscale" or "Brand colors" (describe briefly),
  "fontFamily": "Calibri" or "Arial" or "Times New Roman" or "custom",
  "pageOrientation": "Portrait" or "Landscape",
  "requiresAggregation": true/false (needs summaries, totals, counts?),
  "requiresTimeSeries": true/false (needs date-based organization?),
  "requiresComparisons": true/false (needs comparisons or variances?),
  "requiresFiltering": true/false (needs filtered/selected data subsets?),
  "complexity": "Simple" or "Moderate" or "Complex",
  "estimatedGenerationTime": "Fast (<5s)" or "Moderate (5-15s)" or "Slow (>15s)",
  "targetAudience": "Executives" or "Customers" or "Technical Teams" or "Internal Staff" or "Legal/Compliance" or "Partners",
  "useCases": ["Quarterly reporting", "Client proposals", "Project documentation", "Vendor communications"],
  "compatibleDocumentTypes": ["Financial Reports", "Meeting Notes", "Technical Specs", "Inventory Data", "Customer Records", "Project Plans"],
  "recommendedWorkspaceSize": "Small (<10 docs)" or "Medium (10-50)" or "Large (>50)"
}`
  } else {
    // Generic template
    analysisPrompt += `Analyze this template file to understand its purpose and requirements.

Return ONLY a JSON object:

{
  "templateType": "string (type of template)",
  "purpose": "string (what this template generates)",
  "outputFormat": "${ext.replace('.', '')}",
  "requiredDataTypes": ["string (data types needed)"],
  "expectedEntities": ["string (entities/subjects)"],
  "dataStructureNeeds": ["string (data structure requirements)"],
  "complexity": "string (Simple, Moderate, Complex)",
  "targetAudience": "string (intended audience)"
}`
  }
  
  analysisPrompt += `\n\n**CRITICAL INSTRUCTIONS:**
1. Examine the ENTIRE template file content carefully
2. Focus on TEMPLATE STRUCTURE and DATA REQUIREMENTS, not placeholder values
3. Be SPECIFIC and THOROUGH - fill in ALL fields with meaningful values
4. For arrays (requiredDataTypes, expectedEntities, etc.), list MULTIPLE relevant items (aim for 3-5)
5. Set boolean flags (requiresAggregation, requiresTimeSeries, etc.) to true ONLY if clearly needed
6. Consider what workspace documents would provide the data this template needs
7. Return ONLY valid JSON - no markdown code blocks, no explanatory text, just the JSON object

RESPOND WITH THE JSON OBJECT NOW:`

  try {
    logInfo(`[TEMPLATE-METADATA] Sending analysis request to workspace ${workspaceSlug}`)
    logInfo(`[TEMPLATE-METADATA] Prompt length: ${analysisPrompt.length} characters`)
    
    const result = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      'POST',
      { 
        message: analysisPrompt, 
        mode: 'query'
        // Note: temperature parameter removed - not supported by all models
      }
    )
    
    const responseText = String(result?.textResponse || result?.message || '')
    logInfo(`[TEMPLATE-METADATA] Response length: ${responseText.length} characters`)
    logInfo(`[TEMPLATE-METADATA] Response preview: ${responseText.substring(0, 500)}...`)
    
    // Extract JSON from response
    let jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        logInfo('[TEMPLATE-METADATA] Successfully parsed metadata from code block')
        logInfo(`[TEMPLATE-METADATA] Extracted fields: ${Object.keys(parsed).join(', ')}`)
        return {
          templateSlug,
          templateName,
          uploadedAt: new Date().toISOString(),
          fileSize,
          lastAnalyzed: new Date().toISOString(),
          analysisVersion: 1,
          workspaceSlug,
          ...parsed
        }
      } catch (parseErr) {
        logError('[TEMPLATE-METADATA] Failed to parse JSON from code block:', parseErr)
        logError('[TEMPLATE-METADATA] Extracted text:', jsonMatch[1])
      }
    }
    
    // Try parsing entire response as JSON
    try {
      const parsed = JSON.parse(responseText)
      logInfo('[TEMPLATE-METADATA] Successfully parsed metadata from raw response')
      logInfo(`[TEMPLATE-METADATA] Extracted fields: ${Object.keys(parsed).join(', ')}`)
      return {
        templateSlug,
        templateName,
        uploadedAt: new Date().toISOString(),
        fileSize,
        lastAnalyzed: new Date().toISOString(),
        analysisVersion: 1,
        workspaceSlug,
        ...parsed
      }
    } catch (parseErr) {
      logError('[TEMPLATE-METADATA] Could not parse JSON from response')
      logError('[TEMPLATE-METADATA] Parse error:', parseErr)
      logError('[TEMPLATE-METADATA] Full response:', responseText)
    }
  } catch (err) {
    logError('[TEMPLATE-METADATA] AI analysis failed:', err)
    logError('[TEMPLATE-METADATA] Error details:', (err as Error).message)
    logError('[TEMPLATE-METADATA] Error stack:', (err as Error).stack)
  }
  
  // Fallback metadata
  logInfo(`[TEMPLATE-METADATA] Returning fallback metadata for ${templateSlug}`)
  return {
    templateSlug,
    templateName,
    uploadedAt: new Date().toISOString(),
    fileSize,
    outputFormat: ext.replace('.', ''),
    lastAnalyzed: new Date().toISOString(),
    analysisVersion: 1,
    workspaceSlug
  }
}

/**
 * Save template metadata to database
 */
export function saveTemplateMetadata(metadata: TemplateMetadata): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    const sql = `
      INSERT OR REPLACE INTO template_metadata (
        templateSlug, templateName, uploadedAt, fileSize,
        templateType, purpose, outputFormat,
        requiredDataTypes, expectedEntities, dataStructureNeeds,
        hasSections, hasCharts, hasTables, hasFormulas, tableCount, chartTypes,
        styleTheme, colorScheme, fontFamily, pageOrientation,
        requiresAggregation, requiresTimeSeries, requiresComparisons, requiresFiltering,
        complexity, estimatedGenerationTime, targetAudience, useCases,
        compatibleDocumentTypes, recommendedWorkspaceSize,
        lastAnalyzed, analysisVersion, workspaceSlug
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    
    const params = [
      metadata.templateSlug,
      metadata.templateName,
      metadata.uploadedAt || new Date().toISOString(),
      metadata.fileSize ?? null,
      metadata.templateType ?? null,
      metadata.purpose ?? null,
      metadata.outputFormat ?? null,
      metadata.requiredDataTypes ? JSON.stringify(metadata.requiredDataTypes) : null,
      metadata.expectedEntities ? JSON.stringify(metadata.expectedEntities) : null,
      metadata.dataStructureNeeds ? JSON.stringify(metadata.dataStructureNeeds) : null,
      metadata.hasSections ? JSON.stringify(metadata.hasSections) : null,
      metadata.hasCharts ? 1 : 0,
      metadata.hasTables ? 1 : 0,
      metadata.hasFormulas ? 1 : 0,
      metadata.tableCount ?? null,
      metadata.chartTypes ? JSON.stringify(metadata.chartTypes) : null,
      metadata.styleTheme ?? null,
      metadata.colorScheme ?? null,
      metadata.fontFamily ?? null,
      metadata.pageOrientation ?? null,
      metadata.requiresAggregation ? 1 : 0,
      metadata.requiresTimeSeries ? 1 : 0,
      metadata.requiresComparisons ? 1 : 0,
      metadata.requiresFiltering ? 1 : 0,
      metadata.complexity ?? null,
      metadata.estimatedGenerationTime ?? null,
      metadata.targetAudience ?? null,
      metadata.useCases ? JSON.stringify(metadata.useCases) : null,
      metadata.compatibleDocumentTypes ? JSON.stringify(metadata.compatibleDocumentTypes) : null,
      metadata.recommendedWorkspaceSize ?? null,
      metadata.lastAnalyzed || new Date().toISOString(),
      metadata.analysisVersion ?? 1,
      metadata.workspaceSlug ?? null
    ]
    
    db.run(sql, params, (err) => {
      if (err) {
        logError('[TEMPLATE-METADATA-DB] Failed to save:', err)
        reject(err)
      } else {
        logInfo(`[TEMPLATE-METADATA-DB] Saved metadata for ${metadata.templateSlug}`)
        resolve()
      }
    })
  })
}

/**
 * Load template metadata from database
 */
export function loadTemplateMetadata(templateSlug: string): Promise<TemplateMetadata | null> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.get<TemplateMetadataRow>(
      'SELECT * FROM template_metadata WHERE templateSlug = ?',
      [templateSlug],
      (err, row) => {
        if (err) {
          logError('[TEMPLATE-METADATA-DB] Failed to load:', err)
          reject(err)
        } else if (row) {
          logInfo(`[TEMPLATE-METADATA-DB] Loaded metadata for ${templateSlug}`)
          resolve(rowToMetadata(row))
        } else {
          logInfo(`[TEMPLATE-METADATA-DB] No metadata found for ${templateSlug}`)
          resolve(null)
        }
      }
    )
  })
}

/**
 * Load all template metadata
 */
export function loadAllTemplateMetadata(): Promise<TemplateMetadata[]> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.all<TemplateMetadataRow>(
      'SELECT * FROM template_metadata ORDER BY templateName',
      [],
      (err, rows) => {
        if (err) {
          logError('[TEMPLATE-METADATA-DB] Failed to load all:', err)
          reject(err)
        } else {
          resolve(rows.map(rowToMetadata))
        }
      }
    )
  })
}

/**
 * Delete template metadata from database
 */
export function deleteTemplateMetadata(templateSlug: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.run(
      'DELETE FROM template_metadata WHERE templateSlug = ?',
      [templateSlug],
      (err) => {
        if (err) {
          logError('[TEMPLATE-METADATA-DB] Failed to delete:', err)
          reject(err)
        } else {
          logInfo(`[TEMPLATE-METADATA-DB] Deleted metadata for ${templateSlug}`)
          resolve()
        }
      }
    )
  })
}

/**
 * Find templates compatible with a given set of document types
 */
export async function findCompatibleTemplates(
  documentTypes: string[]
): Promise<TemplateMetadata[]> {
  const allTemplates = await loadAllTemplateMetadata()
  
  return allTemplates.filter(template => {
    if (!template.compatibleDocumentTypes || template.compatibleDocumentTypes.length === 0) {
      return false
    }
    
    // Check if any document type matches any compatible type (case-insensitive partial match)
    return documentTypes.some(docType => 
      template.compatibleDocumentTypes!.some(compatType =>
        compatType.toLowerCase().includes(docType.toLowerCase()) ||
        docType.toLowerCase().includes(compatType.toLowerCase())
      )
    )
  })
}
