# Grounded Answers & Verify-in-Document Citations — Design Draft

> **Status:** Phase 0 signed off — ready for implementation.
> **Source:** Beta analytics (`data/usage_events.csv`) and user interviews (`data/customer_feedback.md`), 3-week beta, ~50 users.

---

## Problem statement

Lawyers adopt the tool when answers cite real document sections — and **abandon it** when the model sounds authoritative but cites content that is not in the document. In legal due diligence, being confidently wrong is worse than being slow.

Multi-document support (see [`../multi-document/`](../multi-document/)) already gives us ordinal citations, per-document attribution, and a document rail. What is missing is a **trust layer**: making grounding visible, enforcing it where possible, and turning citations into **one-click verification** in the PDF viewer.

---

## Evidence from beta

### Usage data (`usage_events.csv`)

| Signal | Finding |
|--------|---------|
| Citation rate | **49%** of AI responses had `sources_cited = 0` |
| Positive feedback | **75 / 77** thumbs-up followed a response with `sources_cited > 0`; only **2 / 77** followed zero citations |
| Negative feedback | **8 / 25** thumbs-down followed zero citations; **17 / 25** followed cited responses (consistent with “cited a clause that doesn’t exist”) |
| Document friction | **63 uploads**, **15 unique files** → ~**76% re-uploads** of the same PDFs across chats |
| Multi-doc usage | **2 / 61** conversations with uploads had 2+ documents (expected under single-doc beta) |

### User interviews (selected themes)

| Theme | Who | Quote (paraphrased) |
|-------|-----|---------------------|
| **Hallucination / trust** | Partners A & B, Associate | Authoritative wrong answers are “terrifying” on £40M deals; one associate stopped using the product after a fabricated clause |
| **Citations = value** | Associate, Firm A | When the AI cites section 4.2, “it’s magic”; without specifics, they verify manually anyway |
| **Honest uncertainty** | Partner, Firm A | Would pay 2× for the model to say when it’s not sure |
| **Workflow friction** | Senior Associate, Firm D | Re-uploaded the same lease in three chats |
| **Compare / export / annotate** | Firms C, E, F, H | Side-by-side compare, Word export, highlighting, Ctrl+F — valuable but secondary to trust |

**Conclusion:** Trust and verifiable grounding are the highest-leverage improvement. Workflow features (library, export, annotations) are strong v2 candidates.

---

## Goal

Every assistant answer on document Q&A should be either:

1. **Grounded** — claims about the documents are backed by evidence the user can verify, or
2. **Explicitly uncertain** — clearly states what is not supported by uploaded documents

Citations should be **actionable**: per paragraph/bullet **attachment chips** (Google AI-mode style) that open the right document and jump to the relevant location.

---

## Non-goals (v1)

- Cross-conversation document library (see multi-document §0.5 — docs stay scoped to one chat)
- Report export to Word (separate initiative)
- PDF freehand annotation (separate initiative)
- Replacing A1 full-document context with RAG-only generation

---

## Architecture overview

Two agents, two jobs — do not ask the answering model to grade its own homework.

```
User question
    → [Answer agent] stream markdown prose (existing chat_with_documents)
    → user reads while…
    → [Judge agent] structured verdict + per-block annotations (pydantic output)
    → optional: deterministic quote check against extracted_text
    → persist Message + blocks + grounding_verdict
    → SSE: content chunks, then citations/grounding event
    → frontend: Streamdown + attachment chip per block; click → viewer jump
```

| Layer | Source | Trust level | Used for |
|-------|--------|-------------|----------|
| **Judge (structured)** | Judge agent `AnswerAnnotation` — per-block citations + `basis` | Medium–high — “is this claim supported?” | `grounding_status`, attachment chips, warnings, **footer counts, rail “Cited” badges** |
| **Deterministic** | Substring/fuzzy match of judge quotes in `extracted_text` | High for exact quotes | Chip `verified` flag; downgrade unverified quotes |

**Single source of truth for citations:** aggregate `sources_cited`, `cited_documents`, and rail badges from judge output (blocks where `basis` is `document` or `mixed`, counting `CitationRef`s per ordinal). Retire `analyze_document_citations` regex once judge ships — it cannot detect fake sections and duplicates the judge’s job poorly.

