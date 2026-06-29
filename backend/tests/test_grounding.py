from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Message, MessageCitedDocument
from takehome.services.llm import (
    AnnotatedBlock,
    AnswerAnnotation,
    CitationRef,
    DocumentContext,
    aggregate_citations,
    build_judge_prompt,
    enrich_grounding,
    has_active_documents,
    quote_verified_in_text,
)

T1 = datetime(2026, 1, 1, 10, 0, 0)
T2 = datetime(2026, 1, 1, 11, 0, 0)


def _doc(
    *,
    ordinal: int,
    doc_id: str,
    filename: str = "d.pdf",
    uploaded_at: datetime = T1,
    deleted_at: datetime | None = None,
    extracted_text: str = "text",
) -> DocumentContext:
    return DocumentContext(
        ordinal=ordinal,
        id=doc_id,
        filename=filename,
        uploaded_at=uploaded_at,
        extracted_text=extracted_text,
        deleted_at=deleted_at,
    )


def _annotation(
    *,
    basis: str = "document",
    citations: list[CitationRef] | None = None,
    status: str = "grounded",
    summary: str | None = None,
) -> AnswerAnnotation:
    return AnswerAnnotation(
        blocks=[
            AnnotatedBlock(
                block_index=0,
                text="Sample block",
                basis=basis,  # type: ignore[arg-type]
                citations=citations or [],
            )
        ],
        grounding_status=status,  # type: ignore[arg-type]
        summary=summary,
    )


def test_aggregate_citations_counts_document_and_mixed_blocks() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa"), _doc(ordinal=2, doc_id="bbb", uploaded_at=T2)]
    annotation = AnswerAnnotation(
        blocks=[
            AnnotatedBlock(
                block_index=0,
                text="Cap is £2m",
                basis="document",
                citations=[
                    CitationRef(document_ordinal=1, label="Section 4.1", quote="£2m"),
                ],
            ),
            AnnotatedBlock(
                block_index=1,
                text="Law is England",
                basis="mixed",
                citations=[
                    CitationRef(document_ordinal=2, label="Section 9", quote="England"),
                    CitationRef(document_ordinal=2, label="Schedule 1", quote="foo"),
                ],
            ),
            AnnotatedBlock(
                block_index=2,
                text="Market norm",
                basis="general_knowledge",
                citations=[],
            ),
        ],
        grounding_status="partial",
        summary="Cap documented; law partly inferred.",
    )

    total, citations = aggregate_citations(annotation, docs)
    assert total == 3
    assert {c.document_id: c.count for c in citations} == {"aaa": 1, "bbb": 2}


def test_aggregate_citations_ignores_not_in_documents() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa")]
    annotation = _annotation(
        basis="not_in_documents",
        citations=[CitationRef(document_ordinal=1, label="Section 99", quote="fake")],
        status="ungrounded",
    )

    total, citations = aggregate_citations(annotation, docs)
    assert total == 0
    assert citations == ()


def test_quote_verified_normalizes_whitespace() -> None:
    text = "The aggregate liability shall not exceed £2,000,000"
    quote = "aggregate  liability   shall\nnot exceed £2,000,000"
    assert quote_verified_in_text(quote, text) is True


def test_quote_verified_false_when_absent() -> None:
    assert quote_verified_in_text("Section 4.2 indemnity", "No such clause here.") is False
    assert quote_verified_in_text(None, "some text") is False


def test_enrich_grounding_sets_verified_and_document_ids() -> None:
    docs = [
        _doc(
            ordinal=1,
            doc_id="aaa",
            extracted_text="The cap is £2,000,000 for all claims.",
        )
    ]
    annotation = _annotation(
        citations=[
            CitationRef(
                document_ordinal=1,
                label="Section 4.1",
                page=7,
                quote="The cap is £2,000,000",
            )
        ],
    )

    result = enrich_grounding(annotation, docs)
    assert result.grounding_status == "grounded"
    assert result.sources_cited == 1
    citation = result.blocks[0].citations[0]
    assert citation.document_id == "aaa"
    assert citation.verified is True


