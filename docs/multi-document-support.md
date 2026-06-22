# Multi-Document Conversations — Design Document

## Goal

Extend the document Q&A tool so a single conversation can hold **multiple documents**. Users should be able to:

- Upload additional documents into an existing conversation
- See which documents are currently loaded
- Ask questions that reference any or all uploaded documents
- View any of the uploaded documents in the reader panel

Hard requirements:

- The assistant can answer questions that **span across** documents.
- Previously uploaded documents **persist** when new ones are added.

This document describes the **current state**, a **proposed solution**, and — for each of the larger/riskier pieces — **three alternative approaches** with trade-offs and a recommendation.

---

## 0. Locked Decisions (from stakeholder review)

These were confirmed during review and constrain the design:

1. **No upper bound** on the number or total size of documents per conversation. The solution cannot assume "just a handful"; it must behave predictably as the corpus grows past the model's context window.
2. **Over-budget = block sending (no lossy degradation).** The documents are **legal contracts**, where dropping later/earlier documents loses pivotal context, prioritizing documents is too complex/error-prone, and auto-summarization needs evaluation studies before we'd trust its fidelity. So for now, when the assembled prompt would exceed the window, we **prevent sending the message** and tell the user to remove a document (or start a new chat) rather than silently truncating. This makes the context-usage meter (§2.4) a hard gate, not just an indicator.
3. **Citations should come from any/all relevant documents.** The purpose of multi-document support is that a single answer can read from and cite multiple documents, so **per-document citation/attribution is in scope** (not deferred).
4. **The prompt includes a document timeline** (added/removed events) so the model has temporal grounding — e.g., if it cited a document that was later removed, it can recognize this and ask the user to re-add it instead of acting confused (§2.5).
5. **Documents are scoped to a single conversation.** No cross-conversation sharing/reuse; each document belongs to exactly one chat (matches the current data model). Deleting a conversation deletes its documents (existing `cascade`).
6. **Reserved output budget = 8,000 tokens** (`RESERVED_OUTPUT_TOKENS`). Comfortably above typical answer length, so it errs safe.
7. **No document-size requirements** — no per-conversation total-size cap beyond the existing per-file 25 MB limit.
8. **Ordering by `uploaded_at`** — upload time is a good deterministic proxy; **no `order_index` column** is needed.
9. **Tests are required throughout** — every backend/frontend change ships with tests (see §6).
10. **Documents are identified in the prompt by a stable per-conversation ordinal** ("Document 1", "Document 2", …), not by filename alone. Filenames can be inaccurate, non-descriptive, or duplicated across documents with different content, which would make citations ambiguous; raw UUIDs are unambiguous but meaningless to a reader. The ordinal is the citation handle (human-readable + unambiguous), with `id` (UUID, canonical) and `filename` (descriptive) carried alongside (§2.6).

---

## 1. Current State of the System

### 1.1 Stack

- **Backend:** FastAPI (Python 3.12), SQLAlchemy (async), PostgreSQL, Alembic migrations, PydanticAI (Anthropic `claude-haiku-4-5`), PyMuPDF for text extraction.
- **Frontend:** React + Vite, TypeScript, Tailwind, shadcn/Radix UI, `react-pdf` for rendering.
- **Transport:** REST for CRUD; Server-Sent Events (SSE) for streaming chat responses.

### 1.2 Layout (three-pane app)

```
┌────────────┬──────────────────────────┬────────────────────┐
│ ChatSidebar│        ChatWindow         │   DocumentViewer   │
│ (chats)    │   (messages + input)      │   (single PDF)     │
└────────────┴──────────────────────────┴────────────────────┘
```

`frontend/src/App.tsx` wires three hooks: `useConversations`, `useMessages`, and `useDocument` (note: **singular** document).

### 1.3 Data model — already one-to-many

In `backend/src/takehome/db/models.py`, a `Conversation` already owns a **list** of documents:

```python
class Conversation(Base):
    documents: Mapped[list[Document]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )

class Document(Base):
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    filename: Mapped[str]
    file_path: Mapped[str]
    extracted_text: Mapped[str | None]
    page_count: Mapped[int]
```

