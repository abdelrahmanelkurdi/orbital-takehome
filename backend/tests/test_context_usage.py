from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Document, Message
from takehome.services.llm import (
    DEFAULT_CONTEXT_WINDOW,
    RESERVED_OUTPUT_TOKENS,
    DocumentContext,
    HistoryMessage,
    compute_context_usage,
    compute_context_usage_async,
    count_document_tokens,
)

T1 = datetime(2026, 1, 1, 10, 0, 0)


def _doc(
    *,
    ordinal: int,
    doc_id: str,
    filename: str = "d.pdf",
    token_count: int = 0,
    deleted_at: datetime | None = None,
) -> DocumentContext:
    return DocumentContext(
        ordinal=ordinal,
        id=doc_id,
        filename=filename,
        uploaded_at=T1,
        extracted_text="body",
        deleted_at=deleted_at,
        token_count=token_count,
    )


def test_category_tokens_sum_to_used_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_count(text: str) -> int:
        return len(text)

    monkeypatch.setattr("takehome.services.llm.count_tokens", fake_count)

    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", token_count=1000),
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", token_count=500),
    ]
    history: list[HistoryMessage] = [
        {"role": "user", "content": "Question?", "timestamp": T1},
        {"role": "assistant", "content": "Answer.", "timestamp": T1},
    ]

    usage = compute_context_usage(documents=docs, conversation_history=history)

    category_sum = sum(c.tokens for c in usage.categories)
    assert category_sum == usage.used_tokens


def test_documents_category_includes_per_item_breakdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("takehome.services.llm.count_tokens", lambda text: 0)

    docs = [
        _doc(ordinal=1, doc_id="aaa", filename="lease.pdf", token_count=1000),
        _doc(ordinal=2, doc_id="bbb", filename="title.pdf", token_count=500),
        _doc(ordinal=3, doc_id="ccc", filename="gone.pdf", token_count=999, deleted_at=T1),
    ]
    usage = compute_context_usage(documents=docs, conversation_history=[])

    documents_category = next(c for c in usage.categories if c.key == "documents")
    assert documents_category.tokens == 1500
    assert documents_category.items is not None
    assert len(documents_category.items) == 2
    assert {item.id: item.tokens for item in documents_category.items} == {
        "aaa": 1000,
        "bbb": 500,
    }


def test_used_fraction_against_context_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("takehome.services.llm.count_tokens", lambda text: 0)

    docs = [_doc(ordinal=1, doc_id="aaa", token_count=40_000)]
    usage = compute_context_usage(documents=docs, conversation_history=[])

    assert usage.context_window == DEFAULT_CONTEXT_WINDOW
    assert usage.reserved_output == RESERVED_OUTPUT_TOKENS
    assert usage.used_tokens == 40_000
    assert usage.used_fraction == pytest.approx(40_000 / DEFAULT_CONTEXT_WINDOW)


def test_count_document_tokens_empty() -> None:
    assert count_document_tokens(None) == 0
    assert count_document_tokens("") == 0
    assert count_document_tokens("   ") == 0


@pytest.mark.asyncio
async def test_compute_context_usage_async_offloads_token_counting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    thread_calls = 0

    def fake_count(text: str) -> int:
        return len(text)

    async def track_to_thread(func, /, *args, **kwargs):
        nonlocal thread_calls
        thread_calls += 1
        return func(*args, **kwargs)

    monkeypatch.setattr("takehome.services.llm.count_tokens", fake_count)
    monkeypatch.setattr(asyncio, "to_thread", track_to_thread)

    usage = await compute_context_usage_async(documents=[], conversation_history=[])

    assert thread_calls == 3
    assert usage.used_tokens == sum(c.tokens for c in usage.categories)


PDF_BYTES = b"%PDF-1.4 fake content for tests"


@pytest.fixture
def upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from takehome.services import document as document_module

    path = tmp_path / "uploads"
    monkeypatch.setattr(document_module.settings, "upload_dir", str(path))
    return path


async def test_upload_stores_token_count(
    client: AsyncClient,
    db_session: AsyncSession,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_count(_text: str | None) -> int:
        return 42

    monkeypatch.setattr(
        "takehome.services.document.count_document_tokens_async",
        fake_count,
    )

    conv_id = (await client.post("/api/conversations")).json()["id"]
    uploaded = await client.post(
        f"/api/conversations/{conv_id}/documents",
        files={"file": ("a.pdf", PDF_BYTES, "application/pdf")},
    )
    assert uploaded.status_code == 201

    row = (
        await db_session.execute(select(Document).where(Document.id == uploaded.json()["id"]))
    ).scalar_one()
    assert row.token_count == 42


async def test_context_usage_endpoint(
    client: AsyncClient,
    db_session: AsyncSession,
    upload_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("takehome.services.llm.count_tokens", lambda text: len(text))

    conv_id = (await client.post("/api/conversations")).json()["id"]

    doc = Document(
        conversation_id=conv_id,
        filename="lease.pdf",
        file_path="/tmp/x.pdf",
        extracted_text="lease body",
        page_count=1,
        token_count=500,
    )
    db_session.add(doc)
    db_session.add(
        Message(
            conversation_id=conv_id,
            role="user",
            content="What is the term?",
        )
    )
    await db_session.flush()

    response = await client.get(f"/api/conversations/{conv_id}/context-usage")
    assert response.status_code == 200
    body = response.json()

    assert body["context_window"] == DEFAULT_CONTEXT_WINDOW
    assert body["reserved_output"] == RESERVED_OUTPUT_TOKENS
    assert body["used_tokens"] == sum(c["tokens"] for c in body["categories"])
    assert body["used_fraction"] == pytest.approx(body["used_tokens"] / body["context_window"])

    keys = [c["key"] for c in body["categories"]]
    assert keys == ["system", "history", "overhead", "documents"]

    documents = next(c for c in body["categories"] if c["key"] == "documents")
    assert documents["tokens"] == 500
    assert len(documents["items"]) == 1
    assert documents["items"][0]["filename"] == "lease.pdf"


async def test_context_usage_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/conversations/nonexistent/context-usage")
    assert response.status_code == 404
