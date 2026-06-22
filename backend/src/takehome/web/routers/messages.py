from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.responses import StreamingResponse

from takehome.db.models import Message, MessageCitedDocument
from takehome.db.session import get_session
from takehome.services.conversation import get_conversation, update_conversation
from takehome.services.document import list_document_events
from takehome.services.llm import (
    DocumentContext,
    HistoryMessage,
    analyze_document_citations,
    chat_with_documents,
    generate_title,
    is_over_budget_async,
)

logger = structlog.get_logger()

router = APIRouter(tags=["messages"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class CitedDocumentOut(BaseModel):
    document_id: str
    citation_count: int


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    sources_cited: int
    cited_documents: list[CitedDocumentOut] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str


def _message_to_out(message: Message) -> MessageOut:
    cited = [
        CitedDocumentOut(
            document_id=row.document_id,
            citation_count=row.citation_count,
        )
        for row in sorted(message.cited_documents, key=lambda r: r.document_id)
    ]
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        sources_cited=message.sources_cited,
        cited_documents=cited,
        created_at=message.created_at,
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get(
    "/api/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    """List all messages in a conversation, ordered by creation time."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .options(selectinload(Message.cited_documents))
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    messages = list(result.scalars().all())

    return [_message_to_out(m) for m in messages]


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Send a user message and stream back the AI response via SSE."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Load all documents (incl. soft-deleted) and assign each its stable ordinal
    # (rank by uploaded_at over all docs, tie-broken by id — already the event
    # order). Active docs contribute text; removed ones feed the timeline only.
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

    # Load existing conversation history (before persisting the new user turn).
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    history_messages = list(result.scalars().all())

    conversation_history: list[HistoryMessage] = [
        {"role": m.role, "content": m.content, "timestamp": m.created_at}
        for m in history_messages
    ]

    # Over-budget = block the send (§0.2). We never truncate a legal document; if
    # the assembled prompt won't fit, reject before saving the message so the user
    # can remove a document and retry.
    if await is_over_budget_async(
        documents=documents,
        conversation_history=conversation_history,
        user_message=body.content,
    ):
        raise HTTPException(
            status_code=413,
            detail=(
                "The documents in this conversation exceed the model's context "
                "window. Remove a document to continue."
            ),
        )

    # Save the user message
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    session.add(user_message)
    await session.commit()
    await session.refresh(user_message)

    logger.info("User message saved", conversation_id=conversation_id, message_id=user_message.id)

    # Determine if this is the first user message (for title generation)
    user_msg_count = sum(1 for m in history_messages if m.role == "user")
    is_first_message = user_msg_count == 0

    async def event_stream() -> AsyncIterator[str]:
        """Generate SSE events with the streamed LLM response."""
        full_response = ""

        try:
            async for chunk in chat_with_documents(
                user_message=body.content,
                documents=documents,
                conversation_history=conversation_history,
            ):
                full_response += chunk
                event_data = json.dumps({"type": "content", "content": chunk})
                yield f"data: {event_data}\n\n"

        except Exception:
            logger.exception(
                "Error during LLM streaming",
                conversation_id=conversation_id,
            )
            error_msg = "I'm sorry, an error occurred while generating a response. Please try again."
            full_response = error_msg
            event_data = json.dumps({"type": "content", "content": error_msg})
            yield f"data: {event_data}\n\n"

        # Attribute citations per document (ordinal → id) and persist them.
        citation_analysis = analyze_document_citations(full_response, documents)
        sources = citation_analysis.total

        # Save the assistant message to the database.
        # We need a fresh session since the outer one may have been closed.
        from takehome.db.session import async_session as session_factory

        async with session_factory() as save_session:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_response,
                sources_cited=sources,
            )
            save_session.add(assistant_message)
            await save_session.flush()

            for citation in citation_analysis.citations:
                save_session.add(
                    MessageCitedDocument(
                        message_id=assistant_message.id,
                        document_id=citation.document_id,
                        citation_count=citation.count,
                    )
                )

            await save_session.commit()
            await save_session.refresh(assistant_message)

            # Auto-generate title from first user message
            if is_first_message:
                try:
                    title = await generate_title(body.content)
                    await update_conversation(save_session, conversation_id, title)
                    logger.info(
                        "Auto-generated conversation title",
                        conversation_id=conversation_id,
                        title=title,
                    )
                except Exception:
                    logger.exception(
                        "Failed to generate title",
                        conversation_id=conversation_id,
                    )

            # Send the final message event with the complete assistant message
            message_data = json.dumps(
                {
                    "type": "message",
                    "message": {
                        "id": assistant_message.id,
                        "conversation_id": assistant_message.conversation_id,
                        "role": assistant_message.role,
                        "content": assistant_message.content,
                        "sources_cited": assistant_message.sources_cited,
                        "cited_documents": [
                            {
                                "document_id": c.document_id,
                                "citation_count": c.count,
                            }
                            for c in citation_analysis.citations
                        ],
                        "created_at": assistant_message.created_at.isoformat(),
                    },
                }
            )
            yield f"data: {message_data}\n\n"

            # Send the done signal
            done_data = json.dumps(
                {
                    "type": "done",
                    "sources_cited": sources,
                    "cited_document_ids": citation_analysis.cited_document_ids,
                    "message_id": assistant_message.id,
                }
            )
            yield f"data: {done_data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