The migration (`alembic/versions/001_initial_schema.py`) creates `documents` with a plain foreign key to `conversations.id` — **no unique constraint** limiting it to one document. So the relational schema supports many documents per conversation *today*.

### 1.4 Where the "one document" constraint actually lives

The single-document behavior is enforced in application code, not the DB:

| Layer | File | Constraint |
|---|---|---|
| Service | `services/document.py` | `upload_document()` raises `ValueError("Conversation already has a document…")`; `get_document_for_conversation()` uses `scalar_one_or_none()` |
| API (upload) | `web/routers/documents.py` | Returns **409** if a document already exists |
| API (conversation) | `web/routers/conversations.py` | `ConversationDetail.document` is singular; reads `conversation.documents[0]`; exposes `has_document: bool` |
| API (chat) | `web/routers/messages.py` | Loads a single doc via `get_document_for_conversation()`, passes one `document_text` |
| LLM | `services/llm.py` | `chat_with_document(document_text: str | None)` wraps exactly one `<document>` block |
| Frontend types | `frontend/src/types.ts` | `ConversationDetail.document?: Document`; `has_document` |
| Frontend state | `hooks/use-document.ts` | Holds a single `Document | null` |
| Frontend UI | `components/DocumentViewer.tsx`, `App.tsx`, `ChatWindow.tsx` | Viewer takes one `document`; chat uses `hasDocument` boolean |

### 1.5 Current request flows

- **Upload:** `POST /api/conversations/{id}/documents` → validates PDF + size → saves to `uploads/` with a UUID-prefixed name → extracts text with PyMuPDF (page-delimited) → stores one `Document` row. Rejects a second upload with 409.
- **Chat:** `POST /api/conversations/{id}/messages` → saves user message → loads the single document's `extracted_text` → builds a prompt (`<document>…</document>` + history + user turn) → streams tokens over SSE → persists assistant message and counts "sources cited" via regex (`section/clause/page/paragraph N`).
- **View:** `GET /api/documents/{id}/content` streams the raw PDF; the viewer renders it page-by-page.

### 1.6 Implications

Because the schema is already one-to-many, **most of the work is removing artificial limits and generalizing single → list** across the API, the LLM context builder, and the UI. The genuinely hard/decision-heavy parts are: (a) how to feed multiple documents to the model, (b) how the document set is presented and switched in the UI, and (c) how the upload flow changes. Those are covered as the "larger pieces" in §3.

---

## 2. Proposed Solution (overview)

### 2.1 Backend

**Data model:** No schema change is *required* to allow multiple documents (the relationship is already 1:N). The migration we add earns its keep by introducing two things the new features need:

- **`token_count` column on `documents`** — the number of input tokens the document's `extracted_text` consumes, computed once at upload. This powers the context-usage meter (§2.4) without re-tokenizing large documents on every request.
- **`deleted_at` column on `documents`** (nullable timestamp) — enables **soft delete**, which the document timeline (§2.5) requires: when a user removes a document we retain its metadata (filename, `uploaded_at`, `deleted_at`) for the timeline, while purging the file from disk and clearing `extracted_text` so it no longer counts toward the context budget. Active documents are those with `deleted_at IS NULL`.
- **Index on `documents.conversation_id`** — a **performance safeguard, not a new capability**. Every chat message runs `SELECT … FROM documents WHERE conversation_id = ?`, and the conversation list eager-loads documents via `selectinload` (`WHERE conversation_id IN (…)`). With one document per conversation this was free; with **no upper bound on document count** (see §0), the `documents` table can grow large. Without the index, each lookup is a sequential scan of the whole table; with it, it's an index seek to just that conversation's rows.
  - *Concrete before/after:* with 50,000 documents across 5,000 conversations, sending a message currently scans all 50,000 rows to find the ~10 in that chat. With the index, it seeks directly to those ~10 rows, and latency stays flat as the system accumulates documents.
- **No `order_index`** — documents are ordered by `uploaded_at` (§0.8), which is a sufficient deterministic proxy.

**Service layer (`services/document.py`):**

