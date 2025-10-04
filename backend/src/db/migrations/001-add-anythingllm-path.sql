-- Migration: Add anythingllmPath column to document_metadata
-- This stores the full AnythingLLM document path (e.g., "Customer_Oct_2025/file-hash.json")
-- for use in document pinning operations

ALTER TABLE document_metadata ADD COLUMN anythingllmPath TEXT;
