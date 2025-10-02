# Metadata Extraction API Documentation

## Overview

Document metadata extraction now runs **asynchronously in the background** after successful upload and embedding to AnythingLLM. This allows users to close the upload modal immediately after the document is uploaded without waiting for metadata analysis to complete.

## Flow

1. **User uploads document** → `POST /api/uploads/:customerId`
2. **Backend saves file locally** (via multer)
3. **Backend uploads to AnythingLLM** and embeds in workspace
4. **Backend returns success response immediately** (201 status)
5. **User closes modal** and sees success notification
6. **Background process starts** (after 3-second delay for indexing)
7. **AI analyzes document** and extracts metadata
8. **Metadata saved to database**
9. **User receives completion notification** (via SSE or polling)

## API Endpoints

### 1. Upload Document (triggers background metadata extraction)

```http
POST /api/uploads/:customerId
Content-Type: multipart/form-data

file: [binary file data]
```

**Response (immediate):**
```json
{
  "ok": true,
  "file": {
    "name": "document.pdf",
    "path": "/full/path/to/document.pdf"
  }
}
```

**Background Process:**
- Waits 3 seconds for AnythingLLM indexing
- Analyzes the specific document using its AnythingLLM document name
- Extracts comprehensive metadata
- Saves to `document_metadata` table
- Emits notification (success or error)

### 2. Get Recent Metadata Notifications (polling)

```http
GET /api/uploads/metadata-notifications/:customerId
```

**Response:**
```json
{
  "notifications": [
    {
      "customerId": 1,
      "filename": "requirements.pdf",
      "status": "complete",
      "message": "Metadata extracted successfully for requirements.pdf",
      "metadata": {
        "documentType": "Requirements Document",
        "keyTopicsCount": 5,
        "stakeholdersCount": 3
      },
      "timestamp": 1696176000000
    },
    {
      "customerId": 1,
      "filename": "notes.docx",
      "status": "processing",
      "message": "Analyzing document metadata...",
      "timestamp": 1696175950000
    }
  ]
}
```

### 3. Real-Time Notification Stream (SSE)

```http
GET /api/uploads/metadata-stream/:customerId
Accept: text/event-stream
```

**SSE Events:**

```
data: {"type":"connected","customerId":1}

data: {"type":"notification","notification":{"customerId":1,"filename":"doc.pdf","status":"processing","message":"Analyzing document metadata...","timestamp":1696176000000}}

data: {"type":"notification","notification":{"customerId":1,"filename":"doc.pdf","status":"complete","message":"Metadata extracted successfully","metadata":{"documentType":"Meeting Notes","keyTopicsCount":3},"timestamp":1696176010000}}
```

## Notification Status Types

- **`processing`** - Metadata extraction started
- **`complete`** - Metadata extraction completed successfully
- **`error`** - Metadata extraction failed

## Document-Specific Analysis

The metadata extraction now targets the **specific document** uploaded using its AnythingLLM document name (e.g., `custom-documents/myfile.pdf`). This ensures:

- No confusion with similarly-named documents
- Analysis of the exact document just uploaded
- Better accuracy and relevance

## Frontend Integration

### Polling Approach (simple)

```typescript
// After successful upload
async function pollMetadataStatus(customerId: number, filename: string) {
  const maxAttempts = 30 // 30 * 2s = 60s timeout
  let attempts = 0
  
  const poll = setInterval(async () => {
    attempts++
    const res = await fetch(`/api/uploads/metadata-notifications/${customerId}`)
    const data = await res.json()
    
    const notification = data.notifications.find(n => 
      n.filename === filename && 
      (n.status === 'complete' || n.status === 'error')
    )
    
    if (notification) {
      clearInterval(poll)
      if (notification.status === 'complete') {
        showSuccessToast('Metadata extraction complete')
      } else {
        showErrorToast('Metadata extraction failed')
      }
    }
    
    if (attempts >= maxAttempts) {
      clearInterval(poll)
    }
  }, 2000)
}
```

### SSE Approach (real-time)

```typescript
// Connect to SSE stream
const eventSource = new EventSource(`/api/uploads/metadata-stream/${customerId}`)

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  
  if (data.type === 'connected') {
    console.log('Connected to metadata stream')
  }
  
  if (data.type === 'notification') {
    const notification = data.notification
    
    if (notification.status === 'complete') {
      showSuccessToast(`Metadata extracted for ${notification.filename}`)
      refreshDocumentList() // Reload with new metadata
    } else if (notification.status === 'error') {
      showErrorToast(`Metadata extraction failed: ${notification.message}`)
    }
  }
})

// Cleanup on unmount
onUnmount(() => {
  eventSource.close()
})
```

## Console Logs

Monitor metadata extraction progress via console:

```
[METADATA] Starting background extraction for document.pdf in workspace my-workspace
[METADATA] Waiting 3s for document indexing...
[METADATA] Analyzing document "custom-documents/document.pdf"
[METADATA] Analysis complete for document.pdf: { type: 'Requirements Document', topics: 5, stakeholders: 3 }
[METADATA] ✓ Metadata saved to database for document.pdf
```

## Error Handling

If metadata extraction fails:
- Document upload still succeeds (file saved, embedded in workspace)
- Error notification emitted with details
- Console logs show error details
- Frontend can retry or show partial success message

## Database Schema

Metadata is stored in the `document_metadata` table with fields:
- Document type, purpose, key topics
- Data categories, mentioned systems, stakeholders
- Structural info (tables, images, code samples)
- Date/timeline info
- Related documents

See `backend/src/services/documentMetadata.ts` for full schema.
