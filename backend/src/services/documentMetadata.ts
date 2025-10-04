// backend/src/services/documentMetadata.ts
import fs from 'fs'
import path from 'path'
import { anythingllmRequest } from './anythingllm'
import { getDB } from './storage'
import { logInfo, logError } from '../utils/logger'
import { analyzeSpreadsheet, analyzeCSV, type SpreadsheetAnalysis } from './fileAnalyzer'
import { calculateDocumentTemplateRelevance, type DocumentMatch } from './metadataMatching'

/**
 * Document metadata structure for enhanced RAG and intelligent analysis
 */
export interface DocumentMetadata {
  // Database fields
  id?: number
  customerId: number
  filename: string
  anythingllmPath?: string  // Full path in AnythingLLM (e.g., "Customer_Oct_2025/file-hash.json")
  uploadedAt: string
  fileSize?: number
  
  // AI-detected document properties
  documentType?: string  // 'discovery-session', 'requirements', 'meeting-notes', 'technical-spec', etc.
  purpose?: string       // Brief description of document purpose
  
  // Content analysis (stored as JSON arrays in DB)
  keyTopics?: string[]           // Main topics/themes discussed
  dataCategories?: string[]      // Types of data present (dates, financials, technical, etc.)
  mentionedSystems?: string[]    // Applications/systems mentioned
  stakeholders?: string[]        // People/roles mentioned
  
  // Structural info
  estimatedPageCount?: number
  estimatedWordCount?: number
  hasTables?: boolean
  hasImages?: boolean
  hasCodeSamples?: boolean
  
  // Date/timeline info
  dateRange?: string             // "2024-01-01 to 2024-03-31" or single date
  meetingDate?: string           // If this is meeting notes
  
  // Relationships
  relatedDocuments?: string[]    // Names of related documents in workspace
  supersedes?: string            // Document this replaces
  
  // User-provided metadata
  tags?: string[]
  description?: string
  
  // Document-type-specific fields (stored as JSON)
  extraFields?: Record<string, any>  // Flexible storage for type-specific metadata
  
  // System metadata
  lastAnalyzed?: string
  analysisVersion?: number
}

/**
 * Database row type with JSON fields as strings
 */
interface DocumentMetadataRow {
  id: number
  customerId: number
  filename: string
  anythingllmPath: string | null
  uploadedAt: string
  fileSize: number | null
  documentType: string | null
  purpose: string | null
  keyTopics: string | null
  dataCategories: string | null
  mentionedSystems: string | null
  stakeholders: string | null
  estimatedPageCount: number | null
  estimatedWordCount: number | null
  hasTables: number
  hasImages: number
  hasCodeSamples: number
  dateRange: string | null
  meetingDate: string | null
  relatedDocuments: string | null
  supersedes: string | null
  tags: string | null
  description: string | null
  extraFields: string | null
  lastAnalyzed: string | null
  analysisVersion: number
}

/**
 * Convert database row to DocumentMetadata object
 */
function rowToMetadata(row: DocumentMetadataRow): DocumentMetadata {
  return {
    id: row.id,
    customerId: row.customerId,
    filename: row.filename,
    anythingllmPath: row.anythingllmPath ?? undefined,
    uploadedAt: row.uploadedAt,
    fileSize: row.fileSize ?? undefined,
    documentType: row.documentType ?? undefined,
    purpose: row.purpose ?? undefined,
    keyTopics: row.keyTopics ? JSON.parse(row.keyTopics) : undefined,
    dataCategories: row.dataCategories ? JSON.parse(row.dataCategories) : undefined,
    mentionedSystems: row.mentionedSystems ? JSON.parse(row.mentionedSystems) : undefined,
    stakeholders: row.stakeholders ? JSON.parse(row.stakeholders) : undefined,
    estimatedPageCount: row.estimatedPageCount ?? undefined,
    estimatedWordCount: row.estimatedWordCount ?? undefined,
    hasTables: Boolean(row.hasTables),
    hasImages: Boolean(row.hasImages),
    hasCodeSamples: Boolean(row.hasCodeSamples),
    dateRange: row.dateRange ?? undefined,
    meetingDate: row.meetingDate ?? undefined,
    relatedDocuments: row.relatedDocuments ? JSON.parse(row.relatedDocuments) : undefined,
    supersedes: row.supersedes ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    description: row.description ?? undefined,
    extraFields: row.extraFields ? JSON.parse(row.extraFields) : undefined,
    lastAnalyzed: row.lastAnalyzed ?? undefined,
    analysisVersion: row.analysisVersion
  }
}

