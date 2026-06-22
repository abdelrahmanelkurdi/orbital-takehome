from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Message, MessageCitedDocument
from takehome.services.llm import DocumentContext, analyze_document_citations

T1 = datetime(2026, 1, 1, 10, 0, 0)
T2 = datetime(2026, 1, 1, 11, 0, 0)


def _doc(
    *,
    ordinal: int,
    doc_id: str,
    filename: str = "d.pdf",
    uploaded_at: datetime = T1,
    deleted_at: datetime | None = None,
) -> DocumentContext:
    return DocumentContext(
        ordinal=ordinal,
        id=doc_id,
        filename=filename,
        uploaded_at=uploaded_at,
        extracted_text="text",
        deleted_at=deleted_at,
    )


def test_ordinal_maps_to_correct_document_id() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf"),
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", uploaded_at=T2),
    ]
    response = (
        "Per Document 1 (lease.pdf), the term is 5 years. "
        "Document 2 (title.pdf) mentions a restriction in Section 3."
    )
    analysis = analyze_document_citations(response, docs)

    assert analysis.cited_document_ids == ["aaa", "bbb"]
    by_id = {c.document_id: c for c in analysis.citations}
    assert by_id["aaa"].ordinal == 1
    assert by_id["bbb"].ordinal == 2


def test_counts_per_document() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa"),
        _doc(ordinal=2, doc_id="bbb", uploaded_at=T2),
    ]
    response = (
        "Document 1, Section 4 covers rent. "
        "Document 1 also references page 12. "
        "Document 2, clause 7 applies."
    )
    analysis = analyze_document_citations(response, docs)

    by_id = {c.document_id: c.count for c in analysis.citations}
    # Document 1 is cited twice; Document 2 once.
    assert by_id["aaa"] == 2
    assert by_id["bbb"] == 1
    assert analysis.total == 3


def test_duplicate_filenames_resolve_by_ordinal() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="report.pdf"),
        _doc(ordinal=2, doc_id="bbb", filename="report.pdf", uploaded_at=T2),
    ]
    response = (
        "Document 1 (report.pdf) covers alpha. "
        "Document 2 (report.pdf) covers beta."
    )
    analysis = analyze_document_citations(response, docs)

    assert analysis.cited_document_ids == ["aaa", "bbb"]
    assert {c.document_id: c.ordinal for c in analysis.citations} == {
        "aaa": 1,
        "bbb": 2,
    }


def test_soft_deleted_document_ordinal_still_resolves() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa"),
        _doc(ordinal=2, doc_id="bbb", uploaded_at=T2, deleted_at=T2),
    ]
    response = (
        "That detail came from Document 2, which has since been removed."
    )
    analysis = analyze_document_citations(response, docs)

    assert analysis.cited_document_ids == ["bbb"]
    assert analysis.citations[0].ordinal == 2


def test_unknown_ordinal_ignored() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa")]
    analysis = analyze_document_citations("See Document 99 for details.", docs)
    assert analysis.citations == ()
    assert analysis.total == 0


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


async def test_message_persists_cited_documents(
    client: AsyncClient,
    db_session: AsyncSession,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end: assistant response citations are stored on the message."""
    import takehome.services.llm as llm_module
    import takehome.web.routers.messages as messages_module

    async def citing_chat(*_args: object, **_kwargs: object):
        for chunk in (
            "Document 1 (a.pdf), Section 2 applies. "
            "Document 2 (b.pdf), page 5 confirms."
        ).split():
            yield chunk + " "

    for module in (llm_module, messages_module):
        monkeypatch.setattr(module, "chat_with_documents", citing_chat, raising=False)

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
    done = next(e for e in events if e["type"] == "done")
    assert set(done["cited_document_ids"]) == {doc_a, doc_b}

    listing = await client.get(f"/api/conversations/{conv_id}/messages")
    assistant = [m for m in listing.json() if m["role"] == "assistant"][0]
    cited_ids = {c["document_id"] for c in assistant["cited_documents"]}
    assert cited_ids == {doc_a, doc_b}
    assert assistant["sources_cited"] > 0

    rows = (
        await db_session.execute(
            select(MessageCitedDocument).where(
                MessageCitedDocument.message_id == assistant["id"]
            )
        )
    ).scalars().all()
    assert {r.document_id for r in rows} == {doc_a, doc_b}
