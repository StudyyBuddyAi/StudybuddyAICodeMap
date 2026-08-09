# StudyBuddy AI

> AI-powered study platform built for medical students. Live at [studybuddyai.com](https://studyybuddyai.com)

StudyBuddy turns raw notes or a topic name into exam-ready study material — structured sheets, active-recall flashcards, and USMLE-style QBank sessions — with spaced repetition, cloud sync, and a PubMed citation engine.

---

## Features

**Study Sheets**
Generate structured study material from any topic or pasted notes. Output includes Summary, Memory Hooks, Clinical Approach, Key Points, Exam Traps, and Flashcards. Supports USMLE Step 1, Step 2, and general exam modes with adjustable difficulty, focus, and length.

**Flashcards**
USMLE-style active-recall cards tagged by type: `[Diagnosis]`, `[Mechanism]`, `[Next Step]`, `[Complication]`, `[Association]`. Includes SM-2 spaced repetition, a Due Today queue, deck library, and study history.

**QBank**
MCQ engine with multi-system domain selection, session persistence (resume across page reloads), flagging, skip, and a full summary with performance breakdown on completion.

**PubMed Citations**
Specialty-aware citation lookup via NCBI E-utilities. Entitlement-gated per user tier.

**Explain Mode**
Short, focused AI refresher on any concept mid-review without leaving your session.

---

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React 18 · TypeScript · Vite · Tailwind · shadcn/ui (Radix) |
| State | React Query · React Router · React Hook Form · Zod |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| AI | OpenRouter — GPT-OSS 20B (default) · Claude Haiku 4.5 (Pro) |
| Deployment | Vercel |
| Testing | Vitest + Testing Library (unit) · Playwright (e2e) |

### Auth model
Anonymous-first. Every visitor gets a Supabase session immediately via `signInAnonymously()`. Sign-up upgrades the anonymous user in-place, preserving their data.

### AI model routing
All AI calls go through a single Supabase Edge Function (`medical-notes`) via OpenRouter — no direct API clients in the frontend.
- **Default (free/anon):** GPT-OSS 20B via Cerebras/Groq
- **Pro:** Claude Haiku 4.5 (toggle) with a free-tier hook for first-time users

---

## Running locally

```bash
npm install
npm run dev        # Vite dev server on http://localhost:8080
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest unit tests
```

Requires a `.env` file at the project root (never commit this):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Edge function secrets (`OPENROUTER_API_KEY`, `NCBI_API_KEY`) are configured
in the Supabase dashboard under Edge Function secrets — they never touch the frontend.

---

## Project structure

```
src/
├── components/       # UI components (feature + shadcn/ui primitives)
│   ├── dashboard/    # Dashboard layout, sidebar, stats
│   └── ui/           # shadcn/ui base components
├── contexts/         # QBankContext, SidebarContext
├── hooks/            # Data-fetching and business logic hooks
├── integrations/     # Supabase client + generated types
├── lib/              # Pure utilities (citations, spaced repetition, utils)
├── pages/            # Route-level page components
└── types/            # Shared TypeScript types

supabase/
├── functions/        # Edge functions (medical-notes, get-citations)
└── migrations/       # Ordered SQL migrations

scripts/
└── rag-spike/        # Isolated RAG experiment — not part of the deployed app
```

---

## Contributing

Solo project. Not currently open to external contributions.
