from __future__ import annotations

import os
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Document

# A minimal byte blob with a .pdf name. Text extraction will fail gracefully
# (stored as no text), which is fine: these tests exercise the document
# lifecycle, not PDF parsing.
PDF_BYTES = b"%PDF-1.4 fake content for tests"


@pytest.fixture
def upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect uploads to a temp dir so tests never touch the real uploads/."""
    from takehome.services import document as document_module

    path = tmp_path / "uploads"
    monkeypatch.setattr(document_module.settings, "upload_dir", str(path))
    return path


async def _create_conversation(client: AsyncClient) -> str:
    response = await client.post("/api/conversations")
    assert response.status_code == 201
    return response.json()["id"]


async def _upload(client: AsyncClient, conversation_id: str, filename: str = "doc.pdf") -> dict:
    response = await client.post(
        f"/api/conversations/{conversation_id}/documents",
        files={"file": (filename, PDF_BYTES, "application/pdf")},
    )
    return {"status": response.status_code, "body": response.json() if response.content else None}


async def test_second_upload_succeeds(client: AsyncClient, upload_dir: Path) -> None:
    """Multiple uploads are allowed — the old single-doc 409 guard is gone."""
    conv_id = await _create_conversation(client)

    first = await _upload(client, conv_id, "a.pdf")
    second = await _upload(client, conv_id, "b.pdf")

    assert first["status"] == 201
    assert second["status"] == 201
    assert first["body"]["id"] != second["body"]["id"]

    listing = await client.get(f"/api/conversations/{conv_id}/documents")
    assert listing.status_code == 200
    assert len(listing.json()) == 2


async def test_list_returns_active_documents_only(
    client: AsyncClient, upload_dir: Path
) -> None:
    """Listing excludes soft-deleted documents."""
    conv_id = await _create_conversation(client)
    first = await _upload(client, conv_id, "a.pdf")
    await _upload(client, conv_id, "b.pdf")

    delete = await client.delete(f"/api/documents/{first['body']['id']}")
    assert delete.status_code == 204

    listing = await client.get(f"/api/conversations/{conv_id}/documents")
    body = listing.json()
    assert len(body) == 1
    assert body[0]["filename"] == "b.pdf"


async def test_soft_delete_effects(
    client: AsyncClient, db_session: AsyncSession, upload_dir: Path
) -> None:
    """Soft delete sets deleted_at, removes the file, clears text, keeps the row."""
    conv_id = await _create_conversation(client)
    uploaded = await _upload(client, conv_id, "a.pdf")
    document_id = uploaded["body"]["id"]

    row = (
        await db_session.execute(select(Document).where(Document.id == document_id))
    ).scalar_one()
    file_path = row.file_path
    assert os.path.exists(file_path)

    delete = await client.delete(f"/api/documents/{document_id}")
    assert delete.status_code == 204

    await db_session.refresh(row)
    assert row.deleted_at is not None
    assert row.extracted_text is None
    assert not os.path.exists(file_path)

    # The row is retained (for the timeline), but the active-only content
    # endpoint no longer serves it.
    content = await client.get(f"/api/documents/{document_id}/content")
    assert content.status_code == 404

    # Deleting again is a no-op 404 (already soft-deleted / not active).
    again = await client.delete(f"/api/documents/{document_id}")
    assert again.status_code == 404


async def test_conversation_payload_shape(client: AsyncClient, upload_dir: Path) -> None:
    """Conversation detail exposes documents[] and document_count."""
    conv_id = await _create_conversation(client)
    await _upload(client, conv_id, "a.pdf")
    second = await _upload(client, conv_id, "b.pdf")

    detail = (await client.get(f"/api/conversations/{conv_id}")).json()
    assert detail["document_count"] == 2
    assert len(detail["documents"]) == 2

    await client.delete(f"/api/documents/{second['body']['id']}")
    detail_after = (await client.get(f"/api/conversations/{conv_id}")).json()
    assert detail_after["document_count"] == 1
    assert len(detail_after["documents"]) == 1


async def test_conversation_delete_cascades(
    client: AsyncClient, db_session: AsyncSession, upload_dir: Path
) -> None:
    """Deleting a conversation removes its documents (hard cascade)."""
    conv_id = await _create_conversation(client)
    await _upload(client, conv_id, "a.pdf")
    await _upload(client, conv_id, "b.pdf")

    delete = await client.delete(f"/api/conversations/{conv_id}")
    assert delete.status_code == 204

    remaining = (
        await db_session.execute(
            select(Document).where(Document.conversation_id == conv_id)
        )
    ).scalars().all()
    assert remaining == []
