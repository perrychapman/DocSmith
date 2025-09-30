# File Security Validation - DocSmith

## Overview
DocSmith now implements comprehensive file security validation to prevent malicious files from being opened through the application. This is particularly important since the application allows users to upload files and open them in their default applications.

## Security Features Implemented

### 1. **Extension Blacklist** (Blocked File Types)
The following file types are **completely blocked** and cannot be opened:

#### Windows Executables & Scripts
- `.exe`, `.com`, `.bat`, `.cmd`, `.msi`, `.scr`, `.pif`
- `.vbs`, `.vbe`, `.js`, `.jse`, `.ws`, `.wsf`, `.wsh`
- `.ps1`, `.psm1` (PowerShell scripts)

#### macOS Executables
- `.app`, `.dmg`, `.pkg`, `.command`

#### Linux Executables
- `.sh`, `.bash`, `.run`

#### Script Languages (can be executed)
- `.jar`, `.py`, `.rb`, `.pl`, `.php`

#### Macro-Enabled Office Files
- `.dotm`, `.xlsm`, `.pptm`, `.docm`

#### System Files & Libraries
- `.dll`, `.sys`, `.drv`, `.ocx`, `.cpl`
- `.lnk`, `.url`, `.inf`, `.reg`
- `.hta`, `.msc`, `.gadget`, `.application`

### 2. **Extension Whitelist** (Allowed File Types)
Only these file types are allowed to be opened (whitelist mode is enabled by default):

#### Documents
- `.pdf`, `.doc`, `.docx`, `.txt`, `.rtf`, `.odt`
- `.xls`, `.xlsx`, `.csv`, `.ods`
- `.ppt`, `.pptx`, `.odp`

#### Images
- `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.svg`, `.webp`, `.ico`
- `.tiff`, `.tif`

#### Media Files
- `.mp3`, `.mp4`, `.wav`, `.avi`, `.mov`, `.mkv`, `.webm`
- `.flac`, `.ogg`, `.m4a`

#### Web/Data Formats
- `.html`, `.htm`, `.xml`, `.json`, `.yaml`, `.yml`
- `.md`, `.markdown`

#### Archives
- `.zip`, `.rar`, `.7z`, `.tar`, `.gz`

#### Configuration Files
- `.log`, `.ini`, `.cfg`, `.conf`

### 3. **Double Extension Detection**
Prevents disguised executables like `document.pdf.exe` or `report.docx.bat`. The validator checks all extensions in a filename, not just the last one.

Example attacks blocked:
- `invoice.pdf.exe` ❌
- `resume.docx.bat` ❌
- `photo.jpg.vbs` ❌

### 4. **Path Traversal Protection**
Already implemented in the existing codebase:
- Uses `path.basename()` to strip directory components
- Validates resolved paths are within customer directories
- Prevents `../` attacks

## How It Works

### Backend Validation
1. When a user tries to open a file, the request goes to `/api/uploads/:customerId/open-file` or `/api/documents/:customerId/open-file`
2. The `secureFileValidation()` function checks the filename against both blacklist and whitelist
3. If the file is blocked, returns **403 Forbidden** with a descriptive error message
4. If allowed, returns the file path for Electron to open

### Frontend Handling
1. The frontend calls the open-file endpoint
2. If it receives a 403 response, it displays a toast notification with the security reason
3. The error is logged to the console for debugging
4. No file is opened on the user's system

### Validation Function (Backend)
Located in: `backend/src/services/fileSecurityValidator.ts`

```typescript
// Main validation function
export function secureFileValidation(
  filePath: string, 
  useWhitelist: boolean = true
): FileValidationResult

// Returns:
// { allowed: true, extension: '.pdf' }  // File is safe
// { allowed: false, reason: '...', extension: '.exe' }  // File is blocked
```

## Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| **200** | File is allowed and exists | File path returned for opening |
| **403** | File type blocked for security | Error message with reason |
| **404** | File not found | Generic not found error |
| **400** | Invalid request (path traversal, etc.) | Error message |

## Example Error Responses

### Blocked Executable
```json
{
  "error": "File type not allowed",
  "reason": "File type '.exe' is blocked for security reasons (executable/script file)",
  "extension": ".exe"
}
```