**Why not self-reported structure from the answer agent?** Any structured citations or `grounding_status` emitted by the model that wrote the answer — whether in one shot (Approaches A/D) or block-at-a-time — shares the same hallucination bias as the prose. The judge sees documents independently and must quote evidence — adversarial framing, temperature 0.

---

## 1. Structured citations (pydantic-ai)

Today `agent` in `llm.py` is a pydantic-ai `Agent` with **free-text** output via `run_stream`. Citations today are recovered with regex (`analyze_document_citations`) — sufficient for a prototype footer, but **replaced by judge output** in this initiative (see architecture table above).

### Target UX (Google AI-mode style)

Each paragraph or bullet ends with one or more compact **attachment chips** (paperclip / doc icon + “Doc 2 · §4.1”). Click → activate document in rail + jump viewer. Multiple docs → stacked chips.

### pydantic-ai options

| Approach | Streaming | Attachment UX | Trust | Recommendation |
|----------|-----------|---------------|-------|----------------|
| **A. `output_type=AnswerAnnotation` on answer agent** | Loses token streaming | Excellent | **Rejected** — self-graded | Do not use |
| **B. Stream prose + judge agent** | Keep streaming | Excellent | Independent reviewer | **Recommended v1** |
| **C. Inline markers in streamed markdown** (`<!--cite:1:4.1-->`) | Yes | Good | Author-controlled | Fragile; not recommended |
| **D. Answer agent emits blocks structurally; UI renders block-by-block** | Pseudo-stream | Excellent | **Rejected** — same model grades its own blocks | Do not use |

**Recommended: B — dual agent**

1. **Answer agent** (existing): stream natural markdown; prompt still asks for inline “Document N, Section …” for human readability.
2. **Annotation agent** (new pydantic-ai agent, `output_type=AnswerAnnotation`):

```python
class CitationRef(BaseModel):
    document_ordinal: int
    label: str          # "Section 4.1", "page 12"
    page: int | None = None
    quote: str | None   # verbatim excerpt judge believes supports the block

class AnnotatedBlock(BaseModel):
    block_index: int
    text: str           # mirrors a paragraph/bullet from the answer
    basis: Literal["document", "general_knowledge", "mixed", "not_in_documents"]
    citations: list[CitationRef]

class AnswerAnnotation(BaseModel):
    blocks: list[AnnotatedBlock]
    grounding_status: Literal["grounded", "partial", "ungrounded"]
    summary: str | None  # one-line explanation for partial/ungrounded
```

The annotation/judge agent receives: user question, final answer text, and the same document bodies the answer agent saw. It **segments** the answer into blocks and attaches citations + `basis` per block.

**SSE shape:**

```json
{"type": "content", "content": "…chunk…"}
{"type": "grounding", "grounding_status": "partial", "blocks": […]}
```

Frontend initially renders prose; when `grounding` arrives, inject chips at block boundaries (match by `block_index` / normalized text prefix).

### Deriving footer & rail counts from judge output

```python
def aggregate_citations(annotation: AnswerAnnotation, ordinal_to_id: dict[int, str]) -> tuple[int, list[CitedDocument]]:
    """sources_cited + cited_documents for footer and document rail — no regex."""
    counts: dict[str, int] = {}
    for block in annotation.blocks:
        if block.basis not in ("document", "mixed"):
            continue
        for ref in block.citations:
            doc_id = ordinal_to_id.get(ref.document_ordinal)
            if doc_id:
                counts[doc_id] = counts.get(doc_id, 0) + 1
    items = [CitedDocument(document_id=d, citation_count=c) for d, c in sorted(counts.items())]
    return sum(counts.values()), items
```

Only document-backed refs count toward “cited” badges; `general_knowledge` / `not_in_documents` blocks contribute nothing.

### Why the answer agent must not emit `AnswerAnnotation`

Approaches **A** and **D** both have the answer agent produce structured citations. That fails for the same reason as self-reported `grounding_status`: the author can attach plausible-looking `CitationRef`s to unsupported claims. Block-at-a-time delivery (D) improves perceived latency but **does not** fix the trust problem. All structured citation metadata comes from the **judge agent only**.

---

## 2. Grounding status — how we trust it

### What we reject

| Method | Problem |
|--------|---------|
| Regex on answer text (`analyze_document_citations`) | Misses fake citations; counts mentions, not support — **retire after judge ships** |
| Answer agent structured output (A/D) | Same model, same bias — will over-report grounding |
| UI-only warnings without verification | Doesn’t fix “cited clause doesn’t exist” |

