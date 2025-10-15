// backend/src/services/documentIntelligence.ts
import fs from 'fs'
import { anythingllmRequest } from './anythingllm'

/**
 * Performs intelligent analysis of a template document and workspace data
 * to provide AI with comprehensive context for document generation.
 * 
 * This is a dynamic, document-type-agnostic approach that adapts to any template structure.
 */
export async function analyzeDocumentIntelligently(
  templatePath: string,
  templateSlug: string,
  workspaceSlug: string,
  phase: 'compilation' | 'generation'
): Promise<string> {
  try {
    if (!fs.existsSync(templatePath)) {
      return ''
    }
    
    // Check file extension - only use mammoth for .docx files
    const ext = templatePath.toLowerCase().split('.').pop() || ''
    let rawText = ''
    
    if (ext === 'docx') {
      // Use mammoth for DOCX files
      try {
        const mammoth = require('mammoth')
        const buffer = fs.readFileSync(templatePath)
        const result = await mammoth.extractRawText({ buffer })
        rawText = String(result?.value || '').trim()
      } catch (mammothErr) {
        console.error('Mammoth extraction failed for DOCX, trying plain text fallback:', mammothErr)
        // Fall back to plain text read
        rawText = fs.readFileSync(templatePath, 'utf-8').trim()
      }
    } else if (['md', 'txt', 'html', 'htm', 'csv', 'json', 'xml'].includes(ext)) {
      // Read text-based files directly
      rawText = fs.readFileSync(templatePath, 'utf-8').trim()
    } else if (ext === 'pdf') {
      // Skip PDF analysis for now (would need pdf-parse or similar)
      return ''
    } else {
      // Unsupported file type for analysis
      return ''
    }
    
    if (!rawText) {
      return ''
    }
    
    // Step 1: Ask AI to analyze the template structure itself
    const templateAnalysisPrompt = `Analyze this document template and provide a comprehensive structural analysis.

TEMPLATE CONTENT (first 8000 chars):
${rawText.substring(0, 8000)}${rawText.length > 8000 ? '\n...(content truncated for analysis)' : ''}

Provide a structured JSON response with:
{
  "documentType": "string (e.g., 'contract', 'report', 'proposal', 'invoice', 'design-doc', 'meeting-minutes', 'agreement')",
  "purpose": "string (primary purpose of this document)",
  "tone": "string ('legal-formal', 'business-formal', 'technical', 'casual', 'academic')",
  "keyStructures": {
    "hasTables": boolean,
    "hasBulletLists": boolean,
    "hasNumberedLists": boolean,
    "hasSignatureBlocks": boolean,
    "hasFinancialData": boolean,
    "hasTimeline": boolean,
    "hasContactInfo": boolean,
    "hasHeaderFooter": boolean
  },
  "sections": [
    {
      "heading": "string",
      "purpose": "string (what this section is for)",
      "dataNeeded": "string (what kind of data should fill this section)",
      "isRepeatable": boolean (can this section have multiple instances based on data volume)
    }
  ],
  "placeholders": [
    {
      "pattern": "string (e.g., '[DATE]', '{COMPANY}', '___')",
      "context": "string (where it appears)",
      "suggestedDataType": "string (date, company name, currency, person name, etc.)"
    }
  ],
  "dataPatterns": [
    "string (e.g., 'currency amounts', 'dates in MM/DD/YYYY format', 'email addresses', 'phone numbers')"
  ],
  "crossReferences": [
    "string (sections or data points that should reference each other for consistency)"
  ]
}

Be thorough and precise in your analysis.`

    const analysisResult = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      'POST',
      { message: templateAnalysisPrompt, mode: 'query' }
    )
    
    const analysisText = String(analysisResult?.textResponse || analysisResult?.message || '')
    let analysis: any = null
    
    // Try to extract JSON from response
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/m)
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0])
      }
    } catch {
      // JSON parsing failed, will use fallback
    }
    
    if (!analysis || !analysis.documentType) {
      // Fallback to basic analysis
      return buildBasicAnalysis(rawText, templateSlug)
    }
    
    // Step 2: For generation phase, also map workspace data to template sections
    let mapping: any = null
    if (phase === 'generation') {
      const dataMappingPrompt = `Based on the template analysis below and ALL documents in this workspace, provide intelligent data mapping.

TEMPLATE ANALYSIS:
${JSON.stringify(analysis, null, 2)}

TASK:
For EACH section in the template, identify:
1. Which workspace documents contain relevant data
2. What specific data points should be extracted
3. How the data should be structured/formatted
4. Whether multiple instances are needed (e.g., multiple rows in a table, multiple list items)

Provide a structured JSON response:
{
  "workspaceDocuments": [
    {
      "name": "string",
      "type": "string",
      "relevantSections": ["string (template section names)"],
      "dataPoints": ["string (specific data to extract)"]
    }
  ],
  "sectionMappings": [
    {
      "templateSection": "string",
      "dataSource": "string (which workspace doc(s) contain this data)",
      "extractionStrategy": "string (how to query/extract the data)",
      "expectedStructure": "string (table rows, bullet points, paragraph, etc.)",
      "multiInstance": boolean (does this need multiple instances based on data volume)
    }
  ],
  "dataConsistency": [
    {
      "field": "string (e.g., 'company name', 'project dates', 'contact person')",
      "mustMatchAcross": ["string (sections where this field must be consistent)"]
    }
  ]
}

Be comprehensive - analyze ALL documents in the workspace.`

      const mappingResult = await anythingllmRequest<any>(
        `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
        'POST',
        { message: dataMappingPrompt, mode: 'query' }
      )
      
      const mappingText = String(mappingResult?.textResponse || mappingResult?.message || '')
      
      try {
        const jsonMatch = mappingText.match(/\{[\s\S]*\}/m)
        if (jsonMatch) {
          mapping = JSON.parse(jsonMatch[0])
        }
      } catch {
        // Mapping optional, continue without it
      }
    }
    
    // Step 3: Build comprehensive guidance string
    return buildComprehensiveGuidance(analysis, mapping, phase, templateSlug)
    
  } catch (error) {
    console.error('Document intelligence analysis failed:', error)
    return '\n\nDOCUMENT ANALYSIS: (Analysis unavailable, proceeding with basic enhancement)\n'
  }
}

/**
 * Builds basic analysis when AI analysis fails or is unavailable
 */
function buildBasicAnalysis(rawText: string, templateSlug: string): string {
  const lines = rawText.split('\n').filter(l => l.trim())
  const wordCount = rawText.split(/\s+/).length
  const hasTable = rawText.includes('\t') || /\|.*\|/.test(rawText)
  const hasBullets = lines.some(l => /^[•\-*]/.test(l.trim()))
  const hasNumbers = lines.some(l => /^\d+\./.test(l.trim()))
  
  return `\n\nBASIC DOCUMENT ANALYSIS:
Template: ${templateSlug}
Word count: ${wordCount}
Contains tables: ${hasTable ? 'YES' : 'NO'}
Contains bullet lists: ${hasBullets ? 'YES' : 'NO'}
Contains numbered lists: ${hasNumbers ? 'YES' : 'NO'}

Document preview (first 600 chars):
${rawText.substring(0, 600)}...
`
}

/**
 * Builds comprehensive guidance string from analysis and mapping results
 */
function buildComprehensiveGuidance(
  analysis: any,
  mapping: any | null,
  phase: 'compilation' | 'generation',
  templateSlug: string
): string {
  const parts: string[] = []
  
  parts.push('\n\n=== INTELLIGENT DOCUMENT ANALYSIS ===\n')
  
  // Core document properties
  parts.push(`DOCUMENT TYPE: ${analysis.documentType || 'unknown'}`)
  parts.push(`PURPOSE: ${analysis.purpose || 'N/A'}`)
  parts.push(`TONE: ${analysis.tone || 'neutral'}`)
  
  // Key structures
  if (analysis.keyStructures) {
    const structures = []
    if (analysis.keyStructures.hasTables) structures.push('tables')
    if (analysis.keyStructures.hasBulletLists) structures.push('bullet lists')
    if (analysis.keyStructures.hasNumberedLists) structures.push('numbered lists')
    if (analysis.keyStructures.hasSignatureBlocks) structures.push('signature blocks')
    if (analysis.keyStructures.hasFinancialData) structures.push('financial data')
    if (analysis.keyStructures.hasTimeline) structures.push('timeline/dates')
    if (analysis.keyStructures.hasContactInfo) structures.push('contact information')
    if (analysis.keyStructures.hasHeaderFooter) structures.push('headers/footers')
    
    if (structures.length > 0) {
      parts.push(`\nKEY STRUCTURES: ${structures.join(', ')}`)
    }
  }
  
  // Section breakdown
  if (analysis.sections && Array.isArray(analysis.sections) && analysis.sections.length > 0) {
    parts.push(`\nSECTION STRUCTURE (${analysis.sections.length} sections):`)
    analysis.sections.forEach((sec: any, idx: number) => {
      parts.push(`  ${idx + 1}. ${sec.heading || 'Untitled Section'}`)
      if (sec.purpose) parts.push(`     Purpose: ${sec.purpose}`)
      if (sec.dataNeeded) parts.push(`     Data needed: ${sec.dataNeeded}`)
      if (sec.isRepeatable) {
        parts.push(`     REPEATABLE: This section can have multiple instances based on data volume`)
      }
    })
  }
  
  // Placeholders detected
  if (analysis.placeholders && Array.isArray(analysis.placeholders) && analysis.placeholders.length > 0) {
    parts.push(`\nPLACEHOLDERS DETECTED (${analysis.placeholders.length}):`)
    const displayCount = Math.min(analysis.placeholders.length, 10)
    for (let i = 0; i < displayCount; i++) {
      const p = analysis.placeholders[i]
      parts.push(`  ${p.pattern} -> ${p.suggestedDataType}`)
      if (p.context) parts.push(`     Context: ${p.context}`)
    }
    if (analysis.placeholders.length > 10) {
      parts.push(`  ... and ${analysis.placeholders.length - 10} more placeholders`)
    }
  }
  
  // Data patterns
  if (analysis.dataPatterns && Array.isArray(analysis.dataPatterns) && analysis.dataPatterns.length > 0) {
    parts.push(`\nDATA PATTERNS: ${analysis.dataPatterns.join(', ')}`)
  }
  
  // Cross-references
  if (analysis.crossReferences && Array.isArray(analysis.crossReferences) && analysis.crossReferences.length > 0) {
    parts.push(`\nCROSS-REFERENCES:`)
    analysis.crossReferences.forEach((ref: string) => {
      parts.push(`  - ${ref}`)
    })
  }
  
  // Workspace data mapping (generation phase only)
  if (mapping && phase === 'generation') {
    if (mapping.workspaceDocuments && Array.isArray(mapping.workspaceDocuments) && mapping.workspaceDocuments.length > 0) {
      parts.push(`\n\nWORKSPACE DATA MAPPING:`)
      parts.push(`Available documents: ${mapping.workspaceDocuments.length}`)
      mapping.workspaceDocuments.forEach((doc: any) => {
        parts.push(`  - ${doc.name} (${doc.type})`)
        if (doc.relevantSections && doc.relevantSections.length > 0) {
          parts.push(`    Fills sections: ${doc.relevantSections.join(', ')}`)
        }
        if (doc.dataPoints && doc.dataPoints.length > 0) {
          parts.push(`    Data points: ${doc.dataPoints.join(', ')}`)
        }
      })
    }
    
    if (mapping.sectionMappings && Array.isArray(mapping.sectionMappings) && mapping.sectionMappings.length > 0) {
      parts.push(`\n\nSECTION-BY-SECTION DATA STRATEGY:`)
      mapping.sectionMappings.forEach((sm: any) => {
        parts.push(`  SECTION: ${sm.templateSection}`)
        parts.push(`    Data source: ${sm.dataSource}`)
        parts.push(`    Extraction strategy: ${sm.extractionStrategy}`)
        parts.push(`    Expected structure: ${sm.expectedStructure}`)
        if (sm.multiInstance) {
          parts.push(`    DYNAMIC: Generate multiple instances based on actual data volume`)
        }
      })
    }
    
    if (mapping.dataConsistency && Array.isArray(mapping.dataConsistency) && mapping.dataConsistency.length > 0) {
      parts.push(`\n\nDATA CONSISTENCY REQUIREMENTS:`)
      mapping.dataConsistency.forEach((dc: any) => {
        parts.push(`  - "${dc.field}" must match across: ${dc.mustMatchAcross.join(', ')}`)
      })
    }
  }
  
  // Phase-specific instructions
  parts.push(`\n\n${phase === 'compilation' ? 'COMPILATION' : 'GENERATION'} INSTRUCTIONS:`)
  
  if (phase === 'compilation') {
    parts.push(`1. Create a generator skeleton that respects the document type: ${analysis.documentType}`)
    parts.push(`2. Preserve the detected tone: ${analysis.tone}`)
    parts.push(`3. Maintain all structural elements (tables, lists, sections) in their original order`)
    parts.push(`4. Use placeholder patterns that match the detected data types`)
    parts.push(`5. For sections marked REPEATABLE, structure code to allow dynamic instance generation`)
    parts.push(`6. Respect cross-references and data consistency requirements`)
    parts.push(`7. Create organized, well-commented code blocks for each major section`)
  } else {
    parts.push(`1. Preserve ALL existing WML structure and styling from the current generator code`)
    parts.push(`2. Use the workspace data mapping above to fetch relevant data for each section`)
    parts.push(`3. For sections marked REPEATABLE or DYNAMIC, generate multiple instances as needed`)
    parts.push(`4. Ensure data consistency for fields that appear in multiple sections`)
    parts.push(`5. Match the detected tone: ${analysis.tone}`)
    parts.push(`6. Respect detected data patterns and formats (dates, currency, phone numbers, etc.)`)
    parts.push(`7. DO NOT add sections or content not present in the template structure`)
    parts.push(`8. If workspace data is insufficient for a section, leave placeholders rather than inventing content`)
  }
  
  parts.push('')
  
  return parts.join('\n')
}