### Not in Whitelist
```json
{
  "error": "File type not allowed",
  "reason": "File type '.unknown' is not in the list of allowed document types",
  "extension": ".unknown"
}
```

### Double Extension
```json
{
  "error": "File type not allowed",
  "reason": "File has suspicious double extension (possible malware disguise)",
  "extension": ".exe"
}
```

## Configuration

### Enabling/Disabling Whitelist Mode
In the API endpoints, you can modify the validation call:

```typescript
// Strict mode (whitelist) - DEFAULT
const validation = secureFileValidation(name, true)

// Permissive mode (blacklist only)
const validation = secureFileValidation(name, false)
```

**Recommendation**: Keep whitelist mode **enabled** for maximum security.

### Adding Allowed Extensions
Edit `backend/src/services/fileSecurityValidator.ts`:

```typescript
const ALLOWED_EXTENSIONS = new Set<string>([
  // Add your extension here
  '.newext',
  // ...
])
```

### Adding Blocked Extensions
Edit `backend/src/services/fileSecurityValidator.ts`:

```typescript
const BLOCKED_EXTENSIONS = new Set<string>([
  // Add dangerous extension here
  '.dangerous',
  // ...
])
```

**Note**: Blacklist always takes precedence over whitelist.

## Testing

A comprehensive test suite is available in `backend/security-tests.http`.

To test:
1. Open `backend/security-tests.http` in VS Code
2. Install the "REST Client" extension if not already installed
3. Click "Send Request" on each test case
4. Verify expected responses (403 for blocked, 200/404 for allowed)

## Security Best Practices

### ✅ Do:
- Only allow document/media file types users need to work with
- Keep whitelist mode enabled
- Monitor security logs for unusual file access patterns
- Regularly review and update the allowed/blocked extension lists
- Educate users about not opening unexpected file types

### ❌ Don't:
- Add executable extensions to the whitelist
- Disable whitelist mode in production
- Trust file extensions alone (content inspection could be added later)
- Allow archive files unless necessary (they can contain executables)

## Future Enhancements

Potential improvements for even stronger security:

1. **MIME Type Validation**: Check file content, not just extension
2. **File Size Limits**: Prevent extremely large files
3. **Virus Scanning Integration**: Scan files with ClamAV or Windows Defender
4. **Content-Type Headers**: Validate HTTP response content types
5. **Rate Limiting**: Prevent rapid-fire file access attempts
6. **Audit Logging**: Log all file access attempts to database
7. **User Permissions**: Role-based access to different file types

## Affected Endpoints

- `POST /api/uploads/:customerId/open-file` ✅ Protected
- `POST /api/documents/:customerId/open-file` ✅ Protected
- `GET /api/uploads/:customerId/file` ⚠️ Not protected (direct download)
- `GET /api/documents/:customerId/file` ⚠️ Not protected (direct download)

**Note**: Direct download endpoints (`/file`) are not protected because downloads don't auto-execute files. However, this could be added if needed.

## Troubleshooting

### File type not opening but should be allowed
1. Check the extension in `ALLOWED_EXTENSIONS` in `fileSecurityValidator.ts`
2. Verify the extension is lowercase (e.g., `.PDF` won't match `.pdf`)
3. Check browser console for the specific error message

### False positive (safe file blocked)
1. Add the extension to `ALLOWED_EXTENSIONS`
2. Rebuild backend: `npm run build:backend` (from root)
3. Restart backend server

### File opens despite being dangerous
1. Verify the extension is in `BLOCKED_EXTENSIONS`
2. Check backend logs to ensure validation is running
3. Confirm you're using the updated backend build

## Related Files

- **Validator**: `backend/src/services/fileSecurityValidator.ts`
- **Uploads API**: `backend/src/api/uploads.ts`
- **Documents API**: `backend/src/api/documents.ts`
- **Frontend Handler**: `frontend/src/pages/Customers.tsx` (`openCustomerFile` function)
- **Tests**: `backend/security-tests.http`

## Compliance Notes

This security implementation helps with:
- **OWASP Top 10**: Mitigates "Unrestricted File Upload" vulnerabilities
- **CWE-434**: Unrestricted Upload of File with Dangerous Type
- **CWE-73**: External Control of File Name or Path
- **Defense in Depth**: Multiple layers (blacklist + whitelist + double extension check)