### What we build: judge agent

Separate **grounding judge** (can share `AnswerAnnotation` schema above):

**Prompt principles:**

- You are a skeptical reviewer, not the author.
- For each block, classify `basis`:
  - `document` — claim supported by quoted text in uploaded documents
  - `general_knowledge` — legal concept / market norm not stated in docs
  - `mixed` — partly from docs, partly inference/world knowledge
  - `not_in_documents` — factual claim about the deal with no support
- **Require** `quote` for `document` citations; quote must appear verbatim (modulo whitespace) in document text.
- If the answer cites “Section 4.2” but no such section exists, mark `not_in_documents` or `mixed` and explain in `summary`.

**Overall `grounding_status`:**

| Status | Rule |
|--------|------|
| `grounded` | All substantive blocks are `document` with valid quotes |
| `partial` | Mix of `document` + `general_knowledge` / `mixed`, or some unsupported sub-claims |
| `ungrounded` | No document-backed blocks, or critical claims are `not_in_documents` |

**Latency:** Judge runs **after** stream completes (~1–3s). User already reading answer; chips show “Verifying…” then populate. Acceptable trade-off per beta feedback (trust > speed).

**Optional hardening:** Post-judge, run deterministic check: `quote in extracted_text` → chip gets `verified: true`. Fails → amber “unverified quote” chip. No extra LLM call.

---

## 3. Partial grounding UX

See **§7 Copy spec** for locked banner, chip, and footer strings. Summary:

- **`grounded`:** subtle green check (no heavy banner)
- **`partial`:** show judge `grounding_summary` (not a generic fixed banner)
- **`ungrounded`:** “Review carefully” banner
- **Per-block:** icon chips + tooltips; `general_knowledge` chip on every such block; paragraph red outline for `not_in_documents`

---

## 4. Click-to-verify & section jump

### v1 — page jump (straightforward)

Upload pipeline already prefixes pages in `extracted_text`:

```text
--- Page 7 ---
…
```

**On chip click:**

1. Resolve `document_ordinal` → `document_id` (existing ordinal map)
2. Parse `page` from `CitationRef` or search extracted text for section heading → nearest `--- Page N ---` marker
3. `DocumentViewer`: accept `initialPage` prop; set `currentPage` and scroll

### Extra mile — highlight on page

| Technique | Effort | Fidelity |
|-----------|--------|----------|
| Scroll to page only | Low | Good enough for v1 |
| Search PDF text layer (react-pdf) for `quote` substring | Medium | Highlights exact phrase if text layer matches extraction |
| Store char-offset → page bbox at upload (PyMuPDF) | High | Best long-term |

**Recommendation:** ship page jump in v1; add text-layer highlight when `quote` is present as stretch / v1.1. Defer bbox indexing unless users still complain after page jump.

Chip click payload:

```typescript
{
  documentId: string;
  page?: number;
  searchText?: string;  // quote or section label for highlight/search
}
```

---

## 5. API & persistence (sketch)

```json
{
  "id": "msg_…",
  "role": "assistant",
  "content": "…markdown…",
  "sources_cited": 5,
  "cited_documents": [{ "document_id": "abc", "citation_count": 2 }],
  "grounding_status": "partial",
  "grounding_summary": "Indemnity cap is documented; governing law is inferred.",
  "blocks": [
    {
      "block_index": 0,
      "text": "The indemnity cap is £2m…",
      "basis": "document",
      "citations": [
        {
          "document_ordinal": 2,
          "document_id": "abc",
          "label": "Section 4.1",
          "page": 7,
          "quote": "The aggregate liability shall not exceed £2,000,000",
          "verified": true
        }
      ]
    }
  ]
}
```

**Storage:** new JSON column `grounding_payload` on `messages`, or normalized `message_grounding_blocks` table if we need queryability. JSON column is fine for v1.

**`sources_cited` / `cited_documents`:** derived from judge aggregation (above), persisted on the message for API compatibility. Remove `analyze_document_citations` from the message path once grounded citations ship.

---

## 6. Answer agent prompt (still worth doing)

Even with a judge, tighten the answer agent prompt:

- Must cite `Document N, Section/Clause/Page` when stating document facts
- Must use the not-found template when content is absent
- Never invent clause numbers or quoted language

