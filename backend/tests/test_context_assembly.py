from __future__ import annotations

from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Document
from takehome.services import llm
from takehome.services.llm import (
    DocumentContext,
    HistoryMessage,
    build_chat_prompt,
    build_document_context,
    build_document_timeline,
    is_over_budget,
    usable_context_budget,
)

# Distinct, explicit timestamps so the exact-equality assertions below are stable.
T1 = datetime(2026, 1, 1, 10, 0, 0)  # "2026-01-01 10:00:00 UTC"
T2 = datetime(2026, 1, 1, 11, 0, 0)
T3 = datetime(2026, 1, 1, 12, 0, 0)
T4 = datetime(2026, 1, 1, 13, 0, 0)
T5 = datetime(2026, 1, 1, 14, 0, 0)


def _doc(
    *,
    ordinal: int,
    doc_id: str,
    filename: str = "d.pdf",
    uploaded_at: datetime = T1,
    text: str | None = "body text",
    deleted_at: datetime | None = None,
    token_count: int = 0,
) -> DocumentContext:
    return DocumentContext(
        ordinal=ordinal,
        id=doc_id,
        filename=filename,
        uploaded_at=uploaded_at,
        extracted_text=text,
        deleted_at=deleted_at,
        token_count=token_count,
    )


# --------------------------------------------------------------------------- #
# build_document_context — exact output
# --------------------------------------------------------------------------- #


def test_context_exact_for_two_active_docs() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", text="LEASE TEXT"),
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", text="TITLE TEXT"),
    ]
    expected = (
        '<document n="1" id="aaa" filename="lease.pdf">\n'
        "LEASE TEXT\n"
        "</document>\n"
        '<document n="2" id="bbb" filename="title.pdf">\n'
        "TITLE TEXT\n"
        "</document>"
    )
    assert build_document_context(docs) == expected


def test_context_emitted_in_ordinal_order_exact() -> None:
    # Passed out of order; output must still be ordinal-ordered, exactly.
    docs = [
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", text="SECOND"),
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", text="FIRST"),
    ]
    expected = (
        '<document n="1" id="aaa" filename="lease.pdf">\n'
        "FIRST\n"
        "</document>\n"
        '<document n="2" id="bbb" filename="title.pdf">\n'
        "SECOND\n"
        "</document>"
    )
    assert build_document_context(docs) == expected


def test_context_duplicate_filenames_disambiguated_exact() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="report.pdf", text="ALPHA"),
        _doc(ordinal=2, doc_id="bbb", filename="report.pdf", text="BETA"),
    ]
    expected = (
        '<document n="1" id="aaa" filename="report.pdf">\n'
        "ALPHA\n"
        "</document>\n"
        '<document n="2" id="bbb" filename="report.pdf">\n'
        "BETA\n"
        "</document>"
    )
    assert build_document_context(docs) == expected


def test_context_excludes_soft_deleted_exact() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", text="ACTIVE"),
        _doc(ordinal=2, doc_id="bbb", text="REMOVED", deleted_at=T4),
    ]
    expected = '<document n="1" id="aaa" filename="d.pdf">\nACTIVE\n</document>'
    assert build_document_context(docs) == expected


def test_context_empty_and_none_text_exact() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", text=None),
        _doc(ordinal=2, doc_id="bbb", text="   "),
        _doc(ordinal=3, doc_id="ccc", text="REAL"),
    ]
    expected = (
        '<document n="1" id="aaa" filename="d.pdf">\n'
        "(no text could be extracted from this document)\n"
        "</document>\n"
        '<document n="2" id="bbb" filename="d.pdf">\n'
        "(no text could be extracted from this document)\n"
        "</document>\n"
        '<document n="3" id="ccc" filename="d.pdf">\n'
        "REAL\n"
        "</document>"
    )
    assert build_document_context(docs) == expected


def test_context_filename_attribute_escaped_exact() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", filename='a&b"<.pdf', text="X")]
    expected = '<document n="1" id="aaa" filename="a&amp;b&quot;&lt;.pdf">\nX\n</document>'
    assert build_document_context(docs) == expected


def test_context_empty_when_no_active_docs() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", text="GONE", deleted_at=T4)]
    assert build_document_context(docs) == ""