- Remove the "already has a document" guard in `upload_document()`.
- Add `list_documents_for_conversation(session, conversation_id) -> list[Document]` (active only: `deleted_at IS NULL`).
- Add `delete_document(session, document_id) -> bool` — **soft delete**: set `deleted_at`, delete the file from disk, and clear `extracted_text` (so it stops counting toward the budget) while keeping the row for the timeline (§2.5).
- Add `list_document_events(session, conversation_id)` — all documents incl. soft-deleted, with `uploaded_at` / `deleted_at`, to build the timeline.
- Keep `get_document(document_id)` for the viewer/content endpoint (active docs only).

**API changes:**

- `POST /api/conversations/{id}/documents` — now allowed repeatedly; returns the created doc; **drop the 409**.
- `GET /api/conversations/{id}/documents` — list documents (id, filename, page_count, uploaded_at).
- `DELETE /api/documents/{id}` — soft-delete a single document (purges the file, retains metadata for the timeline).
- `GET /api/conversations/{id}` — replace `document` / `has_document` with `documents: DocumentInfo[]` and `document_count: int`. (Keep `has_document` temporarily as a derived field if we want a non-breaking transition.)

**LLM / chat (`messages.py` + `llm.py`):** Load **all** documents for the conversation and assemble multi-document context (see §3.1). Rename/extend `chat_with_document` → `chat_with_documents(documents: list[...])`. Each document is labeled with its **ordinal + id + filename** (§2.6) so the model can attribute answers to a specific document without ambiguity.

**Per-document citations are in scope** (per stakeholder decision — the whole point of multiple documents is that an answer can draw on, and cite, more than one): the system prompt instructs the model to cite the **document ordinal** (e.g., "Document 2") alongside the section/clause/page, and the "sources cited" tracking is extended from the current document-agnostic regex to **per-document** attribution keyed on the ordinal → `id`. This also feeds the "cited" badge on each document in the rail (§3.2) and lets us persist which documents informed each answer.

### 2.2 Frontend

- `types.ts`: `ConversationDetail.documents: Document[]`; drop reliance on singular `document` / `has_document` (derive from `documents.length`).
- Replace `useDocument` (single) with `useDocuments(conversationId)` returning the list, an `activeDocumentId`, `setActiveDocument`, `upload`, `remove`, and `refresh`.
- Introduce a **document list / rail** in the conversation so users can see all loaded docs, switch the viewer, and add/remove (see §3.2).
- The `DocumentViewer` renders the **active** document; switching is driven by `activeDocumentId`.
- Upload affordances generalized to add-to-existing and multi-file (see §3.3).

### 2.3 What this buys us against the requirements

- *Persist on add* — each `Document` row is independent; uploading a new one never mutates existing rows. ✔
- *Cross-document answers* — handled by the context-assembly strategy in §3.1. ✔
- *See / switch / view* — handled by the document rail + viewer in §3.2. ✔

### 2.4 Context Usage Meter

Because there is **no upper bound** on documents (§0.1) and we **block sending when over budget** (§0.2), the meter is both an indicator *and* the user's primary tool for getting back under the limit (by seeing which document to remove). We propose a meter inspired by Cursor's "context usage" ring: a small progress indicator that expands into a per-category breakdown.

**Categories (what consumes the window):**

1. **System prompt / instructions** — the fixed agent prompt (constant).
2. **Conversation history** — previous questions and answers in this chat.
3. **Documents** — *one row per uploaded document*, so users can see exactly which file is the heavy one.
4. **Formatting overhead** — the `<document>` wrappers, filename labels, separators, and prompt scaffolding we add around the raw text.
5. **Reserved response budget** — tokens we hold back for the model's answer (so "used" + "reserved" ≤ window).

**Backend.** A new endpoint, e.g. `GET /api/conversations/{id}/context-usage`, returns:

```jsonc
{
  "model": "claude-haiku-4-5-20251001",
  "context_window": 200000,
  "reserved_output": 8000,
  "categories": [
    { "key": "system",    "label": "System prompt",        "tokens": 320 },
    { "key": "history",   "label": "Conversation history", "tokens": 4120 },
    { "key": "documents", "label": "Documents", "tokens": 51230,
      "items": [ { "id": "d1", "filename": "lease.pdf", "tokens": 38110 },
                 { "id": "d2", "filename": "title-report.pdf", "tokens": 13120 } ] },
    { "key": "overhead",  "label": "Formatting overhead",  "tokens": 540 }
  ],
  "used_tokens": 56210,
  "used_fraction": 0.281
}
```