/**
 * Analyzes a document using AI to extract comprehensive metadata
 * @param filePath - Local file path for getting file size
 * @param filename - Original filename
 * @param workspaceSlug - AnythingLLM workspace slug
 * @param documentName - The specific document name/identifier in AnythingLLM (e.g., "custom-documents/myfile.pdf")
 */
export async function analyzeDocumentMetadata(
  filePath: string,
  filename: string,
  workspaceSlug: string,
  documentName?: string,
  anythingllmPath?: string
): Promise<DocumentMetadata> {
  const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  const fileExt = path.extname(filename).toLowerCase()
  
  // Build document-specific prompt that explicitly tells AI which document to analyze
  // Use the document name to target the specific file in the workspace
  const targetDoc = documentName || filename
  
  // Determine document type category for intelligent analysis
  const isSpreadsheet = ['.xlsx', '.xls', '.csv', '.tsv', '.ods'].includes(fileExt)
  const isPresentation = ['.pptx', '.ppt', '.odp', '.key'].includes(fileExt)
  const isCode = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.rb', '.go', '.rs', '.php', '.sql'].includes(fileExt)
  const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff'].includes(fileExt)
  const isDocument = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.md'].includes(fileExt)
  
  // Build intelligent prompt based on document type
  let analysisPrompt = `Please analyze the document named "${targetDoc}" in this workspace.\n\nIMPORTANT: Focus your analysis ONLY on the document "${targetDoc}". Do not analyze other documents in the workspace.\n\n`
  
  // Pre-analyze spreadsheet files to get accurate structural data
  let spreadsheetData: SpreadsheetAnalysis | null = null
  if (isSpreadsheet && filePath) {
    try {
      const fileExt = path.extname(filePath).toLowerCase()
      if (fileExt === '.csv' || fileExt === '.tsv') {
        spreadsheetData = await analyzeCSV(filePath)
      } else {
        spreadsheetData = await analyzeSpreadsheet(filePath)
      }
      logInfo(`[METADATA] Pre-analyzed spreadsheet: ${spreadsheetData.totalDataRows} rows, ${spreadsheetData.totalColumns} columns`)
    } catch (err) {
      logError('[METADATA] Failed to pre-analyze spreadsheet:', err)
      // Continue with AI-only analysis as fallback
    }
  }

  if (isSpreadsheet) {
    if (spreadsheetData) {
      // Use hybrid approach: we have structural data, ask AI only for semantic understanding
      analysisPrompt += `This is a SPREADSHEET file. I have already analyzed the file structure. Your job is to provide semantic understanding.

**PRE-ANALYZED STRUCTURAL DATA (already accurate):**
- Total data rows: ${spreadsheetData.totalDataRows}
- Total columns: ${spreadsheetData.totalColumns}
- Sheet names: ${spreadsheetData.sheetNames.join(', ')}
- Column headers: ${spreadsheetData.allColumns.join(', ')}

CRITICAL INSTRUCTIONS:
- DO NOT count rows/columns - values above are accurate
- Focus on WHAT DATA this spreadsheet CONTAINS
- Use STANDARDIZED data type taxonomy: Financial, Inventory, Sales, Customer, Timeline, Operational, Personnel, Project, Product, Order, Asset, Technical, Marketing, HR, Compliance, Quality, Manufacturing, Supply Chain
- Identify main ENTITIES (Customers, Products, Orders, Employees, Projects, Transactions, Assets, etc.)
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object:

{
  "documentType": "Spreadsheet",
  "purpose": "string (what this spreadsheet tracks and its business context)",
  "keyTopics": ["string (2-4 words: Sales Data, Inventory, Financial Report)"],
  "dataCategories": ["string - USE ONLY THESE: Financial, Inventory, Sales, Customer, Timeline, Operational, Personnel, Project, Product, Order, Asset, Technical, Marketing, HR, Compliance, Quality, Manufacturing, Supply Chain"],
  "primaryEntities": ["string - BE SPECIFIC: Customers, Products, Orders, Transactions, Employees, Projects, Assets, Vendors, Invoices, Inventory Items, Sales Leads, Contracts, Services"],
  "dataType": "string (Transactional, Analytical, Master Data, Reference, Operational, Summary)",
  "aggregationLevel": "string (Detail-level, Daily Aggregates, Monthly Summaries, Annual Totals)",
  "metrics": ["string (Revenue, Quantity, Cost, Duration, Count, Percentage, Profit, Growth Rate)"],
  "calculatedFields": ["string (Total Revenue, Growth %, Year-over-Year, Profit Margin)"],
  "dataRelationships": "string (foreign keys, lookup tables, if present)",
  "stakeholders": ["string (2-3 words: teams/people who use this)"],
  "departments": ["string (Sales, Finance, Operations, HR, Marketing, IT, Engineering)"],
  "mentionedSystems": ["string (1-3 words: source systems like Salesforce, SAP, QuickBooks)"],
  "dateRange": "string (YYYY-MM-DD to YYYY-MM-DD or Q3 2024)",
  "timeframe": "string (Monthly, Quarterly, Annual, Weekly, Daily, YTD)",
  "geography": "string (regions/locations data covers)",
  "relatedDocuments": ["string (names of related documents)"]
}`
    } else {
      // Fallback: AI-only analysis (structural data couldn't be pre-analyzed)
      analysisPrompt += `This is a SPREADSHEET file. Analyze the content.

CRITICAL INSTRUCTIONS:
- Count ACTUAL data rows (excluding headers)
- Identify main ENTITIES in the data
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object:

{
  "documentType": "Spreadsheet",
  "purpose": "string (what this spreadsheet tracks)",
  "keyTopics": ["string (2-4 words: Inventory, Sales Data)"],
  "dataCategories": ["string (Financial, Sales, Inventory, Operational)"],
  "primaryEntities": ["string (Customers, Products, Orders)"],
  "sheetNames": ["string (ALL sheet names)"],
  "columnHeaders": ["string (ALL column headers from main sheet)"],
  "dataRowCount": number (ACTUAL data rows, not including headers),
  "hasFormulas": boolean,
  "hasCharts": boolean,
  "dateRange": "string (YYYY-MM-DD to YYYY-MM-DD)",
  "metrics": ["string (Revenue, Quantity, Cost)"],
  "stakeholders": ["string (2-3 words: Sales Team, Finance)"],
  "mentionedSystems": ["string (1-3 words: Salesforce, SAP)"],
  "relatedDocuments": ["string (related document names)"]
}`
    }
  } else if (isPresentation) {
    analysisPrompt += `This is a PRESENTATION file. Analyze the slides and content.

CRITICAL INSTRUCTIONS:
- COUNT actual slides
- Focus on DATA and CONTENT presented
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object:

{
  "documentType": "Presentation",
  "purpose": "string (what data/content this presentation communicates)",
  "presentationType": "string (Sales Pitch, Training, Status Update, Data Report, Business Case)",
  "keyTopics": ["string (2-4 words: Q3 Results, Product Launch)"],
  "slideCount": number (ACTUAL slide count),
  "targetAudience": "string (executives, technical team, customers)",
  "dataCategories": ["string (Financial, Performance Metrics, Operational, Technical)"],
  "primaryEntities": ["string (Products, Customers, Projects, Systems)"],
  "metrics": ["string (Revenue Growth, Customer Acquisition, System Uptime)"],
  "hasCharts": boolean,
  "hasImages": boolean,
  "hasTables": boolean,
  "stakeholders": ["string (2-3 words: teams or people)"],
  "departments": ["string (departments involved)"],
  "mentionedSystems": ["string (1-3 words: systems/tools)"],
  "dateRange": "string (YYYY-MM-DD to YYYY-MM-DD or Q3 2024)",
  "timeframe": "string (Monthly Review, Quarterly Report)",
  "relatedDocuments": ["string (related document names)"]
}
  "targetAudience": "string (who is this presentation intended for: executives, technical team, customers, all-hands)",
  "dataCategories": ["string (types of data presented: Financial, Performance Metrics, Operational, Strategic, Technical)"],
  "metrics": ["string (key metrics shown: Revenue Growth, Customer Acquisition, System Uptime, Project Status)"],
  "hasCharts": boolean,
  "hasImages": boolean,
  "hasTables": boolean,
  "stakeholders": ["string (SHORT labels, 2-3 words: teams or people relevant to this presentation)"],
  "departments": ["string (departments involved or presenting to)"],
  "mentionedSystems": ["string (SHORT labels, 1-3 words: systems, tools, or platforms discussed)"],
  "dateRange": "string (if presentation covers a time period, format: YYYY-MM-DD to YYYY-MM-DD or Q3 2024)",
  "timeframe": "string (temporal context: Monthly Review, Quarterly Report, Annual Summary, Project Phase)",
  "relatedDocuments": ["string (names of related documents in this workspace)"]
}`
  } else if (isCode) {
    analysisPrompt += `This is a CODE/SCRIPT file. Analyze the source code.

CRITICAL INSTRUCTIONS:
- Focus on DATA MODELS and API structure
- Identify main ENTITIES and OPERATIONS
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object:

{
  "documentType": "Source Code",
  "purpose": "string (what this code does and its role)",
  "codeType": "string (Backend, Frontend, API, Database Schema, Script, Library, Test Suite)",
  "programmingLanguage": "string (Python, TypeScript, Java, etc.)",
  "framework": "string (React, Express, Django, Spring)",
  "primaryEntities": ["string (data models: User, Order, Product, Customer)"],
  "keyOperations": ["string (2-3 words: Create Order, Fetch User, Process Payment)"],
  "apiEndpoints": ["string (2-4 words: /api/customers, GET /orders)"],
  "dataModels": ["string (entities: User, Order, Product, Transaction)"],
  "databaseTables": ["string (1-3 words: users, orders, products)"],
  "mentionedSystems": ["string (1-3 words: PostgreSQL, Redis, AWS S3)"],
  "technicalContext": "string (API layer, data processing, UI components, authentication, database schema)",
  "estimatedLineCount": number,
  "hasTests": boolean,
  "relatedDocuments": ["string (related document names)"]
}`
  } else if (isImage) {
    analysisPrompt += `This is an IMAGE file. Analyze visible elements.

CRITICAL INSTRUCTIONS:
- Describe visible data, systems, and structure
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object:

{
  "documentType": "Image",
  "purpose": "string (what this image shows and its use)",
  "imageContent": "string (description of visible elements and data)",
  "imageType": "string (Screenshot, Diagram, Chart, Mockup, Flowchart, Whiteboard)",
  "containsText": boolean,
  "visibleData": ["string (data/metrics shown: Revenue Chart, User Count, System Status)"],
  "mentionedSystems": ["string (1-3 words: AWS Console, VS Code, Database)"],
  "stakeholders": ["string (2-3 words: teams or people visible)"],
  "relatedDocuments": ["string (related document names)"]
}`
  } else {
    // Default for documents (PDF, Word, etc.)
    analysisPrompt += `This is a DOCUMENT file. Analyze the ACTUAL content thoroughly.

CRITICAL INSTRUCTIONS:
- Focus on WHAT DATA this document CONTAINS
- Use STANDARDIZED data type taxonomy: Financial, Inventory, Sales, Customer, Timeline, Operational, Personnel, Project, Product, Order, Asset, Technical, Marketing, HR, Compliance, Quality, Manufacturing, Supply Chain
- For stakeholders: identify PEOPLE, DEPARTMENTS, TEAMS mentioned
- For systems: identify SOFTWARE, APPLICATIONS, PLATFORMS discussed
- For entities: BE SPECIFIC about main SUBJECTS (Customers, Products, Orders, Projects, Employees, etc.)
- KEEP ALL TAGS SHORT (2-4 words max)

Return ONLY a JSON object with this structure:

{
  "documentType": "string (Business Report, Meeting Notes, Proposal, Contract, Tech Spec, Requirements, Discovery)",
  "purpose": "string (1-2 sentences: what data/information this document contains and its use)",
  "keyTopics": ["string (2-4 words: Q3 Results, API Design, Budget Planning)"],
  "dataCategories": ["string - USE ONLY THESE: Financial, Inventory, Sales, Customer, Timeline, Operational, Personnel, Project, Product, Order, Asset, Technical, Marketing, HR, Compliance, Quality, Manufacturing, Supply Chain"],
  "primaryEntities": ["string - BE SPECIFIC: Customers, Products, Orders, Transactions, Employees, Projects, Assets, Vendors, Invoices, Inventory Items, Sales Leads, Contracts, Services, Systems, APIs"],
  "dataStructure": "string (Narrative document, Tabular data, Mixed format, Forms/Templates, Technical)",
  "mentionedSystems": ["string (1-3 words: Salesforce, Azure, Teams, SAP, QuickBooks, Jira)"],
  "stakeholders": ["string (2-3 words: Sales Team, John S., Engineering)"],
  "departments": ["string (Sales, Engineering, Finance, HR, Operations, Marketing, IT)"],
  "metrics": ["string (Revenue, Units Sold, Response Time, Count, Conversion Rate, Profit)"],
  "dateRange": "string (YYYY-MM-DD to YYYY-MM-DD or Q3 2024)",
  "meetingDate": "string (if meeting notes: YYYY-MM-DD)",
  "timeframe": "string (Monthly, Quarterly, Annual, YTD, Historical)",
  "geography": "string (US, EMEA, Global, New York office)",
  "industry": "string (Healthcare, Finance, Retail, Technology)",
  "estimatedPageCount": number,
  "estimatedWordCount": number,
  "hasTables": boolean,
  "hasImages": boolean,
  "hasCodeSamples": boolean,
  "relatedDocuments": ["string (names of related documents in workspace)"]
}`
  }
  
  analysisPrompt += `\n\nCRITICAL REQUIREMENTS:
- Analyze the COMPLETE document content, not just a sample
- For counts (rows, pages, slides, words): provide ACTUAL counts from the full document
- For stakeholders: ONLY include people (by name), departments, teams, roles, or business units that are EXPLICITLY mentioned or clearly relevant to the document content
- For systems: ONLY include software/applications/platforms that are SPECIFICALLY named in the document
- KEEP ALL TAGS SHORT: Maximum 2-4 words per tag for keyTopics, dataCategories, stakeholders, mentionedSystems, etc.
  - Good: "Sales Team", "API Design", "Salesforce", "John S."
  - Bad: "The Sales and Marketing Team for the Western Region", "Application Programming Interface Design and Implementation"
- Be accurate and thorough - examine the entire document before responding

Return ONLY a valid JSON object with the exact structure specified above. No markdown formatting, no additional text, just pure JSON.`

  try {
    logInfo(`[METADATA] Sending analysis request to workspace ${workspaceSlug}`)
    logInfo(`[METADATA] Target document: "${targetDoc}"`)
    logInfo(`[METADATA] Document type detected: ${isSpreadsheet ? 'Spreadsheet' : isPresentation ? 'Presentation' : isCode ? 'Code' : isImage ? 'Image' : 'Document'}`)
    
    // Use query mode and potentially document pinning if supported
    const result = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      'POST',
      { 
        message: analysisPrompt, 
        mode: 'query'
        // Note: temperature parameter removed - not supported by all models
        // Note: Some AnythingLLM versions support 'sources' parameter to pin specific documents
        // sources: documentName ? [documentName] : undefined
      }
    )
    
    logInfo(`[METADATA] Got response from AnythingLLM: ${JSON.stringify(result, null, 2)}`)
    const responseText = String(result?.textResponse || result?.message || '')
    logInfo(`[METADATA] Response text length: ${responseText.length} characters`)
    logInfo(`[METADATA] Response text preview: ${responseText.substring(0, 1000)}`)
    
    // Try to extract JSON - look for both code blocks and raw JSON
    let jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (jsonMatch) {
      // Found JSON in markdown code block
      jsonMatch[0] = jsonMatch[1]
      logInfo(`[METADATA] Found JSON in markdown code block`)
    } else {
      // Try to find raw JSON
      jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        logInfo(`[METADATA] Found raw JSON in response`)
      }
    }
    
    if (jsonMatch) {
      logInfo(`[METADATA] Attempting to parse JSON...`)
      logInfo(`[METADATA] JSON string: ${jsonMatch[0].substring(0, 500)}...`)
      
      try {
        const parsed = JSON.parse(jsonMatch[0])
        logInfo(`[METADATA] Successfully parsed JSON: ${JSON.stringify(parsed, null, 2)}`)
      
        // Extract type-specific fields into extraFields (declare first before using)
        const extraFields: Record<string, any> = {}
        
        // For spreadsheets, merge pre-analyzed structural data if available
        if (spreadsheetData && isSpreadsheet) {
          logInfo(`[METADATA] Merging pre-analyzed spreadsheet data with AI semantic analysis`)
          // Override with accurate structural data
          extraFields.dataRowCount = spreadsheetData.totalDataRows
          extraFields.columnCount = spreadsheetData.totalColumns
          extraFields.sheetNames = spreadsheetData.sheetNames
          extraFields.columnHeaders = spreadsheetData.allColumns
          extraFields.hasFormulas = spreadsheetData.hasFormulas
          extraFields.hasPivotTables = spreadsheetData.hasPivotTables
          extraFields.hasCharts = spreadsheetData.hasCharts
          
          // Build schemas array with column descriptions from both sources
          extraFields.schemas = spreadsheetData.sheets
            .filter(sheet => !sheet.isEmpty && sheet.columns.length > 0)
            .map(sheet => ({
              sheetName: sheet.sheetName,
              columns: sheet.columns
                .filter(col => !col.isEmpty)
                .map(col => ({
                  name: col.name,
                  dataType: col.dataType,
                  description: '' // AI doesn't need to provide this anymore
                })),
              rowCount: sheet.rowCount
            }))
        }
      
        // Extract common fields
        const commonFields = {
          customerId: 0, // Will be set by caller
          filename,
          anythingllmPath,
          uploadedAt: new Date().toISOString(),
          fileSize,
          documentType: parsed.documentType,
          purpose: parsed.purpose,
          keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
          dataCategories: Array.isArray(parsed.dataCategories) ? parsed.dataCategories : [],
          mentionedSystems: Array.isArray(parsed.mentionedSystems) ? parsed.mentionedSystems : [],
          stakeholders: Array.isArray(parsed.stakeholders) ? parsed.stakeholders : [],
          estimatedPageCount: parsed.estimatedPageCount,
          estimatedWordCount: parsed.estimatedWordCount,
          hasTables: Boolean(parsed.hasTables || parsed.hasCharts),
          hasImages: Boolean(parsed.hasImages),
          hasCodeSamples: Boolean(parsed.hasCodeSamples),
          dateRange: parsed.dateRange,
          meetingDate: parsed.meetingDate,
          relatedDocuments: Array.isArray(parsed.relatedDocuments) ? parsed.relatedDocuments : [],
          lastAnalyzed: new Date().toISOString(),
          analysisVersion: 1
        }
        const commonKeys = new Set([
          'documentType', 'purpose', 'keyTopics', 'dataCategories', 'mentionedSystems', 
          'stakeholders', 'estimatedPageCount', 'estimatedWordCount', 'hasTables', 
          'hasImages', 'hasCodeSamples', 'dateRange', 'meetingDate', 'relatedDocuments'
        ])
        
        // Store any additional fields from the parsed response
        for (const key in parsed) {
          if (!commonKeys.has(key) && parsed[key] !== null && parsed[key] !== undefined) {
            extraFields[key] = parsed[key]
          }
        }
        
        logInfo(`[METADATA] Extracted metadata successfully, returning...`)
        return {
          ...commonFields,
          extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined
        }
      } catch (parseErr) {
        logError('[METADATA] Failed to parse JSON from response:', parseErr)
        logError(`[METADATA] Raw JSON that failed to parse (first 1000 chars): ${jsonMatch[0].substring(0, 1000)}`)
        logError(`[METADATA] Parse error details: ${(parseErr as Error).message}`)
      }
    } else {
      logError(`[METADATA] No JSON found in response!`)
      logError(`[METADATA] Full response text: ${responseText}`)
    }
  } catch (err) {
    logError('[METADATA] AI metadata analysis failed:', err)
    logError(`[METADATA] Error details: ${(err as Error).message}`)
    logError(`[METADATA] Error stack: ${(err as Error).stack}`)
  }
  
  // Fallback metadata
  logError(`[METADATA] Returning fallback metadata for ${filename} - analysis failed or incomplete`)
  return {
    customerId: 0, // Will be set by caller
    filename,
    anythingllmPath,
    uploadedAt: new Date().toISOString(),
    fileSize,
    lastAnalyzed: new Date().toISOString(),
    analysisVersion: 1
  }
}