def test_context_without_text_keeps_labels_drops_bodies_exact() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", filename="lease.pdf", text="SECRET BODY")]
    expected = '<document n="1" id="aaa" filename="lease.pdf">\n\n</document>'
    assert build_document_context(docs, include_text=False) == expected


# --------------------------------------------------------------------------- #
# build_document_timeline — exact output (full timestamps)
# --------------------------------------------------------------------------- #


def test_timeline_exact_added_and_removed() -> None:
    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", uploaded_at=T1),
        _doc(
            ordinal=2,
            doc_id="bbb",
            filename="title.pdf",
            uploaded_at=T2,
            deleted_at=T4,
        ),
    ]
    expected = (
        "<document_timeline>\n"
        "- Document 1 (lease.pdf) added 2026-01-01 10:00:00 UTC (currently available)\n"
        "- Document 2 (title.pdf) added 2026-01-01 11:00:00 UTC, "
        "removed 2026-01-01 13:00:00 UTC (no longer available)\n"
        "</document_timeline>"
    )
    assert build_document_timeline(docs) == expected


def test_timeline_ordinal_order_exact() -> None:
    # Passed reversed; the timeline must still be ordinal-ordered.
    docs = [
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", uploaded_at=T2),
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", uploaded_at=T1),
    ]
    expected = (
        "<document_timeline>\n"
        "- Document 1 (lease.pdf) added 2026-01-01 10:00:00 UTC (currently available)\n"
        "- Document 2 (title.pdf) added 2026-01-01 11:00:00 UTC (currently available)\n"
        "</document_timeline>"
    )
    assert build_document_timeline(docs) == expected


def test_timeline_empty_when_no_documents() -> None:
    assert build_document_timeline([]) == ""


# --------------------------------------------------------------------------- #
# Ordinal stability across delete/add — exact context + timeline together
# --------------------------------------------------------------------------- #


def test_ordinals_stable_across_delete_and_add_exact() -> None:
    """Removing Document 2 and adding Document 4 leaves ordinals 1/3 untouched and
    never reuses ordinal 2: the removed doc drops out of the context but stays in
    the timeline, and the new doc takes ordinal 4."""
    docs = [
        _doc(ordinal=1, doc_id="d1", uploaded_at=T1, text="ONE"),
        _doc(ordinal=2, doc_id="d2", uploaded_at=T2, text="TWO", deleted_at=T4),
        _doc(ordinal=3, doc_id="d3", uploaded_at=T3, text="THREE"),
        _doc(ordinal=4, doc_id="d4", uploaded_at=T5, text="FOUR"),
    ]

    expected_context = (
        '<document n="1" id="d1" filename="d.pdf">\n'
        "ONE\n"
        "</document>\n"
        '<document n="3" id="d3" filename="d.pdf">\n'
        "THREE\n"
        "</document>\n"
        '<document n="4" id="d4" filename="d.pdf">\n'
        "FOUR\n"
        "</document>"
    )
    expected_timeline = (
        "<document_timeline>\n"
        "- Document 1 (d.pdf) added 2026-01-01 10:00:00 UTC (currently available)\n"
        "- Document 2 (d.pdf) added 2026-01-01 11:00:00 UTC, "
        "removed 2026-01-01 13:00:00 UTC (no longer available)\n"
        "- Document 3 (d.pdf) added 2026-01-01 12:00:00 UTC (currently available)\n"
        "- Document 4 (d.pdf) added 2026-01-01 14:00:00 UTC (currently available)\n"
        "</document_timeline>"
    )

    assert build_document_context(docs) == expected_context
    assert build_document_timeline(docs) == expected_timeline


# --------------------------------------------------------------------------- #
# build_chat_prompt — exact full prompt
# --------------------------------------------------------------------------- #


