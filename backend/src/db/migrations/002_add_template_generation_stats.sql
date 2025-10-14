-- Migration: Add generation performance tracking to template_metadata
-- Date: 2025-10-14

-- Add fields to track actual generation performance
ALTER TABLE template_metadata ADD COLUMN actualGenerationTimes TEXT; -- JSON array of actual times in seconds
ALTER TABLE template_metadata ADD COLUMN generationCount INTEGER DEFAULT 0; -- Number of times template has been used
ALTER TABLE template_metadata ADD COLUMN avgGenerationTime REAL; -- Average generation time in seconds
ALTER TABLE template_metadata ADD COLUMN lastGeneratedAt TIMESTAMP; -- Last time this template was used

-- Add generation timing to gen_cards
ALTER TABLE gen_cards ADD COLUMN startedAt TIMESTAMP;
ALTER TABLE gen_cards ADD COLUMN completedAt TIMESTAMP;
ALTER TABLE gen_cards ADD COLUMN generationTimeSeconds REAL;