def test_enrich_grounding_marks_fake_quote_unverified() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", extracted_text="Only real text here.")]
    annotation = _annotation(
        basis="document",
        citations=[
            CitationRef(
                document_ordinal=1,
                label="Section 4.2",
                quote="This clause does not exist in the document.",
            )
        ],
        status="partial",
        summary="Cited section not found.",
    )

    result = enrich_grounding(annotation, docs)
    assert result.blocks[0].citations[0].verified is False


def test_has_active_documents_respects_soft_delete() -> None:
    docs = [_doc(ordinal=1, doc_id="a"), _doc(ordinal=2, doc_id="b", deleted_at=T2)]
    assert has_active_documents(docs) is True
    assert has_active_documents([_doc(ordinal=1, doc_id="a", deleted_at=T1)]) is False


def test_build_judge_prompt_includes_question_and_answer() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", extracted_text="Lease terms apply.")]
    prompt = build_judge_prompt("What is the term?", "Five years per Document 1.", docs)
    assert "What is the term?" in prompt
    assert "Five years per Document 1." in prompt
    assert 'n="1"' in prompt
    assert "exact contiguous spans" in prompt
    assert "absence/gap claims should be mixed" in prompt


def test_judge_prompt_requires_verbatim_quotes_and_mixed_absence() -> None:
    from takehome.services.llm import JUDGE_SYSTEM_PROMPT

    assert "contiguous span" in JUDGE_SYSTEM_PROMPT
    assert "Do NOT summarize" in JUDGE_SYSTEM_PROMPT
    assert "Absence and gap claims" in JUDGE_SYSTEM_PROMPT
    assert "Classify as mixed" in JUDGE_SYSTEM_PROMPT


PDF_BYTES = b"%PDF-1.4 fake content for tests"


@pytest.fixture
def upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from takehome.services import document as document_module

    path = tmp_path / "uploads"
    monkeypatch.setattr(document_module.settings, "upload_dir", str(path))
    return path


async def _read_sse(response) -> list[dict]:
    events: list[dict] = []
    async for line in response.aiter_lines():
        if line.startswith("data: "):
            events.append(json.loads(line.removeprefix("data: ")))
    return events


def _fake_judge_from_answer(
    *,
    user_message: str,
    answer_text: str,
    documents: list[DocumentContext],
) -> AnswerAnnotation:
    del user_message
    citations: list[CitationRef] = []
    for match in re.finditer(r"document\s+(\d+)\b", answer_text, re.IGNORECASE):
        ordinal = int(match.group(1))
        if any(d.ordinal == ordinal and d.is_active for d in documents):
            citations.append(
                CitationRef(
                    document_ordinal=ordinal,
                    label="Section 2",
                    page=1,
                    quote=None,
                )
            )
    basis = "document" if citations else "not_in_documents"
    status = "grounded" if citations else "ungrounded"
    return AnswerAnnotation(
        blocks=[
            AnnotatedBlock(
                block_index=0,
                text=answer_text,
                basis=basis,
                citations=citations,
            )
        ],
        grounding_status=status,
        summary=None,
    )


async def test_sse_emits_content_done_before_grounding(
    client: AsyncClient,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import takehome.services.llm as llm_module
    import takehome.web.routers.messages as messages_module

    async def citing_chat(*_args: object, **_kwargs: object):
        yield "Document 1 applies."

    async def fake_judge(*, user_message: str, answer_text: str, documents: list, **_kw):
        return _fake_judge_from_answer(
            user_message=user_message,
            answer_text=answer_text,
            documents=documents,
        )

    for module in (llm_module, messages_module):
        monkeypatch.setattr(module, "chat_with_documents", citing_chat, raising=False)
        monkeypatch.setattr(module, "judge_grounding", fake_judge, raising=False)

    conv_id = (await client.post("/api/conversations")).json()["id"]
    await client.post(
        f"/api/conversations/{conv_id}/documents",
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    stream = await client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"content": "Summarize"},
    )
    events = await _read_sse(stream)
    types = [e["type"] for e in events]
    content_done = next(e for e in events if e["type"] == "content_done")
    assert content_done["grounding_pending"] is True
    assert types.index("content_done") < types.index("grounding")
    assert types.index("grounding") < types.index("message")


