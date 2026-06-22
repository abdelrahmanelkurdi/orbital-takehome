from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from typing import Any

# PyMuPDF ships no type stubs.
import fitz  # pyright: ignore[reportMissingTypeStubs]
import structlog
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.config import settings
from takehome.db.models import Document
from takehome.services.llm import count_document_tokens_async

logger = structlog.get_logger()


async def upload_document(
    session: AsyncSession, conversation_id: str, file: UploadFile
) -> Document:
    """Upload and process a PDF document for a conversation.

    Validates the file is a PDF, saves it to disk, extracts text using PyMuPDF,
    and stores metadata in the database. A conversation may hold any number of
    documents.

    Raises ValueError if the file is not a PDF or exceeds the size limit.
    """
    # Validate file type
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        filename = file.filename or ""
        if not filename.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are supported.")

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > settings.max_upload_size:
        raise ValueError(
            f"File too large. Maximum size is {settings.max_upload_size // (1024 * 1024)}MB."
        )

    # Generate a unique filename to avoid collisions
    original_filename = file.filename or "document.pdf"
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    # Ensure upload directory exists
    os.makedirs(settings.upload_dir, exist_ok=True)

    # Save the file to disk
    with open(file_path, "wb") as f:
        f.write(content)

    logger.info("Saved uploaded PDF", filename=original_filename, path=file_path, size=len(content))

    # Extract text using PyMuPDF
    extracted_text = ""
    page_count = 0
    try:
        doc: Any = fitz.open(file_path)
        page_count = len(doc)
        pages: list[str] = []
        for page_num in range(page_count):
            page = doc[page_num]
            text: str = page.get_text()
            if text.strip():
                pages.append(f"--- Page {page_num + 1} ---\n{text}")
        extracted_text = "\n\n".join(pages)
        doc.close()
    except Exception:
        logger.exception("Failed to extract text from PDF", filename=original_filename)
        extracted_text = ""

    logger.info(
        "Extracted text from PDF",
        filename=original_filename,
        page_count=page_count,
        text_length=len(extracted_text),
    )

    # Create the document record
    token_count = await count_document_tokens_async(
        extracted_text if extracted_text else None
    )
    document = Document(
        conversation_id=conversation_id,
        filename=original_filename,
        file_path=file_path,
        extracted_text=extracted_text if extracted_text else None,
        page_count=page_count,
        token_count=token_count,
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    return document


async def get_document(session: AsyncSession, document_id: str) -> Document | None:
    """Get an active (non-soft-deleted) document by its ID.

    Used by the viewer/content endpoint; soft-deleted documents have their file
    purged from disk, so they are intentionally not returned here.
    """
    stmt = select(Document).where(
        Document.id == document_id,
        Document.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_documents_for_conversation(
    session: AsyncSession, conversation_id: str
) -> list[Document]:
    """List the active documents for a conversation, ordered by upload time."""
    stmt = (
        select(Document)
        .where(
            Document.conversation_id == conversation_id,
            Document.deleted_at.is_(None),
        )
        .order_by(Document.uploaded_at.asc(), Document.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_document_events(
    session: AsyncSession, conversation_id: str
) -> list[Document]:
    """List all documents for a conversation, including soft-deleted ones.

    Ordered by upload time (tie-broken by id) so the per-conversation ordinal is
    stable. Powers the document timeline (added/removed events) in Phase 3.
    """
    stmt = (
        select(Document)
        .where(Document.conversation_id == conversation_id)
        .order_by(Document.uploaded_at.asc(), Document.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def delete_document(session: AsyncSession, document_id: str) -> bool:
    """Soft-delete a document. Returns True if an active document was deleted.

    Sets ``deleted_at``, removes the file from disk, and clears ``extracted_text``
    so it stops counting toward the context budget, while retaining the row (with
    its metadata) for the document timeline.
    """
    document = await get_document(session, document_id)
    if document is None:
        return False

    if document.file_path and os.path.exists(document.file_path):
        try:
            os.remove(document.file_path)
        except OSError:
            logger.warning("Failed to remove document file from disk", path=document.file_path)

    document.deleted_at = datetime.now(UTC).replace(tzinfo=None)
    document.extracted_text = None
    await session.commit()
    logger.info("Soft-deleted document", document_id=document_id)
    return True
