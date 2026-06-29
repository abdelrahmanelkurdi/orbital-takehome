# Multi-Document Support — Task Tracker

> Working checklist for implementing multi-document conversations.
> **Read the full design first:** [`multi-document-support.md`](./multi-document-support.md). This file is the execution plan; the design doc is the source of truth for *why*.
>
> **Status:** Phases 0–9 complete. See [`../grounded-citations/`](../grounded-citations/) for the next proposed initiative.

This tracker is written so an agent or engineer **without prior context** can pick it up. It restates the key decisions and assumptions, then lists concrete, checkable tasks per phase. Every phase ships with tests.

---

## Context for a fresh reader (start here)

**What we're building:** today a conversation holds exactly **one** PDF. We're extending it so a conversation can hold **many** documents — upload more anytime, see them all, ask questions that span/cite across them, and switch which one is shown in the reader panel.

**The single most important fact:** the database already models documents as one-to-many (`Conversation.documents: list[Document]` in `backend/src/takehome/db/models.py`). The "one document" rule is **artificial**, enforced in the service/API/LLM/UI layers — not the schema. So most work is *removing limits and generalizing singular → list*, plus the genuinely new pieces (multi-doc LLM context, the document rail, the context-usage meter).

**Locked decisions (do not re-litigate without stakeholder sign-off):**

1. **No upper bound** on number/size of documents.
2. **Over-budget = block sending.** Legal contracts; no lossy degradation (no dropping/prioritizing/auto-summarizing in v1). When the prompt won't fit, block the send and ask the user to remove a document. A3 summaries are a *future* path pending evaluation studies.
3. **Citations span all relevant documents** → per-document attribution is in scope now.
4. **Prompt includes a document add/remove timeline** so the model can handle a cited-then-removed document gracefully (suggest re-adding).
5. **Documents are scoped to one conversation** → no cross-conversation sharing; conversation delete cascades.
6. **`RESERVED_OUTPUT_TOKENS = 8,000`** (confirmed; safely generous).
7. **No total-size cap** beyond the existing per-file 25 MB limit.
8. **Order by `uploaded_at`** — no `order_index` column.
9. **Tests required throughout.**
10. **Documents are cited by a stable per-conversation ordinal** ("Document 1", "Document 2", …), not by filename (which can be wrong/duplicated) or raw UUID (meaningless to readers). The label carries ordinal + `id` (UUID, canonical) + `filename` (descriptive).

**Key constants / assumptions (verify if the model changes):**

- Model: `claude-haiku-4-5-20251001`, **200K-token** context window. No API returns the window size → keep a config map `MODEL_CONTEXT_WINDOWS` + `DEFAULT_CONTEXT_WINDOW` in `backend/src/takehome/services/llm.py`.
- `RESERVED_OUTPUT_TOKENS = 8,000` (held back for the response). Confirmed.
- Token counting uses Anthropic's `messages.count_tokens` (no generation cost). Per-document counts are cached in a new `documents.token_count` column. Per-segment counts are treated as approximately additive for the meter.
- **Over-budget behavior:** `system + history + all active documents + overhead > context_window − reserved_output` ⇒ **block the send** (disable client-side; reject server-side with **HTTP 413**). Never truncate/partial-include a contract. User removes a document (soft delete frees its tokens) to proceed.
- **Soft delete:** removing a document sets `deleted_at`, deletes the file from disk, and clears `extracted_text`; the row is retained for the timeline. Active docs = `deleted_at IS NULL`.
- **Document ordinal (citation handle):** rank by `uploaded_at` over **all** docs in the conversation incl. soft-deleted (tie-break by `id`). Soft-deleted rows persist, so ordinals never shift or get reused. No extra column needed.
- Existing per-file upload cap: 25 MB (`settings.max_upload_size`). No per-conversation total cap.

**Where things live:**