**How we count tokens (accurately).** Anthropic exposes a dedicated, cheap **token-counting endpoint** — `messages.count_tokens(model, system, messages)` returns `input_tokens` *without* spending generation tokens. Strategy:

- Count each document's `extracted_text` **once at upload** and store it in the new `documents.token_count` column (§2.1). Per-document counts are stable, so this avoids re-tokenizing large files on every request.
- Count the system prompt once (constant); count history on demand (cheap, it's short).
- Per-segment counts are *approximately* additive — boundary effects cause tiny drift, which is fine for a budget meter. (If we ever need exact totals we can count the fully-assembled prompt in one call.)

**How we know the model's context window.** There is **no API that returns this reliably** — Anthropic's Models API gives `id`, `display_name`, `created_at`, `type`, but **not** the window size. The pragmatic, dependency-free approach is a small config map next to the agent definition in `llm.py`, with a safe default:

```python
MODEL_CONTEXT_WINDOWS = {"claude-haiku-4-5-20251001": 200_000}
DEFAULT_CONTEXT_WINDOW = 200_000
RESERVED_OUTPUT_TOKENS = 8_000  # held back for the response
```

(`claude-haiku-4-5` is a 200K-token window.) Libraries like LiteLLM/`tokencost` ship these constants if we'd rather not maintain them, but a tiny local map is the clearest single source of truth.

**Where to place it (UI) — recommended.** A compact **progress ring + percentage in the document-rail header** (§3.2), since documents are by far the largest lever on the budget. Clicking it opens a **popover with a stacked bar / list broken down by category** (and per-document under "Documents"), mirroring Cursor. Rationale: the meter sits right next to the thing the user controls, making "this 80-page lease just pushed me to 90%" immediately actionable (remove a doc, etc.). When usage crosses a warning threshold (e.g., 85%) the ring turns amber; **at/over 100% of the usable budget it turns red, the composer's send is disabled, and we show "Context full — remove a document to continue."**

**Hard gate (both client and server).** The send button is disabled client-side when `used_fraction ≥ 1.0`, and the message endpoint independently **rejects** an over-budget send (e.g., HTTP 413) so the rule can't be bypassed. Removing a document is the user's escape hatch: soft-deleted documents (§2.1) stop counting immediately, dropping usage back under the limit.

**Alternative placement:** next to the chat-input composer (closer to the moment of sending). Reasonable, but further from the documents that dominate usage; we'd still badge per-document totals in the rail. We recommend the rail as primary.

### 2.5 Document Lifecycle Timeline in the Prompt

To give the model temporal grounding (§0.4), the assembled prompt includes a short **timeline** of document add/remove events for the conversation, derived from `uploaded_at` / `deleted_at` (soft delete, §2.1). It lists *all* documents — including removed ones — by their ordinal (§2.6), while only **active** documents contribute their full text.

```text
<document_timeline>
- Document 1 (commercial-lease.pdf) added 2026-06-20 (currently available)
- Document 2 (title-report.pdf) added 2026-06-20, removed 2026-06-20 (no longer available)
</document_timeline>
```

**Always full, never summarized (§0.4).** One line per document event is inherently tiny and bounded by the number of documents, so the timeline is **always rendered in full** — we never summarize or collapse it. This keeps it predictable: the same conversation always produces the same timeline, which matters because the model reasons over it.

**Why it matters:** the conversation history may contain an assistant answer that cited Document 2. If that document is later removed, a naive prompt would still show the old citation with no explanation of why the model can no longer "see" it. The timeline lets the model reconcile this — e.g., respond *"That detail came from Document 2 (title-report.pdf), which has since been removed from this conversation; re-add it if you'd like me to reference it again."* — instead of contradicting itself or hallucinating. We also add a brief system-prompt instruction describing how to use the timeline.

### 2.6 Document Identity & the Citation Handle

Filenames are unreliable as the thing the model cites: they can be non-descriptive (`scan_001.pdf`), inaccurate, or **duplicated across documents with different content** ("report.pdf" twice). Citing by filename alone would be ambiguous; citing by raw UUID (`a1b2c3…`) is unambiguous but meaningless in an answer a lawyer reads.

**Guardrail:** each document carries three identifiers, with clear roles:

| Identifier | Role | Shown to the model | Shown to the user |
|---|---|---|---|
| **Ordinal** (`Document 1`, `Document 2`, …) | The **citation handle** the model uses | yes (primary) | yes (in resolved citations) |
| `id` (UUID) | Canonical machine key; resolves a citation/click to the right row | yes (in the label) | no |
| `filename` | Human-descriptive metadata | yes (in the label) | yes |

Prompt label format:

```text
<document n="1" id="a1b2c3d4e5f6" filename="report.pdf">
--- Page 1 --- ...
</document>
<document n="2" id="f6e5d4c3b2a1" filename="report.pdf">   <!-- same filename, different content — disambiguated by n/id -->
...
</document>
```

- The system prompt instructs: *"Refer to documents by their number and filename, e.g., 'Document 1 (report.pdf)'. When documents share a filename, the number disambiguates them."*
- **Ordinal stability:** the ordinal is the document's rank by `uploaded_at` over *all* documents in the conversation **including soft-deleted ones** (tie-break by `id`). Because soft-deleted rows persist (§2.1), numbers never shift or get reused — Document 2 is always the same document, even after it's removed or new ones are added. This needs no extra column (consistent with §0.8).
- **Resolution:** per-document citation tracking (§2.1) matches the ordinal in the model's output and maps it → `id`, so the rail's "cited" badge and any click-through land on the correct document.

---

## 3. Larger Pieces — Three Alternatives Each

### 3.1 Piece A — How the AI sees multiple documents (context assembly)

This is the most consequential decision: legal documents are long, and `claude-haiku-4-5` has a finite (and billable) **200K-token** window. The strategy determines answer quality, cost, latency, and how much infrastructure we add. **Because there is no upper bound on documents (§0.1) and we refuse to silently drop legal context, the chosen strategy sends the full text of all active documents and blocks the send if that won't fit (§0.2).**

#### Option A1 — Full concatenation with per-document labeling *(recommended first step)*

Concatenate every active document's `extracted_text`, each wrapped and labeled with its ordinal + id + filename (§2.6):

```text
<document n="1" id="a1b2c3d4e5f6" filename="commercial-lease.pdf">
--- Page 1 --- ...
</document>
<document n="2" id="f6e5d4c3b2a1" filename="title-report.pdf">
...
</document>
```

- **Pros:** Minimal change (direct extension of today's prompt); the model sees *everything*, so cross-document reasoning ("compare the lease term to the title restrictions") is strongest; trivial, accurate citations by document name; no new infrastructure.
- **Cons:** Token usage grows with total corpus size → cost & latency scale up; will eventually exceed the context window with many/large documents; no relevance filtering.
- **Best when:** A conversation has a *handful* of documents (the realistic due-diligence case). Add a **token-budget guard** that warns the user / degrades gracefully when the combined size is too large.

#### Option A2 — Retrieval-Augmented Generation (chunk + embed + retrieve)

Chunk each document on upload, embed the chunks, store vectors (e.g., **pgvector** in the existing Postgres), and at query time retrieve the top-k most relevant chunks across all documents to inject into the prompt.

- **Pros:** Scales to many/large documents; lower per-query token cost; injects only relevant context.
- **Cons:** Significant new infrastructure (embedding model/provider, vector storage, chunking strategy, ingest-time latency, a migration for the vector column/index); retrieval can **miss context** for holistic questions ("summarize every document"); citations require chunk→page bookkeeping; more moving parts to test.
- **Best when:** Large corpora or long-lived conversations with dozens of documents.

#### Option A3 — Agentic / hierarchical retrieval (summaries + on-demand fetch)

On upload, generate a short per-document summary / table of contents. At query time, give the model the list of documents + summaries plus a **tool** to fetch the full text (or a section) of a specific document, and let it decide which to open.

- **Pros:** Scales without a vector DB; preserves cross-document awareness via summaries; lower default token use; natural per-document citations.
- **Cons:** Multi-step (extra LLM round-trips → more latency and complexity, including with streaming); requires tool-calling orchestration and summary generation on upload.
- **Best when:** Medium corpora where we want good scaling and UX without standing up a vector store.

**Recommendation:** Ship **A1** first — it directly and most faithfully satisfies "answer across documents *and cite from all of them*" (§0.2), which retrieval-based options can compromise. Implement it behind a single seam — e.g., `build_document_context(documents) -> str` (or a `ContextStrategy` interface) — so we can swap in **A3**, then **A2**, without touching the routers or UI.

Because there is **no upper bound** (§0.1) and these are **legal contracts** where dropped context is unacceptable (§0.2), A1's overflow behavior is a **hard block, not lossy degradation**:

- The **context-usage meter (§2.4)** makes the budget visible *before* the user sends, and warns as they approach the window.
- When `system + history + all active documents + overhead > context_window − reserved_output`, **sending is blocked** (send disabled client-side; the endpoint rejects with HTTP 413 server-side). We never partially include or truncate a contract. The user resolves it by **removing a document** (soft delete frees its tokens immediately) or starting a new conversation.
- Why not the lossy options: excluding later/earlier documents loses pivotal context; per-document prioritization is too complex/error-prone; auto-summarization (A3) needs evaluation studies before we'd trust its fidelity for legal text. These remain the **future scaling path** (graduate to A3, then A2) once we've validated quality — but they are deliberately *not* the v1 fallback.

---

### 3.2 Piece B — Presenting documents & switching the viewer

How users see "which documents are loaded" and move between them in the reader. Today `DocumentViewer` takes exactly one `document`.

#### Option B1 — Tabs across the top of the viewer

One tab per document; click a tab to load it.

- **Pros:** All documents visible at a glance; one-click switching; familiar pattern; minimal new surface area.
- **Cons:** Doesn't scale past ~5–6 documents (horizontal crowding/overflow); little room for per-document metadata or actions.
- **Best when:** Small document counts.

#### Option B2 — Dropdown / select in the viewer header

A compact selector in the existing viewer header lists all documents; selecting one loads it.

- **Pros:** Very compact; scales to many documents; smallest layout change.
- **Cons:** The list is hidden behind a click → less glanceable; weakest at communicating "what's available" at rest; no room for inline actions.
- **Best when:** Constrained width but potentially many documents.

#### Option B3 — Document list panel / rail *(recommended)*

A dedicated, collapsible list of documents (e.g., a slim rail beside the viewer, or a panel above it) showing each document's filename, page count, upload time, an **active** highlight, and room for actions (view, remove, "cited" badge). Selecting an item loads it into the existing `DocumentViewer`.

- **Pros:** Simultaneously satisfies *see which are loaded*, *switch between them*, and *communicate availability*; scales (vertical scroll); space for metadata, remove, and an "+ Add document" affordance.
- **Cons:** Consumes some horizontal space (mitigate with a collapse toggle); slightly more UI to build.
- **Best when:** General case — the most future-proof and the best "how it feels to use."

**Recommendation:** **B3** as the primary pattern, optionally rendering as a compact horizontal strip (B1-like) when there are only one or two documents. The `DocumentViewer` itself stays largely the same; it simply renders whichever document is `active`.

---

### 3.3 Piece C — The upload flow

Today upload happens once via the empty-state uploader (`DocumentUpload` / `EmptyState`); a second upload is impossible.

#### Option C1 — "+ Add document" action in the document rail/header *(recommended primary)*

A persistent add button living with the document list (§3.2), available whenever a conversation is open.

- **Pros:** Highly discoverable; matches the mental model that "documents live here"; obvious that adding doesn't replace existing docs.
- **Cons:** None significant; needs the rail (B3) to feel cohesive.

#### Option C2 — Attach from the chat input (paperclip)

An attach icon beside the send button; documents can be added in the flow of asking a question; support multiple files.

- **Pros:** Matches modern chat UX (ChatGPT/Claude); upload where attention already is.
- **Cons:** Less obvious that documents *persist* in the conversation; still need the rail to show them afterward; mixes "ephemeral attachment" and "persistent corpus" mental models.

#### Option C3 — Global drag-and-drop + multi-file picker

A drop zone over the whole conversation area, plus multi-select in the file dialog, to batch-add documents.

- **Pros:** Fast for power users; natural for adding several files at once.
- **Cons:** Discoverability requires a visible hint; risk of accidental drops; needs clear progress/error feedback for batch uploads.

**Recommendation:** Combine **C1 + C3** — a clear "+ Add document" button as the discoverable primary, backed by drag-and-drop anywhere and multi-file selection for speed, while keeping the existing empty-state uploader for brand-new conversations. The chat-input paperclip (**C2**) is a good later enhancement. Regardless of entry point, surface **per-file progress and per-file errors** (e.g., one bad PDF in a batch shouldn't fail the rest).

---

## 4. Persistence & Migration

- **Persistence requirement is met by construction:** documents are independent rows keyed by `conversation_id`; adding one never touches existing rows, and uploaded files keep their own UUID-prefixed paths in `uploads/`.
- **Single-conversation scope (§0.5):** a document belongs to exactly one conversation; there is no sharing/reuse across chats. Deleting a conversation cascades to its documents (existing `ondelete="CASCADE"` + ORM `cascade="all, delete-orphan"`).
- **Soft delete (§2.1):** user-initiated document removal sets `deleted_at` and purges the file + `extracted_text`, retaining metadata for the timeline (§2.5). Conversation deletion still hard-cascades everything.
- **Migration (`002_multi_document`):** while no change is required merely to *allow* multiple documents, we add one migration that (a) adds `documents.token_count` for the usage meter (§2.4), (b) adds `documents.deleted_at` for soft delete, and (c) adds an index on `documents.conversation_id` (§2.1). No `order_index` (§0.8 — order by `uploaded_at`). Backfill `token_count` for any existing documents. Any RAG approach (A2) would add a further migration for a vector column + index.
- **Backward compatibility:** existing single-document conversations continue to work unchanged — they simply become a list of length one.

---

## 5. Edge Cases & Risks

- **Context-window / token budget (no upper bound, §0.1):** combined documents *will* exceed the window at some corpus size. Handled as a hard gate, not an afterthought — see §3.1 / §2.4. We **block the send** and prompt the user to remove a document; we never truncate or drop a contract silently.
- **Citations across documents (§0.3 / §2.6):** the regex source counter in `llm.py` is document-agnostic; it must be extended to **per-document** attribution keyed on the document **ordinal**, so answers cite the right document and the rail can show a per-document "cited" badge. In scope, not deferred.
- **Citing a since-removed document (§0.4 / §2.5):** if the model cited a document that was later soft-deleted, the prompt timeline tells it so (by ordinal), so it can explain and invite the user to re-add it rather than contradict itself.
- **Duplicate / misleading filenames (§0.10 → §2.6):** the model cites by **stable ordinal** (`Document 2`), not filename, so two files named `report.pdf` (or a non-descriptive name) are never ambiguous; the UUID `id` resolves a citation to the exact row, and files never collide on disk (UUID prefix already handles that).
- **Deleting a document mid-conversation:** soft delete — prior answers that referenced it remain in history, the file + text are purged, and the document still appears in the timeline as "removed".
- **Failed / empty text extraction:** today this silently stores `extracted_text = None`. With multiple docs, flag such documents in the rail ("text not extracted", `token_count = 0`) so users understand why the AI can't reference them.
- **Ordering:** documents are ordered by `uploaded_at` (§0.8) so the prompt and the rail agree.

---

## 6. Testing Strategy

Tests ship with every change (§0.9). The repo is already wired for backend tests (`pytest` + `pytest-asyncio`, `asyncio_mode = "auto"`, `testpaths = ["backend/tests"]` in `pyproject.toml`) but **no tests exist yet**, and there is **no frontend test runner**. So phase 0 includes standing up the harness.

**Backend (pytest):**

- Create `backend/tests/` with a `conftest.py` providing an async DB session against a disposable database (e.g., a transactional rollback per test, or a SQLite/ephemeral Postgres fixture) and a FastAPI `httpx.AsyncClient`.
- **Stub the LLM** — never call Anthropic in tests. Inject a fake `chat_with_documents` / token-counter so tests are deterministic and offline.
- Coverage targets: multi-upload allowed (no more 409); list/delete documents; conversation serialization returns `documents[]` + `document_count`; `build_document_context` labels each document with a **stable ordinal** (rank by `uploaded_at` over all docs incl. soft-deleted; tie-break by `id`) that doesn't shift on delete/add; **over-budget send is blocked (413) and a within-budget send succeeds**; the document timeline includes added + soft-removed events (by ordinal) and only active docs contribute text; per-document citation attribution maps ordinal → `id`; context-usage endpoint math (per-document + totals + reserved); **soft delete sets `deleted_at`, removes the file, clears `extracted_text`, and excludes the doc from active context**; cascade on conversation delete.
- Add a **`just test`** recipe (e.g., `docker compose exec backend uv run pytest`) and fold it into `just check`.

**Frontend (add Vitest + Testing Library):**

- Add `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, plus a `test` script; wire into `npm run check`.
- Coverage targets: `useDocuments` (upload appends, remove, active-doc selection); the document rail (renders all docs, active highlight, "cited" badge, failed-extraction state); viewer switches with `activeDocumentId`; the context meter ring + breakdown popover renders category/per-document values and threshold styling; multi-file/drag-and-drop upload with per-file progress and one-bad-file-doesn't-fail-the-batch.

**Manual/QA smoke:** upload 2+ real PDFs (use `sample-docs/`), ask a cross-document question, confirm citations name the right files, switch documents in the viewer, watch the meter rise per upload, and exercise the overflow path with a large doc.

---

## 7. Recommended Phased Plan

> Each phase ships with its tests (§6). Tracked with checkboxes in [`tasks.md`](./tasks.md).

0. **Test harness:** backend `conftest.py` + LLM stub; add Vitest to the frontend; `just test` recipe.
1. **Migration `002`:** add `documents.token_count` + `documents.deleted_at` + index on `conversation_id` (no `order_index`); backfill `token_count`.
2. **Backend generalization:** remove the 409/guard; add `list` (active only) + **soft-delete** services + endpoints; conversation serialization to `documents[]` + `document_count`.
3. **Context assembly (A1):** `chat_with_documents` with per-document labeling (ordinal + id + filename, §2.6) behind a `build_document_context` seam; assemble all active docs; **block send (HTTP 413) when over budget** — no truncation; include the **document timeline** (§2.5).
4. **Per-document citations:** extend source tracking from regex to per-document attribution keyed on the **ordinal** → `id`; persist which docs informed an answer.
5. **Context-usage meter:** token counting at upload (store `token_count`), `GET /context-usage` endpoint, ring + breakdown popover in the rail; **disable send + red state at 100%** (§2.4).
6. **Frontend data layer:** `useDocuments` hook, updated `types.ts`.
7. **Document rail (B3) + upload (C1/C3):** list with active state, add/remove, drag-and-drop + multi-file, per-file feedback.
8. **Viewer switching:** drive `DocumentViewer` from `activeDocumentId`.
9. **Polish:** empty/failed-extraction states, collapse toggle, over-budget messaging on the meter.
10. **Later, if needed:** graduate context strategy to A3 (after evaluation studies) then A2 as corpus size grows; add chat-input attach (C2).

---

## 8. Open Questions

None outstanding — the design decisions are settled (see §0). New questions will be added here as implementation surfaces them.

*Resolved in review:* no upper bound on document count/size (§0.1); over-budget blocks sending, no lossy degradation (§0.2); citations span all documents (§0.3); document timeline in the prompt, always full/no summaries (§0.4); single-conversation scope (§0.5); `RESERVED_OUTPUT_TOKENS = 8K` (§0.6); no total-size cap (§0.7); order by `uploaded_at`, no `order_index` (§0.8); tests required throughout (§0.9); documents identified by stable ordinal, not filename/UUID (§0.10). Retention of soft-deleted rows: keep indefinitely (metadata only). No "remove largest document" affordance (too subjective).
