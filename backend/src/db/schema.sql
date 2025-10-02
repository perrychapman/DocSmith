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
