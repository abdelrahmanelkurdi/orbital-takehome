from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Conversation, Document, Message
from takehome.db.session import get_session
from takehome.services.conversation import (
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    update_conversation,
)
from takehome.services.document import list_document_events
from takehome.services.llm import (
    MODEL_NAME,
    ContextUsage,
    DocumentContext,
    HistoryMessage,
    compute_context_usage_async,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class DocumentInfo(BaseModel):
    id: str
    filename: str
    page_count: int
    uploaded_at: datetime
    token_count: int = 0
    has_extracted_text: bool = True

    model_config = {"from_attributes": True}


def _document_info(document: Document) -> DocumentInfo:
    return DocumentInfo(
        id=document.id,
        filename=document.filename,
        page_count=document.page_count,
        uploaded_at=document.uploaded_at,
        token_count=document.token_count,
        has_extracted_text=bool(
            document.extracted_text and document.extracted_text.strip()
        ),
    )


class ConversationListItem(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    document_count: int


class ConversationDetail(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    documents: list[DocumentInfo] = []
    document_count: int = 0


class ConversationCreate(BaseModel):
    pass


class ConversationUpdate(BaseModel):
    title: str


class ContextUsageDocumentItemOut(BaseModel):
    id: str
    filename: str
    tokens: int


class ContextUsageCategoryOut(BaseModel):
    key: str
    label: str
    tokens: int
    items: list[ContextUsageDocumentItemOut] | None = None


class ContextUsageOut(BaseModel):
    model: str
    context_window: int
    reserved_output: int
    categories: list[ContextUsageCategoryOut]
    used_tokens: int
    used_fraction: float


# --------------------------------------------------------------------------- #
# Serialization helpers
# --------------------------------------------------------------------------- #


def _active_documents(conversation: Conversation) -> list[Document]:
    """Active (non-soft-deleted) documents, ordered by upload time then id."""
    docs = [d for d in conversation.documents if d.deleted_at is None]
    docs.sort(key=lambda d: (d.uploaded_at, d.id))
    return docs


def _serialize_detail(conversation: Conversation) -> ConversationDetail:
    infos = [_document_info(d) for d in _active_documents(conversation)]
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        documents=infos,
        document_count=len(infos),
    )


def _serialize_context_usage(usage: ContextUsage) -> ContextUsageOut:
    return ContextUsageOut(
        model=usage.model,
        context_window=usage.context_window,
        reserved_output=usage.reserved_output,
        categories=[
            ContextUsageCategoryOut(
                key=category.key,
                label=category.label,
                tokens=category.tokens,
                items=(
                    [
                        ContextUsageDocumentItemOut(
                            id=item.id,
                            filename=item.filename,
                            tokens=item.tokens,
                        )
                        for item in category.items
                    ]
                    if category.items is not None
                    else None
                ),
            )
            for category in usage.categories
        ],
        used_tokens=usage.used_tokens,
        used_fraction=usage.used_fraction,
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[ConversationListItem])
async def list_conversations_endpoint(
    session: AsyncSession = Depends(get_session),
) -> list[ConversationListItem]:
    """List all conversations, ordered by most recently updated."""
    conversations = await list_conversations(session)
    items: list[ConversationListItem] = []
    for c in conversations:
        active_count = len(_active_documents(c))
        items.append(
            ConversationListItem(
                id=c.id,
                title=c.title,
                created_at=c.created_at,
                updated_at=c.updated_at,
                document_count=active_count,
            )
        )
    return items


@router.post("", response_model=ConversationDetail, status_code=201)
async def create_conversation_endpoint(
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:
    """Create a new conversation."""
    conversation = await create_conversation(session)
    # A freshly created conversation has no documents; build the payload directly
    # to avoid triggering a lazy load of the (empty) relationship.
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        documents=[],
        document_count=0,
    )


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:
    """Get a single conversation with its active documents."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _serialize_detail(conversation)


@router.get("/{conversation_id}/context-usage", response_model=ContextUsageOut)
async def get_context_usage_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> ContextUsageOut:
    """Return a per-category breakdown of context-window consumption."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    events = await list_document_events(session, conversation_id)
    documents = [
        DocumentContext(
            ordinal=index + 1,
            id=doc.id,
            filename=doc.filename,
            uploaded_at=doc.uploaded_at,
            extracted_text=doc.extracted_text,
            deleted_at=doc.deleted_at,
            token_count=doc.token_count,
        )
        for index, doc in enumerate(events)
    ]

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    history: list[HistoryMessage] = [
        {"role": m.role, "content": m.content, "timestamp": m.created_at}
        for m in result.scalars().all()
    ]

    usage = await compute_context_usage_async(
        documents=documents,
        conversation_history=history,
        user_message="",
        model=MODEL_NAME,
    )
    return _serialize_context_usage(usage)


@router.patch("/{conversation_id}", response_model=ConversationDetail)
async def update_conversation_endpoint(
    conversation_id: str,
    body: ConversationUpdate,
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:
    """Update a conversation's title."""
    conversation = await update_conversation(session, conversation_id, body.title)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _serialize_detail(conversation)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a conversation and all associated data."""
    deleted = await delete_conversation(session, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
