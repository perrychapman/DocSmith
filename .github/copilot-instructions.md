# Copilot Instructions for DocSmith

## Project Overview
DocSmith is a full-stack application for document management and workspace collaboration. It consists of a TypeScript/Node.js backend and a React/TypeScript frontend. The backend exposes REST APIs for document, customer, and workspace operations, while the frontend provides a modern UI using Vite and Tailwind CSS.

## Architecture
- **Backend (`backend/`)**: Node.js + TypeScript, organized by API routes (`src/api/`), services (`src/services/`), and utilities (`src/utils/`).
  - API routes handle HTTP requests and delegate logic to services.
  - Services encapsulate business logic and data operations (e.g., document composition, customer library, job generation).
  - Utilities provide config and logging helpers.
  - Database schema is in `src/db/schema.sql` (likely using raw SQL, not ORM).
- **Frontend (`frontend/`)**: React + TypeScript, Vite build system, Tailwind CSS for styling.
  - Main entry: `src/main.tsx`, root component: `src/App.tsx`.
  - UI components in `src/components/` (with reusable UI in `ui/`).
  - Pages in `src/pages/` map to major app views (Customers, Jobs, Templates, etc.).
  - API helpers in `src/lib/api.ts`.

## Developer Workflows
- **Backend**
  - Start server: likely `ts-node src/server.ts` or via a script in `package.json`.
  - API endpoints are defined in `src/api/`.
  - No ORM detected; SQL is managed in `src/db/schema.sql`.
- **Frontend**
  - Start dev server: `npm run dev` in `frontend/`.
  - Build: `npm run build` in `frontend/`.
  - Tailwind and PostCSS config in root of `frontend/`.

## Conventions & Patterns
- **TypeScript everywhere**: Both backend and frontend use TypeScript.
- **Service Layer**: Backend logic is separated into services for maintainability.
- **UI Components**: Frontend uses a `ui/` folder for reusable primitives (e.g., Button, Dialog, Table).
- **API Communication**: Frontend uses `src/lib/api.ts` for API calls.
- **No monorepo tooling**: Each app has its own `tsconfig.json` and `package.json`.

## Integration Points
- **External APIs**: Backend integrates with "anythingllm" (see `services/anythingllm*.ts`).
- **Document Generation**: Services for composing DOCX/Excel files (`docxCompose.ts`, `excelCompose.ts`).
- **Job System**: Job generation logic in `genJobs.ts`.

## Examples
- To add a new API route: create a file in `backend/src/api/`, export a handler, and wire it in `server.ts`.
- To add a new page: create a file in `frontend/src/pages/`, add a route in the main app or navigation.
- To extend document logic: update or add a service in `backend/src/services/`.

## Key Files & Directories
- `backend/src/server.ts`: Backend entry point
- `backend/src/api/`: API route handlers
- `backend/src/services/`: Business logic/services
- `backend/src/db/schema.sql`: Database schema
- `frontend/src/App.tsx`: Main React component
- `frontend/src/pages/`: App views
- `frontend/src/components/ui/`: Reusable UI components
- `frontend/src/lib/api.ts`: API communication

---
_If any section is unclear or missing, please provide feedback to improve these instructions._