def test_chat_prompt_exact_with_docs_timeline_and_timestamped_history() -> None:
    docs = [_doc(ordinal=1, doc_id="aaa", filename="lease.pdf", uploaded_at=T1, text="LEASE")]
    history: list[HistoryMessage] = [
        {"role": "user", "content": "earlier question", "timestamp": T2},
        {"role": "assistant", "content": "earlier answer", "timestamp": T3},
    ]

    expected = (
        "The following documents are available in this conversation. Each is wrapped "
        "in a <document> tag labeled with its number (n), id, and filename:\n"
        "\n"
        '<document n="1" id="aaa" filename="lease.pdf">\n'
        "LEASE\n"
        "</document>\n"
        "\n"
        "Document timeline for this conversation (added/removed events):\n"
        "<document_timeline>\n"
        "- Document 1 (lease.pdf) added 2026-01-01 10:00:00 UTC (currently available)\n"
        "</document_timeline>\n"
        "\n"
        "Previous conversation (timestamped in UTC so you can correlate it with the "
        "document timeline above):\n"
        "[2026-01-01 11:00:00 UTC] User: earlier question\n"
        "[2026-01-01 12:00:00 UTC] Assistant: earlier answer\n"
        "\n"
        "User: current question"
    )
    assert build_chat_prompt("current question", docs, history) == expected


def test_chat_prompt_history_without_timestamp_renders_unprefixed_exact() -> None:
    history: list[HistoryMessage] = [{"role": "user", "content": "hello"}]
    expected = (
        "No documents are currently available in this conversation. If the user asks "
        "about a document, let them know they need to upload (or re-add) one first.\n"
        "\n"
        "Previous conversation (timestamped in UTC so you can correlate it with the "
        "document timeline above):\n"
        "User: hello\n"
        "\n"
        "User: q"
    )
    assert build_chat_prompt("q", [], history) == expected


def test_chat_prompt_no_documents_exact() -> None:
    expected = (
        "No documents are currently available in this conversation. If the user asks "
        "about a document, let them know they need to upload (or re-add) one first.\n"
        "\n"
        "User: q"
    )
    assert build_chat_prompt("q", [], []) == expected


# --------------------------------------------------------------------------- #
# Budget gate (unit)
# --------------------------------------------------------------------------- #


def test_within_budget_is_not_over(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "count_tokens", lambda text: len((text or "").split()))
    docs = [_doc(ordinal=1, doc_id="aaa", text="x", token_count=100)]
    assert is_over_budget(documents=docs, conversation_history=[], user_message="hi") is False


def test_over_budget_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "count_tokens", lambda text: len((text or "").split()))
    # A single document whose cached token_count alone blows the usable budget.
    docs = [_doc(ordinal=1, doc_id="aaa", text="x", token_count=usable_context_budget() + 1)]
    assert is_over_budget(documents=docs, conversation_history=[], user_message="hi") is True


def test_soft_deleted_tokens_do_not_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "count_tokens", lambda text: len((text or "").split()))
    # The huge document is removed → its tokens are freed → back under budget.
    docs = [
        _doc(
            ordinal=1,
            doc_id="aaa",
            token_count=usable_context_budget() + 1,
            deleted_at=T4,
        ),
        _doc(ordinal=2, doc_id="bbb", token_count=10),
    ]
    assert is_over_budget(documents=docs, conversation_history=[], user_message="hi") is False


# --------------------------------------------------------------------------- #
# Budget gate (API integration)
# --------------------------------------------------------------------------- #


async def _make_conversation(client: AsyncClient) -> str:
    response = await client.post("/api/conversations")
    assert response.status_code == 201
    return response.json()["id"]


async def _add_document(
    session: AsyncSession,
    conversation_id: str,
    *,
    token_count: int,
    filename: str = "doc.pdf",
) -> str:
    doc = Document(
        conversation_id=conversation_id,
        filename=filename,
        file_path=f"/tmp/{filename}",
        extracted_text="document text",
        page_count=1,
        token_count=token_count,
    )
    session.add(doc)
    await session.commit()
    return doc.id


async def test_over_budget_send_blocked_with_413(
    client: AsyncClient,
    db_session: AsyncSession,
    stub_llm: object,
) -> None:
    conv_id = await _make_conversation(client)
    await _add_document(db_session, conv_id, token_count=usable_context_budget() + 1)

    response = await client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"content": "Compare these documents."},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == (
        "The documents in this conversation exceed the model's context window. "
        "Remove a document to continue."
    )


async def test_within_budget_send_succeeds(
    client: AsyncClient,
    db_session: AsyncSession,
    stub_llm: object,
) -> None:
    conv_id = await _make_conversation(client)
    await _add_document(db_session, conv_id, token_count=50)

    async with client.stream(
        "POST",
        f"/api/conversations/{conv_id}/messages",
        json={"content": "What does the lease say?"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
