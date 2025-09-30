// backend/src/services/fileSecurityValidator.ts
// Security validator for file opening operations to prevent execution of malicious files

/**
 * Blocked extensions - files that should NEVER be opened through the application
 * These are executable/script files that could pose security risks
 */
const BLOCKED_EXTENSIONS = new Set<string>([
  // Windows executables
  '.exe', '.com', '.bat', '.cmd', '.msi', '.scr', '.pif', '.vbs', '.vbe',
  '.js', '.jse', '.ws', '.wsf', '.wsh', '.ps1', '.psm1',
  
  // macOS executables
  '.app', '.dmg', '.pkg', '.command',
  
  // Linux executables
  '.sh', '.bash', '.run',
  
  // Scripts and code that could be executed
  '.jar', '.py', '.rb', '.pl', '.php',
  
  // Potentially dangerous Office files with macros
  '.dotm', '.xlsm', '.pptm', '.docm',
  
  // Other potentially dangerous formats
  '.dll', '.sys', '.drv', '.ocx', '.cpl',
  '.lnk', '.url', '.inf', '.reg',
  '.hta', '.msc', '.gadget', '.application',
  
  // Archives that could contain malware (optional - can be removed if needed)
  // '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
])

/**
 * Allowed extensions - safe document/media formats for viewing
 * This is a whitelist approach for added security
 */
const ALLOWED_EXTENSIONS = new Set<string>([
  // Documents
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
  '.xls', '.xlsx', '.csv', '.ods',
  '.ppt', '.pptx', '.odp',
  
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
  '.tiff', '.tif',
  
  // Media
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm',
  '.flac', '.ogg', '.m4a',
  
  // Web/Data formats
  '.html', '.htm', '.xml', '.json', '.yaml', '.yml',
  '.md', '.markdown',
  
  // Archives (if you want to allow them)
  '.zip', '.rar', '.7z', '.tar', '.gz',
  
  // Other common safe formats
  '.log', '.ini', '.cfg', '.conf',
])

export interface FileValidationResult {
  allowed: boolean
  reason?: string
  extension?: string
}

/**
 * Validates if a file is safe to open based on its extension
 * Uses both blacklist (blocked) and whitelist (allowed) approaches
 * 
 * @param filePath - Full path or filename to validate
 * @param useWhitelist - If true, only explicitly allowed extensions pass (stricter). Default: true
 * @returns Validation result with allowed status and reason
 */
export function validateFileForOpening(filePath: string, useWhitelist: boolean = true): FileValidationResult {
  if (!filePath) {
    return { allowed: false, reason: 'No file path provided' }
  }

  // Extract extension
  const ext = path.extname(filePath).toLowerCase()
  
  if (!ext) {
    return { allowed: false, reason: 'File has no extension', extension: '' }
  }

  // Check blacklist first (highest priority)
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { 
      allowed: false, 
      reason: `File type '${ext}' is blocked for security reasons (executable/script file)`,
      extension: ext 
    }
  }

  // If using whitelist, check if explicitly allowed
  if (useWhitelist) {
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { 
        allowed: false, 
        reason: `File type '${ext}' is not in the list of allowed document types`,
        extension: ext 
      }
    }
  }

  // Passed all checks
  return { allowed: true, extension: ext }
}

/**
 * Additional validation: Check for double extensions (e.g., document.pdf.exe)
 * This catches attempts to disguise executables as documents
 */
export function hasDoubleExtension(filename: string): boolean {
  const parts = filename.split('.')
  if (parts.length < 3) return false // Need at least "name.ext1.ext2"
  
  // Check if any extension before the last one is suspicious
  for (let i = 1; i < parts.length - 1; i++) {
    const ext = '.' + parts[i].toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return true
    }
  }
  
  return false
}

/**
 * Comprehensive file security check
 * Combines extension validation and double-extension check
 */
export function secureFileValidation(filePath: string, useWhitelist: boolean = true): FileValidationResult {
  const filename = path.basename(filePath)
  
  // Check for double extension tricks
  if (hasDoubleExtension(filename)) {
    return {
      allowed: false,
      reason: 'File has suspicious double extension (possible malware disguise)',
      extension: path.extname(filename).toLowerCase()
    }
  }
  
  // Standard extension validation
  return validateFileForOpening(filePath, useWhitelist)
}

// Re-export for convenience
import path from 'path'