- Backend: `backend/src/takehome/` → `db/models.py`, `services/{document,conversation,llm}.py`, `web/routers/{documents,conversations,messages}.py`, `web/app.py`, migrations in `alembic/versions/`.
- Frontend: `frontend/src/` → `App.tsx`, `types.ts`, `lib/api.ts`, `hooks/use-*.ts`, `components/*`.
- Tooling: `pyproject.toml` (pytest configured, `testpaths = ["backend/tests"]`, none exist yet), `justfile` (no `test` recipe yet), `frontend/package.json` (no test runner yet).

---

## Phase 0 — Test harness & tooling

- [x] Create `backend/tests/` package with `conftest.py`: async DB session fixture (transactional rollback per test) + FastAPI `httpx.AsyncClient`.
- [x] Add an **LLM stub** fixture so tests never call Anthropic (fake `chat_with_documents` + fake token counter); deterministic + offline.
- [x] Add `just test` recipe (`docker compose exec backend uv run pytest`) and include it in `just check`.
- [x] Add frontend test runner: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`; add `"test"` script; wire into `npm run check`.
- [x] Smoke test: one trivial backend test + one trivial frontend test both run green.

## Phase 1 — Migration `002_multi_document`

- [x] Add `documents.token_count` column (int, default 0/nullable then backfilled).
- [x] Add `documents.deleted_at` column (nullable timestamp) for soft delete.
- [x] Add index on `documents.conversation_id`.
- [x] ~~`order_index`~~ — not needed (order by `uploaded_at`, §0.8).
- [x] Backfill `token_count` for existing documents.
- [x] Provide `downgrade()`.
- [x] Tests: migration upgrade/downgrade runs; columns + index exist.

## Phase 2 — Backend generalization (remove single-doc limit)

- [x] `services/document.py`: remove the "already has a document" guard in `upload_document()`.
- [x] Add `list_documents_for_conversation(session, conversation_id) -> list[Document]` (active only, `deleted_at IS NULL`).
- [x] Add `delete_document(session, document_id) -> bool` — **soft delete**: set `deleted_at`, delete the file from disk, clear `extracted_text`; keep the row.
- [x] Add `list_document_events(session, conversation_id)` — all docs incl. soft-deleted, with `uploaded_at`/`deleted_at` (for the timeline).
- [x] `web/routers/documents.py`: allow repeated `POST`; **drop the 409**; add `GET /api/conversations/{id}/documents`; add `DELETE /api/documents/{id}` (soft delete).
- [x] `web/routers/conversations.py`: serialize `documents: DocumentInfo[]` + `document_count`; keep `has_document` only as a derived shim if needed for transition.
- [x] Tests: second upload succeeds; list returns only active docs; soft delete sets `deleted_at` + removes file + clears text; conversation payload shape; conversation delete cascades.

## Phase 3 — Multi-document context assembly (Strategy A1)

- [x] Implement `build_document_context(documents) -> str` seam (so A3/A2 can swap in later).
- [x] Each active document wrapped + labeled with **ordinal + id + filename** (`<document n="1" id="..." filename="...">`), ordered by `uploaded_at`.
- [x] System prompt instructs citing by ordinal: "Document 1 (filename)"; ordinal disambiguates duplicate filenames.
- [x] Include the **document timeline** preamble (added/removed events by ordinal, from `uploaded_at`/`deleted_at`) + a system-prompt instruction on how to use it. Always full, no summaries.
- [x] Rename/extend `chat_with_document` → `chat_with_documents(documents, ...)`; update `messages.py` to load **all active** docs.
- [x] **Over-budget = block send:** if `system + history + active docs + overhead > context_window − reserved_output`, reject the send with **HTTP 413** and a clear message; never truncate/partial-include.
- [x] Tests: context includes all active docs + ordinal labels; **ordinals stable across delete/add** (don't shift/reuse); duplicate filenames disambiguated by ordinal; timeline lists added + removed by ordinal; **over-budget → 413, within-budget → success**; empty/None `extracted_text` handled.

## Phase 4 — Per-document citations

- [x] System prompt instructs the model to cite the **document ordinal** (+ filename) alongside section/clause/page.
- [x] Replace document-agnostic regex counter with **per-document** attribution, keyed on ordinal → `id`.
- [x] Persist which documents informed each answer (for the rail's "cited" badge).
- [x] Tests: attribution maps ordinals in output → correct document `id`; counts per document; duplicate filenames still resolve correctly.

## Phase 5 — Context-usage meter

- [x] Count + store `token_count` on upload (Anthropic `count_tokens`).
- [x] `MODEL_CONTEXT_WINDOWS` map + `DEFAULT_CONTEXT_WINDOW` + `RESERVED_OUTPUT_TOKENS` in `llm.py`.
- [x] `GET /api/conversations/{id}/context-usage` → categories (system, history, documents[per-item], overhead), `used_tokens`, `used_fraction`, `context_window`, `reserved_output`.
- [x] Tests: per-document + category sums; reserved/window included; fraction math.

## Phase 6 — Frontend data layer

- [x] `types.ts`: `ConversationDetail.documents: Document[]`; derive availability from `documents.length`; add context-usage types.
- [x] `lib/api.ts`: `listDocuments`, `deleteDocument`, `fetchContextUsage`; allow multi-upload.
- [x] Replace `useDocument` with `useDocuments(conversationId)`: list, `activeDocumentId`, `setActiveDocument`, `upload`, `remove`, `refresh`.
- [x] Tests: upload appends (doesn't replace); remove; active-doc selection logic.

## Phase 7 — Document rail (B3) + upload (C1 + C3)

- [x] Document list/rail: filename, page count, upload time, active highlight, "cited" badge, per-doc token/`%` (optional), remove action.
- [x] "+ Add document" button (C1) + drag-and-drop anywhere + multi-file picker (C3); keep empty-state uploader for new chats.
- [x] Per-file progress + per-file errors (one bad PDF doesn't fail the batch).
- [x] Failed-extraction state surfaced in the rail.
- [x] Tests: rail renders all docs + states; multi-file/drag-drop; per-file error isolation.

## Phase 8 — Viewer switching

- [x] `DocumentViewer` renders the **active** document, driven by `activeDocumentId` (logic largely unchanged otherwise).
- [x] Switching docs resets page state correctly.
- [x] Tests: switching changes the rendered document.

## Phase 9 — Context meter UI + polish

- [x] Progress ring + `%` in the rail header; click → breakdown popover (categories + per-document).
- [x] Threshold styling: amber near budget; **red at/over 100% → disable composer send + "Context full — remove a document to continue."**
- [x] Collapse toggle for the rail; empty/failed states polished.
- [x] Tests: meter renders category/per-doc values; threshold styling; send disabled at 100%; popover open/close.

## Phase 10 — Later / optional

- [ ] Graduate context strategy to **A3** (summaries + on-demand fetch) **after evaluation studies** validate fidelity on legal text.
- [ ] **A2** (RAG / pgvector) for very large corpora.
- [ ] Chat-input attach (paperclip, C2).

---

## Open questions (carry forward — see design §8)

None outstanding — design decisions are settled (§0). Add new ones here as implementation surfaces them.

Explicitly **closed**: retention of soft-deleted rows (keep indefinitely, metadata only); "remove largest document" affordance (rejected — too subjective); timeline summarization (rejected — always full, it's tiny).

## Assumptions made during planning (flag if wrong)

- Disposable/transactional test DB is acceptable for backend tests (vs. spinning a dedicated Postgres per run).
- It's acceptable to keep `has_document` temporarily as a derived field for a non-breaking API transition, then remove it.
- Per-segment token counts being ~additive is good enough for the meter (exact total only if we later count the assembled prompt in one call).
- Soft-deleted document rows are kept indefinitely (metadata only — file + text purged).
- Document ordinal is derived (rank by `uploaded_at` over all docs incl. soft-deleted, tie-break by `id`), not a stored column.
