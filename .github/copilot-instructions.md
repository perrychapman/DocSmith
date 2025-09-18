# Copilot Instructions for DocSmith

## Project Overview
DocSmith is a document generation and workspace collaboration platform. It integrates with AnythingLLM for AI-powered chat workspaces and generates complex DOCX/Excel documents using templates. The system manages customers, uploads, and asynchronous document generation jobs through a full-stack TypeScript architecture.

## Architecture & Core Components
- **Backend (`backend/`)**: Express + TypeScript with service-oriented architecture
  - **API Layer** (`src/api/`): RESTful endpoints that delegate to services
  - **Service Layer** (`src/services/`): Business logic for documents, customers, AI integration, job management
  - **Database**: SQLite with raw SQL queries (no ORM) - schema in `src/db/schema.sql`
  - **File System**: Customer-based folder structure in `data/customers/` and `data/templates/`

- **Frontend (`frontend/`)**: React SPA with hash-based routing
  - **UI Framework**: shadcn/ui components + Tailwind CSS
  - **Routing**: Hash-based navigation (`#customers`, `#workspaces/{slug}`, etc.)
  - **API Client**: Specialized client in `src/lib/api.ts` with Electron support
  - **Pages**: Entity-focused views (Customers, Workspaces, Jobs, Templates, Settings)

- **Deployment**: Multi-target support (web app, Electron desktop app)

## Key Development Workflows
```bash
# Development (runs backend + frontend concurrently)
npm run dev

# Electron development (includes desktop app)
npm run electron:dev

# Backend only (with file watching)
npm run dev:backend

# Production build
npm run build
```

**Project Structure**: npm workspaces setup with separate `package.json` files for backend/frontend, but coordinated builds through root-level scripts.

## Critical Patterns & Conventions

### Database & Storage
- **SQLite with raw SQL** - no ORM, direct `db.all()` calls in services
- **Customer-centric file organization**: `data/customers/{CustomerName}_{Month}_{Year}/`
- **Template system**: Each template has `generator.full.ts`, `template.docx`, and `template.json`
- **Job persistence**: Asynchronous generation jobs stored in `.jobs/jobs.json`

### Document Generation Pipeline
1. **Template Discovery**: Templates in `data/templates/{TemplateName}/`
2. **AI Context Building**: AnythingLLM workspace integration for context
3. **Dynamic Generation**: TypeScript generators produce Word XML (WML)
4. **Document Assembly**: Either Pandoc (preferred) or html-to-docx fallback
5. **Job Tracking**: Persistent job status with detailed step logging

### AnythingLLM Integration
- **Configuration-driven**: Settings stored in SQLite, resolved in `services/anythingllm.ts`
- **Workspace Management**: Create/delete workspaces, manage documents
- **Thread Support**: Dedicated chat threads within workspaces
- **Streaming Chat**: SSE-based real-time chat interface

### Frontend Patterns
- **Hash-based SPA routing**: Navigation via `window.location.hash` (no router library)
- **Conditional base URL**: API client detects Electron vs. browser environment
- **shadcn/ui component system**: Consistent design system with Radix primitives
- **Setup wizard**: First-run configuration stored in `localStorage`

## Implementation Examples

### Adding a New API Endpoint
```typescript
// 1. Create route handler in backend/src/api/newfeature.ts
import { Router } from "express";
const router = Router();
router.get("/", async (req, res) => {
  // Delegate to service layer
  const result = await someService.doSomething();
  res.json(result);
});
export default router;

// 2. Register in backend/src/server.ts
import newfeatureRouter from "./api/newfeature";
app.use("/api/newfeature", newfeatureRouter);
```

### Adding a Template Generator
```typescript
// Create data/templates/NewTemplate/generator.full.ts
export async function generate(toolkit, builder, context) {
  const content = await toolkit.text("Generate content for...");
  return { wml: `<w:p><w:r><w:t>${content}</w:t></w:r></w:p>` };
}
```

### Database Operations
```typescript
// Raw SQL pattern used throughout services
const db = getDB();
db.all<CustomerRow[]>(
  "SELECT id, name, workspaceSlug FROM customers WHERE id = ?",
  [customerId],
  (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  }
);
```

## Integration Points
- **AnythingLLM API**: External AI service for workspace chat and document context
- **Pandoc**: Preferred tool for high-fidelity DOCX generation (with html-to-docx fallback)
- **Document Templates**: Dynamic TypeScript generators producing Word XML
- **File System Library**: Customer/template organization in `data/` directory
- **Job System**: Persistent async job tracking with detailed step logging

## Key Files & Entry Points
- `backend/src/server.ts`: Express server setup and route registration
- `backend/src/services/`: Core business logic (anythingllm, docxCompose, genJobs, customerLibrary)
- `backend/src/db/schema.sql`: Database structure (customers, prompts, documents, gen_cards)
- `frontend/src/App.tsx`: Main React component with hash routing
- `frontend/src/lib/api.ts`: Typed API client with environment detection
- `data/templates/`: Template definitions with generators and Word docs
- `data/customers/`: Customer-specific uploads, documents, and prompts

## Common Tasks
- **Customer Management**: Create via `/api/customers`, file uploads to `data/customers/{name}/uploads/`
- **Workspace Integration**: AnythingLLM workspace creation, document embedding, chat threads
- **Document Generation**: Template + AI context → TypeScript generator → DOCX output
- **Job Monitoring**: Track async generation progress via gen_cards table and job system

---
_For questions about specific patterns or missing coverage, update this file with discovered knowledge._
