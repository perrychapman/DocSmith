# File Security - User Guide

## What Changed?

DocSmith now protects you from accidentally opening dangerous files through the application.

## What You'll See

### ✅ Safe Files (Allowed)
When you click to open a safe document file like:
- `report.pdf`
- `data.xlsx` 
- `budget.csv`
- `presentation.pptx`
- `notes.txt`

**Result**: The file opens in your default application immediately
**Toast Message**: "Opened in default app" (green success message)

---

### ❌ Dangerous Files (Blocked)
When you try to open a potentially dangerous file like:
- `program.exe`
- `script.bat`
- `malware.vbs`
- `hack.ps1`
- `document.docm` (macro-enabled)

**Result**: File does NOT open
**Toast Message**: "Security: File type '.exe' is blocked for security reasons (executable/script file)" (red error message)
**Console Log**: Logs the blocked attempt for debugging

---

### ⚠️ Disguised Files (Double Extension)
When you try to open a disguised malicious file like:
- `invoice.pdf.exe`
- `resume.docx.bat`
- `photo.jpg.vbs`

**Result**: File does NOT open
**Toast Message**: "Security: File has suspicious double extension (possible malware disguise)" (red error message)

---

## Why This Matters

### Before Security Update
1. User uploads `malware.exe` by accident
2. User clicks "Open" button
3. **Malware executes** on your computer ❌

### After Security Update  
1. User uploads `malware.exe` by accident
2. User clicks "Open" button
3. **File blocked, error shown** ✅
4. User can still download if really needed, but won't auto-execute

---

## Allowed File Types

### Documents
✅ PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, TXT, RTF

### Images  
✅ JPG, PNG, GIF, BMP, SVG, WebP, TIFF

### Media
✅ MP3, MP4, WAV, AVI, MOV, MKV

### Archives
✅ ZIP, RAR, 7Z, TAR, GZ

### Other
✅ HTML, XML, JSON, YAML, Markdown, Log files

---

## Blocked File Types

### Executables
❌ EXE, COM, BAT, CMD, MSI, SCR, APP, DMG, PKG, SH

### Scripts
❌ VBS, JS, PS1, PY, RB, PL, PHP, JAR

### Macro Files
❌ DOCM, XLSM, PPTM, DOTM (use regular .docx/.xlsx instead)

### System Files
❌ DLL, SYS, LNK, REG, INF

---

## What If I Need to Open a Blocked File?

### Option 1: Change File Format (Recommended)
Convert macro-enabled files to regular formats:
- `.docm` → `.docx`
- `.xlsm` → `.xlsx`
- `.pptm` → `.pptx`

### Option 2: Download Instead of Open
1. Click the download icon instead of the "open" icon
2. The file downloads to your Downloads folder
3. You can open it manually if you trust it

### Option 3: Open File Explorer
1. Click "Open Folder" button in DocSmith
2. Navigate to the file manually
3. Right-click → Open with appropriate app
4. Windows will show security warnings for dangerous files

---

## Security Tips

1. **Be suspicious of double extensions**: `report.pdf.exe` is NOT a PDF
2. **Don't open unexpected files**: Even if they appear to be from a customer
3. **Keep antivirus updated**: DocSmith blocks dangerous types, but scanning helps too
4. **Use regular Office formats**: Avoid .docm, .xlsm (macro-enabled) when possible
5. **Check file sources**: Only upload files from trusted sources

---

## Technical Details (For Developers)

- **Backend Validation**: `backend/src/services/fileSecurityValidator.ts`
- **Endpoints Protected**: `/api/uploads/:id/open-file`, `/api/documents/:id/open-file`
- **Mode**: Whitelist (only explicitly allowed extensions pass)
- **Response**: HTTP 403 Forbidden for blocked files
- **Tests**: `backend/security-tests.http`

---

## Questions?

**Q: Can I customize which file types are allowed?**  
A: Yes, developers can edit `ALLOWED_EXTENSIONS` in `fileSecurityValidator.ts`

**Q: Will this affect file uploads?**  
A: No, you can still upload any file type. Security only applies when *opening* files.

**Q: What about ZIP files containing executables?**  
A: ZIP files are allowed (for legitimate documents), but EXE files inside won't open directly.

**Q: Can I disable this security?**  
A: Not recommended, but developers can set `useWhitelist: false` in the API endpoints.

---

**Your safety is our priority!** 🔒
