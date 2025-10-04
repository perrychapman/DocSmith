-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  workspaceSlug TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prompts (replaces transcripts)
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL,
  title TEXT,
  userInput TEXT,
  customerInput TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customerId) REFERENCES customers(id)
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL,
  type TEXT NOT NULL,
  filePath TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customerId) REFERENCES customers(id)
);

-- Generation chat cards (persist UI cards for sent/received)
CREATE TABLE IF NOT EXISTS gen_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cardId TEXT UNIQUE,
  workspaceSlug TEXT,
  customerId INTEGER,
  side TEXT, -- 'user' | 'assistant'
  template TEXT,
  jobId TEXT,
  jobStatus TEXT, -- 'running'|'done'|'error'|'cancelled'
  filename TEXT,
  aiContext TEXT,
  timestamp INTEGER,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gen_cards_ws ON gen_cards(workspaceSlug);
CREATE INDEX IF NOT EXISTS idx_gen_cards_cust ON gen_cards(customerId);
CREATE INDEX IF NOT EXISTS idx_gen_cards_ts ON gen_cards(timestamp);

-- Document metadata for uploaded files
CREATE TABLE IF NOT EXISTS document_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL,
  filename TEXT NOT NULL,
  anythingllmPath TEXT, -- Full path in AnythingLLM (e.g., "Customer_Oct_2025/file-hash.json")
  uploadedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fileSize INTEGER,
  documentType TEXT,
  purpose TEXT,
  keyTopics TEXT, -- JSON array
  dataCategories TEXT, -- JSON array
  mentionedSystems TEXT, -- JSON array
  stakeholders TEXT, -- JSON array
  estimatedPageCount INTEGER,
  estimatedWordCount INTEGER,
  hasTables INTEGER DEFAULT 0, -- SQLite boolean (0/1)
  hasImages INTEGER DEFAULT 0,
  hasCodeSamples INTEGER DEFAULT 0,
  dateRange TEXT,
  meetingDate TEXT,
  relatedDocuments TEXT, -- JSON array
  supersedes TEXT,
  tags TEXT, -- JSON array
  description TEXT,
  extraFields TEXT, -- JSON object for document-type-specific fields (spreadsheet columns, code functions, etc.)
  lastAnalyzed TIMESTAMP,
  analysisVersion INTEGER DEFAULT 1,
  FOREIGN KEY (customerId) REFERENCES customers(id),
  UNIQUE(customerId, filename)
);

CREATE INDEX IF NOT EXISTS idx_doc_meta_customer ON document_metadata(customerId);
CREATE INDEX IF NOT EXISTS idx_doc_meta_filename ON document_metadata(customerId, filename);

-- Template metadata for template structure and characteristics
CREATE TABLE IF NOT EXISTS template_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  templateSlug TEXT NOT NULL UNIQUE,
  templateName TEXT NOT NULL,
  uploadedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fileSize INTEGER,
  
  -- Template characteristics (HOW/WHY, not data content)
  templateType TEXT, -- 'Report', 'Invoice', 'Letter', 'Spreadsheet', 'Dashboard', 'Form'
  purpose TEXT, -- What this template is designed to generate
  outputFormat TEXT, -- 'docx', 'xlsx', 'pdf'
  
  -- Structure and requirements
  requiredDataTypes TEXT, -- JSON array: ['Financial', 'Inventory', 'Customer', 'Timeline']
  expectedEntities TEXT, -- JSON array: ['Products', 'Orders', 'Customers', 'Employees']
  dataStructureNeeds TEXT, -- JSON array: ['Tabular data', 'Time series', 'Hierarchical', 'Key-value pairs']
  
  -- Template content structure
  hasSections TEXT, -- JSON array: section names/types ['Executive Summary', 'Data Tables', 'Charts']
  hasCharts INTEGER DEFAULT 0,
  hasTables INTEGER DEFAULT 0,
  hasFormulas INTEGER DEFAULT 0,
  tableCount INTEGER,
  chartTypes TEXT, -- JSON array: ['Bar', 'Line', 'Pie']
  
  -- Formatting and styling
  styleTheme TEXT, -- 'Corporate', 'Modern', 'Minimal', 'Formal', 'Technical'
  colorScheme TEXT, -- 'Blue/Gray', 'Green/White', 'Multi-color'
  fontFamily TEXT,
  pageOrientation TEXT, -- 'Portrait', 'Landscape'
  
  -- Content requirements
  requiresAggregation INTEGER DEFAULT 0, -- Needs summaries, totals, averages
  requiresTimeSeries INTEGER DEFAULT 0, -- Needs date-based ordering
  requiresComparisons INTEGER DEFAULT 0, -- Needs before/after, period-over-period
  requiresFiltering INTEGER DEFAULT 0, -- Needs subset of data based on criteria
  
  -- Metadata about the template itself
  complexity TEXT, -- 'Simple', 'Moderate', 'Complex'
  estimatedGenerationTime TEXT, -- 'Fast (<5s)', 'Moderate (5-15s)', 'Slow (>15s)'
  targetAudience TEXT, -- 'Executives', 'Technical Teams', 'Customers', 'Internal Staff'
  useCases TEXT, -- JSON array: scenarios where this template is appropriate
  
  -- Relationships and compatibility
  compatibleDocumentTypes TEXT, -- JSON array: document types that work well with this template
  recommendedWorkspaceSize TEXT, -- 'Small (<10 docs)', 'Medium (10-50)', 'Large (>50)'
  
  -- System metadata
  lastAnalyzed TIMESTAMP,
  analysisVersion INTEGER DEFAULT 1,
  workspaceSlug TEXT -- Associated AnythingLLM workspace
);

CREATE INDEX IF NOT EXISTS idx_template_meta_slug ON template_metadata(templateSlug);
CREATE INDEX IF NOT EXISTS idx_template_meta_type ON template_metadata(templateType);