/**
 * Saves metadata to database
 * Also calculates and stores template relevance scores using AI
 */
export async function saveDocumentMetadata(
  customerId: number,
  metadata: DocumentMetadata,
  workspaceSlug?: string
): Promise<void> {
  // Calculate template relevance scores using AI if workspace available
  try {
    const templateRelevance = await calculateDocumentTemplateRelevance(metadata, workspaceSlug)
    
    // Store top 10 template matches in extraFields
    const topMatches = templateRelevance.slice(0, 10).map(t => ({
      slug: t.templateSlug,
      name: t.templateName,
      score: t.score,
      reasoning: t.reasoning
    }))
    
    if (topMatches.length > 0) {
      metadata.extraFields = metadata.extraFields || {}
      metadata.extraFields.templateRelevance = topMatches
      logInfo(`[METADATA] Calculated template relevance: Top match is ${topMatches[0].name} (${topMatches[0].score}/10)`)
    }
  } catch (err) {
    logError('[METADATA] Failed to calculate template relevance:', err)
    // Continue saving metadata even if template relevance calculation fails
  }
  
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    const sql = `
      INSERT OR REPLACE INTO document_metadata (
        customerId, filename, anythingllmPath, uploadedAt, fileSize,
        documentType, purpose,
        keyTopics, dataCategories, mentionedSystems, stakeholders,
        estimatedPageCount, estimatedWordCount,
        hasTables, hasImages, hasCodeSamples,
        dateRange, meetingDate,
        relatedDocuments, supersedes, tags, description,
        extraFields,
        lastAnalyzed, analysisVersion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    
    const params = [
      customerId,
      metadata.filename,
      metadata.anythingllmPath ?? null,
      metadata.uploadedAt || new Date().toISOString(),
      metadata.fileSize ?? null,
      metadata.documentType ?? null,
      metadata.purpose ?? null,
      metadata.keyTopics ? JSON.stringify(metadata.keyTopics) : null,
      metadata.dataCategories ? JSON.stringify(metadata.dataCategories) : null,
      metadata.mentionedSystems ? JSON.stringify(metadata.mentionedSystems) : null,
      metadata.stakeholders ? JSON.stringify(metadata.stakeholders) : null,
      metadata.estimatedPageCount ?? null,
      metadata.estimatedWordCount ?? null,
      metadata.hasTables ? 1 : 0,
      metadata.hasImages ? 1 : 0,
      metadata.hasCodeSamples ? 1 : 0,
      metadata.dateRange ?? null,
      metadata.meetingDate ?? null,
      metadata.relatedDocuments ? JSON.stringify(metadata.relatedDocuments) : null,
      metadata.supersedes ?? null,
      metadata.tags ? JSON.stringify(metadata.tags) : null,
      metadata.description ?? null,
      metadata.extraFields ? JSON.stringify(metadata.extraFields) : null,
      metadata.lastAnalyzed || new Date().toISOString(),
      metadata.analysisVersion ?? 1
    ]
    
    db.run(sql, params, (err) => {
      if (err) {
        logError('[METADATA-DB] Failed to save metadata:', err)
        reject(err)
      } else {
        logInfo(`[METADATA-DB] Successfully saved metadata for ${metadata.filename} (customer ${customerId})`)
        resolve()
      }
    })
  })
}

/**
 * Loads metadata from database
 */
export function loadDocumentMetadata(
  customerId: number,
  filename: string
): Promise<DocumentMetadata | null> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.get<DocumentMetadataRow>(
      'SELECT * FROM document_metadata WHERE customerId = ? AND filename = ?',
      [customerId, filename],
      (err, row) => {
        if (err) {
          logError('[METADATA-DB] Failed to load metadata:', err)
          reject(err)
        } else if (row) {
          logInfo(`[METADATA-DB] Loaded metadata for ${filename} (customer ${customerId})`)
          resolve(rowToMetadata(row))
        } else {
          logInfo(`[METADATA-DB] No metadata found for ${filename} (customer ${customerId})`)
          resolve(null)
        }
      }
    )
  })
}

/**
 * Loads all metadata for a customer
 */
export function loadAllDocumentMetadata(
  customerId: number
): Promise<DocumentMetadata[]> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.all<DocumentMetadataRow>(
      'SELECT * FROM document_metadata WHERE customerId = ? ORDER BY uploadedAt DESC',
      [customerId],
      (err, rows) => {
        if (err) {
          console.error('Failed to load metadata:', err)
          reject(err)
        } else {
          resolve(rows.map(rowToMetadata))
        }
      }
    )
  })
}

/**
 * Updates existing metadata
 */
export function updateDocumentMetadata(
  customerId: number,
  filename: string,
  updates: Partial<DocumentMetadata>
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const existing = await loadDocumentMetadata(customerId, filename)
      if (!existing) {
        reject(new Error('Metadata not found'))
        return
      }
      
      const merged = { ...existing, ...updates, customerId, filename }
      await saveDocumentMetadata(customerId, merged)
      resolve()
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Deletes metadata from database
 */
export function deleteDocumentMetadata(
  customerId: number,
  filename: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = getDB()
    
    db.run(
      'DELETE FROM document_metadata WHERE customerId = ? AND filename = ?',
      [customerId, filename],
      (err) => {
        if (err) {
          console.error('Failed to delete metadata:', err)
          reject(err)
        } else {
          resolve()
        }
      }
    )
  })
}

/**
 * Generates a workspace-level index of all documents
 * Useful for providing AI with quick overview of available documents
 */
export async function generateWorkspaceIndex(
  customerId: number
): Promise<string> {
  try {
    const allMetadata = await loadAllDocumentMetadata(customerId)
    
    if (allMetadata.length === 0) {
      return 'No documents found in workspace.'
    }
    
    let index = `WORKSPACE DOCUMENT INDEX (${allMetadata.length} documents):\n\n`
    
    allMetadata.forEach((meta, idx) => {
      index += `${idx + 1}. ${meta.filename}\n`
      if (meta.documentType) index += `   Type: ${meta.documentType}\n`
      if (meta.purpose) index += `   Purpose: ${meta.purpose}\n`
      if (meta.keyTopics && meta.keyTopics.length > 0) {
        index += `   Topics: ${meta.keyTopics.join(', ')}\n`
      }
      if (meta.mentionedSystems && meta.mentionedSystems.length > 0) {
        index += `   Systems: ${meta.mentionedSystems.join(', ')}\n`
      }
      if (meta.meetingDate) index += `   Meeting Date: ${meta.meetingDate}\n`
      if (meta.dateRange) index += `   Date Range: ${meta.dateRange}\n`
      index += '\n'
    })
    
    return index
  } catch (err) {
    console.error('Failed to generate workspace index:', err)
    return 'Error generating workspace index.'
  }
}
