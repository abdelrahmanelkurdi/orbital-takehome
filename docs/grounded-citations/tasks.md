# Grounded Citations — Task Tracker

> **Status:** Phase 3 complete — Phase 4 (optional) next.
> **Depends on:** Multi-document support (Phases 0–9, see [`../multi-document/tasks.md`](../multi-document/tasks.md)).

---

## Phase 0 — Design sign-off

- [x] Confirm dual-agent pattern (stream answer + judge annotation)
- [x] Confirm `basis` enum and partial-grounding UX
- [x] Judge replaces regex for all citation counts / badges
- [x] Reject answer-agent structured output (Approaches A/D) on trust grounds
- [x] Stakeholder review of banner/chip copy (see design §7)

## Phase 1 — Judge agent & schemas

- [x] Pydantic models: `CitationRef`, `AnnotatedBlock`, `AnswerAnnotation`
- [x] `judge_grounding()` agent in `llm.py` (separate from answer agent)
- [x] `aggregate_citations()` — derive `sources_cited` / `cited_documents` from judge output
- [x] Deterministic quote verification against `extracted_text`
- [x] Persist `grounding_status`, `grounding_summary`, `blocks` on message
- [x] SSE `grounding` event after stream completes
- [x] Retire `analyze_document_citations` from message path (keep tests until removed)
- [x] Tests: grounded / partial / ungrounded; fake section detection; quote verify; aggregation

## Phase 2 — Per-block attachment chips (chat UI)

- [x] Extend `Message` / `MessageOut` types with grounding payload
- [x] Render chips on paragraphs/bullets when `grounding` event arrives
- [x] Chip styles by `basis` (document / mixed / general_knowledge / not_in_documents)
- [x] Message-level banner from `grounding_status`
- [x] “Verifying…” state while judge runs
- [x] Unfreeze input after `content_done` (streaming vs verifying split)
- [x] Tests: chip render, basis colors, banner visibility

## Phase 3 — Click-to-verify (viewer)

- [x] Chip click → `setActiveDocument` + pass jump target to viewer
- [x] `DocumentViewer`: `jumpRequest` with page + `searchText`
- [x] Resolve section label → page via `--- Page N ---` markers in extracted text
- [x] Tests: ordinal → document; page jump on click

## Phase 4 — Extra mile (optional)

- [x] PDF text-layer search highlight for `quote` on target page
- [ ] `citation_clicked` analytics event
- [ ] Manual QA on `sample-docs/` cross-document questions

---

## Deferred / v2

- [ ] Char-offset bbox index at upload for precise highlight
- [ ] Firm document library
- [ ] Report export
- [ ] PDF annotations / Ctrl+F in viewer
