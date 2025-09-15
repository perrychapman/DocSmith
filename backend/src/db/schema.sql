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
