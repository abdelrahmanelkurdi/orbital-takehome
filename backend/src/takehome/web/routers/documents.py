from __future__ import annotations

import os
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from takehome.db.models import Document
from takehome.db.session import get_session
from takehome.services.conversation import get_conversation
from takehome.services.citation_jump import resolve_citation_page
from takehome.services.document import (
    delete_document,
    get_document,
    list_documents_for_conversation,
    upload_document,
)

logger = structlog.get_logger()

router = APIRouter(tags=["documents"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class DocumentOut(BaseModel):
    id: str
    conversation_id: str
    filename: str
    page_count: int
    uploaded_at: datetime
    token_count: int
    has_extracted_text: bool

    model_config = {"from_attributes": True}


class CitationPageOut(BaseModel):
    page: int | None


def _document_out(document: Document) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        conversation_id=document.conversation_id,
        filename=document.filename,
        page_count=document.page_count,
        uploaded_at=document.uploaded_at,
        token_count=document.token_count,
        has_extracted_text=bool(
            document.extracted_text and document.extracted_text.strip()
        ),
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.post(
    "/api/conversations/{conversation_id}/documents",
    response_model=DocumentOut,
    status_code=201,
)
async def upload_document_endpoint(
    conversation_id: str,
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    """Upload a PDF document for a conversation.

    A conversation may hold any number of documents; repeated uploads are
    allowed and never replace existing documents.
    """
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        document = await upload_document(session, conversation_id, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    logger.info(
        "Document uploaded",
        conversation_id=conversation_id,
        document_id=document.id,
        filename=document.filename,
    )

    return _document_out(document)


@router.get(
    "/api/conversations/{conversation_id}/documents",
    response_model=list[DocumentOut],
)
async def list_documents_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    """List the active documents for a conversation, ordered by upload time."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    documents = await list_documents_for_conversation(session, conversation_id)
    return [_document_out(doc) for doc in documents]


@router.delete("/api/documents/{document_id}", status_code=204)
async def delete_document_endpoint(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Soft-delete a document (purges the file, retains metadata for the timeline)."""
    deleted = await delete_document(session, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")


@router.get("/api/documents/{document_id}/content")
async def serve_document_file(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    """Serve the raw PDF file for download/viewing."""
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=document.file_path,
        filename=document.filename,
        media_type="application/pdf",
    )


@router.get("/api/documents/{document_id}/citation-page", response_model=CitationPageOut)
async def resolve_citation_page_endpoint(
    document_id: str,
    page: int | None = None,
    label: str | None = None,
    quote: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> CitationPageOut:
    """Resolve a citation label or quote to a PDF page for viewer jump."""
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    resolved = resolve_citation_page(
        document.extracted_text,
        page=page,
        label=label,
        quote=quote,
    )
    return CitationPageOut(page=resolved)
