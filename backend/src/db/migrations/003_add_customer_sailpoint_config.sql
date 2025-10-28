-- Add SailPoint ISC configuration table for customer tenants
-- Allows partial configuration (sandbox only, prod only, or both)
CREATE TABLE IF NOT EXISTS customer_sailpoint_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customerId INTEGER NOT NULL,
  sandboxTenantUrl TEXT DEFAULT '',
  sandboxClientId TEXT DEFAULT '',
  sandboxClientSecret TEXT DEFAULT '',
  prodTenantUrl TEXT DEFAULT '',
  prodClientId TEXT DEFAULT '',
  prodClientSecret TEXT DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_sailpoint_config ON customer_sailpoint_config(customerId);