This improves human-readable prose and gives the judge clearer blocks to audit — but **trust UI comes from the judge**, not the answer agent’s compliance.

---

## Alternatives considered

| Approach | Pros | Cons |
|----------|------|------|
| Regex-only citations | Fast, no extra cost | Cannot detect fake sections; **superseded by judge** |
| Self-reported structured output from answer agent (A/D) | One call / pseudo-stream | Same hallucination bias — **rejected** |
| **Stream + judge agent (recommended)** | Streaming UX + independent verification | +1 LLM call latency after stream |
| RAG-only generation | Strong retrieval grounding | Major refactor vs A1 |

---

## Success metrics

- ↓ Thumbs-down rate on document Q&A
- ↓ Judge-marked `not_in_documents` blocks over time (answer prompt tuning)
- ↑ Citation chip click-through (`citation_clicked` event)
- ↑ Share of blocks with `verified: true` quotes
- Qualitative: partners trust partial answers when general-knowledge sections are labelled

---

## 7. Copy spec (locked — Phase 0)

**Tone:** clinical / legal — prefer “not supported by uploaded documents” over casual phrasing. Avoid “verified” as a legal warranty; describe what we found, not what we guarantee.

### Message-level

| `grounding_status` | UI | Copy |
|--------------------|-----|------|
| `grounded` | Subtle green check above/beside message | Icon + tooltip: **“Supported by your uploaded documents”** (easy to remove later if too noisy) |
| `partial` | Amber info strip | Judge **`grounding_summary`** verbatim (e.g. “Indemnity cap is documented; governing law is inferred.”) |
| `ungrounded` | Amber warning strip | **“Review carefully — not supported by uploaded documents.”** |
| *(while judge runs)* | Inline below streaming text | **“Checking sources…”** |

Answers are never blocked (locked decision #2); warnings inform, they do not hide content.

### Per-block attachment chips

**Format:** **icon only** on the chip (paperclip or doc icon); detail in **tooltip** and `aria-label`. No inline `Doc 2 · §4.1` text on the chip face.

| Block `basis` | Chip | Tooltip (example) |
|---------------|------|-------------------|
| `document`, quote verified | Default/green icon | **“Document 2, Section 4.1 — click to view”** + optional quote preview |
| `document`, quote not in text | Amber icon | **“Couldn’t locate quote in document text”** |
| `mixed` | Amber icon | **“Partly from documents, partly inferred”** + location if known |
| `general_knowledge` | Grey icon — **show on every such block** | **“General knowledge — not from your documents”** |
| `not_in_documents` | No chip; **red left border** on paragraph | Tooltip on paragraph: **“Not supported by uploaded documents”** |

**Click:** chip activates document in rail + page jump (§4). `aria-label` mirrors tooltip for screen readers.

### Footer vs chips

| Element | Role |
|---------|------|
| **Footer** (`formatCitationSummary`) | Document **count** — “3 documents cited (5 references)” from judge aggregation |
| **Chips** | **Location** — where to click to verify; one chip set per block |

Do not duplicate counts on chips.

---

## Locked decisions

| # | Decision |
|---|----------|
| 1 | **Judge runs only when ≥1 active document** is attached |
| 2 | **`ungrounded` answers shown with warning**, not blocked — legal users may still want draft text |
| 3 | **Same model (Haiku), temperature 0** for judge; revisit if cost/latency bites |
| 4 | **No separate confidence %** — `basis` + `grounding_status` cover it |
| 5 | **Page jump v1**; text-layer highlight v1.1; bbox index later |
| 6 | **Judge is the single source of truth** for citations, counts, badges, and grounding — regex retired |
| 7 | **Answer agent stays free-text only** — never emits `AnswerAnnotation` (Approaches A/D rejected on trust) |
| 8 | **Copy spec (§7)** — clinical tone; green check when grounded; `grounding_summary` for partial; “Review carefully” for ungrounded; icon+tooltip chips; “Couldn’t locate quote”; GK chip per block; footer=count, chips=location |

---

## Related docs

- Shipped multi-document design: [`../multi-document/multi-document-support.md`](../multi-document/multi-document-support.md)
- Task tracker: [`tasks.md`](./tasks.md)
- Beta data: [`../../data/usage_events.csv`](../../data/usage_events.csv), [`../../data/customer_feedback.md`](../../data/customer_feedback.md)