async def test_sse_emits_grounding_before_message(
    client: AsyncClient,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import takehome.services.llm as llm_module
    import takehome.web.routers.messages as messages_module

    async def citing_chat(*_args: object, **_kwargs: object):
        yield "Document 1 applies."

    async def fake_judge(*, user_message: str, answer_text: str, documents: list, **_kw):
        return _fake_judge_from_answer(
            user_message=user_message,
            answer_text=answer_text,
            documents=documents,
        )

    for module in (llm_module, messages_module):
        monkeypatch.setattr(module, "chat_with_documents", citing_chat, raising=False)
        monkeypatch.setattr(module, "judge_grounding", fake_judge, raising=False)

    conv_id = (await client.post("/api/conversations")).json()["id"]
    await client.post(
        f"/api/conversations/{conv_id}/documents",
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    stream = await client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"content": "Summarize"},
    )
    events = await _read_sse(stream)
    types = [e["type"] for e in events]
    assert types.index("grounding") < types.index("message")


async def test_message_persists_grounding_payload(
    client: AsyncClient,
    db_session: AsyncSession,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end: judge-derived citations and grounding fields are stored."""
    import takehome.services.llm as llm_module
    import takehome.web.routers.messages as messages_module

    async def citing_chat(*_args: object, **_kwargs: object):
        for chunk in (
            "Document 1 (a.pdf), Section 2 applies. "
            "Document 2 (b.pdf), page 5 confirms."
        ).split():
            yield chunk + " "

    async def fake_judge(*, user_message: str, answer_text: str, documents: list, **_kw):
        return _fake_judge_from_answer(
            user_message=user_message,
            answer_text=answer_text,
            documents=documents,
        )

    for module in (llm_module, messages_module):
        monkeypatch.setattr(module, "chat_with_documents", citing_chat, raising=False)
        monkeypatch.setattr(module, "judge_grounding", fake_judge, raising=False)

    conv = (await client.post("/api/conversations")).json()
    conv_id = conv["id"]

    first = await client.post(
        f"/api/conversations/{conv_id}/documents",
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    second = await client.post(
        f"/api/conversations/{conv_id}/documents",
        files={"file": ("b.pdf", PDF_BYTES, "application/pdf")},
    )
    doc_a = first.json()["id"]
    doc_b = second.json()["id"]

    stream = await client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"content": "Compare both documents"},
    )
    assert stream.status_code == 200
    events = await _read_sse(stream)
    grounding_event = next(e for e in events if e["type"] == "grounding")
    assert grounding_event["grounding_status"] == "grounded"

    done = next(e for e in events if e["type"] == "done")
    assert set(done["cited_document_ids"]) == {doc_a, doc_b}

    listing = await client.get(f"/api/conversations/{conv_id}/messages")
    assistant = [m for m in listing.json() if m["role"] == "assistant"][0]
    cited_ids = {c["document_id"] for c in assistant["cited_documents"]}
    assert cited_ids == {doc_a, doc_b}
    assert assistant["sources_cited"] == 2
    assert assistant["grounding_status"] == "grounded"
    assert assistant["blocks"]

    rows = (
        await db_session.execute(
            select(MessageCitedDocument).where(
                MessageCitedDocument.message_id == assistant["id"]
            )
        )
    ).scalars().all()
    assert {r.document_id for r in rows} == {doc_a, doc_b}

    msg_row = await db_session.get(Message, assistant["id"])
    assert msg_row is not None
    assert msg_row.grounding_status == "grounded"
    assert msg_row.grounding_payload is not None
