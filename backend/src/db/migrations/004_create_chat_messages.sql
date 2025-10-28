-- Chat messages table for better control over chat display
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceSlug TEXT NOT NULL,
  customerId INTEGER,
  
  -- Message content
  role TEXT NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  
  -- Grouping and ordering
  conversationId TEXT, -- Group related messages together (e.g., user question + assistant answer)
  messageIndex INTEGER DEFAULT 0, -- Order within a conversation
  
  -- SailPoint integration metadata
  sailpointContext TEXT, -- JSON: { queriesExecuted, queryActions, environment, etc. }
  
  -- Visibility control
  sessionId TEXT DEFAULT 'user-interactive', -- Filter messages by session
  isVisible INTEGER DEFAULT 1, -- 0 = hidden, 1 = visible
  
  -- Timestamps
  sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customerId) REFERENCES customers(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chat_workspace ON chat_messages(workspaceSlug);
CREATE INDEX IF NOT EXISTS idx_chat_customer ON chat_messages(customerId);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(sessionId);
CREATE INDEX IF NOT EXISTS idx_chat_visible ON chat_messages(isVisible);
CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversationId);
CREATE INDEX IF NOT EXISTS idx_chat_sent_at ON chat_messages(sentAt);
