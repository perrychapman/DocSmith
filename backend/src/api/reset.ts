import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDB } from '../services/storage';

const router = Router();

async function resetApp(req: Request, res: Response) {
  try {
    console.log('Starting app reset...');
    
    // 1. Clear database tables
    const db = getDB();
    
    // Clear all tables but keep structure
    db.exec(`
      DELETE FROM gen_cards;
      DELETE FROM documents;
      DELETE FROM prompts;
      DELETE FROM customers;
      DELETE FROM document_metadata;
    `);
    
    // Reset auto-increment counters
    db.exec(`
      DELETE FROM sqlite_sequence WHERE name IN ('customers', 'prompts', 'documents', 'gen_cards', 'document_metadata');
    `);
    
    console.log('Database tables cleared');
    
    // 2. Clear data directories
    const dataDir = path.join(process.cwd(), '..', 'data');
    
    // Clear customers directory
    const customersDir = path.join(dataDir, 'customers');
    if (fs.existsSync(customersDir)) {
      await clearDirectory(customersDir);
      console.log('Customers directory cleared');
    }
    
    // Clear templates directory
    const templatesDir = path.join(dataDir, 'templates');
    if (fs.existsSync(templatesDir)) {
      await clearDirectory(templatesDir);
      console.log('Templates directory cleared');
    }
    
    // Clear jobs directory
    const jobsDir = path.join(dataDir, '.jobs');
    if (fs.existsSync(jobsDir)) {
      await clearDirectory(jobsDir);
      console.log('Jobs directory cleared');
    }
    
    // 3. Clear any cached configurations (but keep settings)
    const configDir = path.join(dataDir, '.config');
    if (fs.existsSync(configDir)) {
      // Only clear specific cache files, not all config
      const cacheFiles = ['workspace-cache.json', 'document-cache.json'];
      for (const file of cacheFiles) {
        const filePath = path.join(configDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      console.log('Cache files cleared');
    }
    
    console.log('App reset completed successfully');
    res.json({ 
      success: true, 
      message: 'Application has been reset successfully. All customers, templates, jobs, and documents have been removed.' 
    });
    
  } catch (error) {
    console.error('Error during app reset:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset application', 
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function clearDirectory(dirPath: string): Promise<void> {
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      // Recursively clear subdirectories
      await clearDirectory(itemPath);
      fs.rmdirSync(itemPath);
    } else {
      // Remove files
      fs.unlinkSync(itemPath);
    }
  }
}

async function getResetStatus(req: Request, res: Response) {
  try {
    // Count records in database
    const db = getDB();
    
    const counts = {
      customers: 0,
      prompts: 0,
      documents: 0,
      genCards: 0,
      documentMetadata: 0
    };
    
    // Get counts using callbacks since this is sqlite3, not better-sqlite3
    db.get('SELECT COUNT(*) as count FROM customers', (err, row: any) => {
      if (!err && row) counts.customers = row.count;
    });
    db.get('SELECT COUNT(*) as count FROM prompts', (err, row: any) => {
      if (!err && row) counts.prompts = row.count;
    });
    db.get('SELECT COUNT(*) as count FROM documents', (err, row: any) => {
      if (!err && row) counts.documents = row.count;
    });
    db.get('SELECT COUNT(*) as count FROM gen_cards', (err, row: any) => {
      if (!err && row) counts.genCards = row.count;
    });
    db.get('SELECT COUNT(*) as count FROM document_metadata', (err, row: any) => {
      if (!err && row) counts.documentMetadata = row.count;
    });
    
    // Count files in directories
    const dataDir = path.join(process.cwd(), '..', 'data');
    const fileCounts = {
      customers: countFilesInDirectory(path.join(dataDir, 'customers')),
      templates: countFilesInDirectory(path.join(dataDir, 'templates')),
      jobs: countFilesInDirectory(path.join(dataDir, '.jobs'))
    };
    
    res.json({
      success: true,
      databaseRecords: counts,
      filesCounts: fileCounts,
      isEmpty: Object.values(counts).every(c => c === 0) && 
               Object.values(fileCounts).every(c => c === 0)
    });
    
  } catch (error) {
    console.error('Error getting reset status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get reset status' 
    });
  }
}

// Routes
router.post('/app', resetApp);
router.get('/status', getResetStatus);

export default router;

function countFilesInDirectory(dirPath: string): number {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  
  let count = 0;
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      count += countFilesInDirectory(itemPath);
    } else {
      count++;
    }
  }
  
  return count;
}