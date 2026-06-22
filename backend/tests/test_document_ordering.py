from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.models import Conversation, Document
from takehome.services.document import (
    list_document_events,
    list_documents_for_conversation,
)

# Distinct, explicit upload times. We set these by hand rather than relying on
# the uploaded_at server default: the test harness runs inside a single
# transaction, where Postgres now() is constant, so every row would otherwise
# share the same timestamp and ordering would collapse onto the id tie-break.
T1 = datetime(2026, 1, 1, 10, 0, 0)
T2 = datetime(2026, 1, 1, 11, 0, 0)
T3 = datetime(2026, 1, 1, 12, 0, 0)
T4 = datetime(2026, 1, 1, 13, 0, 0)


async def _make_conversation(session: AsyncSession) -> str:
    conversation = Conversation()
    session.add(conversation)
    await session.commit()
    return conversation.id


def _doc(
    conversation_id: str,
    *,
    doc_id: str,
    uploaded_at: datetime,
    filename: str = "d.pdf",
    deleted_at: datetime | None = None,
) -> Document:
    return Document(
        id=doc_id,
        conversation_id=conversation_id,
        filename=filename,
        file_path=f"/tmp/{doc_id}.pdf",
        extracted_text=None if deleted_at else "text",
        page_count=1,
        uploaded_at=uploaded_at,
        token_count=0,
        deleted_at=deleted_at,
    )


def _ordinals(events: list[Document]) -> dict[str, int]:
    """Map each document id to its 1-based ordinal (rank in event order)."""
    return {doc.id: index + 1 for index, doc in enumerate(events)}


async def test_events_ordered_by_uploaded_at_including_deleted(
    db_session: AsyncSession,
) -> None:
    """list_document_events returns all docs (incl. soft-deleted) in upload order."""
    conv_id = await _make_conversation(db_session)
    # Insert out of order; d2 is soft-deleted.
    db_session.add_all(
        [
            _doc(conv_id, doc_id="d3", uploaded_at=T3),
            _doc(conv_id, doc_id="d1", uploaded_at=T1),
            _doc(conv_id, doc_id="d2", uploaded_at=T2, deleted_at=T4),
        ]
    )
    await db_session.commit()

    events = await list_document_events(db_session, conv_id)
    assert [d.id for d in events] == ["d1", "d2", "d3"]
    # The soft-deleted document is still present in the event stream.
    assert any(d.id == "d2" and d.deleted_at is not None for d in events)


async def test_ordering_tie_break_by_id(db_session: AsyncSession) -> None:
    """When uploaded_at is equal, ordering falls back to id ascending."""
    conv_id = await _make_conversation(db_session)
    db_session.add_all(
        [
            _doc(conv_id, doc_id="id_b", uploaded_at=T1),
            _doc(conv_id, doc_id="id_a", uploaded_at=T1),
        ]
    )
    await db_session.commit()

    events = await list_document_events(db_session, conv_id)
    assert [d.id for d in events] == ["id_a", "id_b"]


async def test_ordinals_stable_across_delete_and_add(db_session: AsyncSession) -> None:
    """Ordinals never shift or get reused when a doc is removed and another added."""
    conv_id = await _make_conversation(db_session)
    db_session.add_all(
        [
            _doc(conv_id, doc_id="d1", uploaded_at=T1),
            _doc(conv_id, doc_id="d2", uploaded_at=T2),
            _doc(conv_id, doc_id="d3", uploaded_at=T3),
        ]
    )
    await db_session.commit()

    initial = _ordinals(await list_document_events(db_session, conv_id))
    assert initial == {"d1": 1, "d2": 2, "d3": 3}

    # Soft-delete d2: it stays in the event stream, so ordinals are unchanged.
    d2 = await db_session.get(Document, "d2")
    assert d2 is not None
    d2.deleted_at = T4
    await db_session.commit()

    after_delete = _ordinals(await list_document_events(db_session, conv_id))
    assert after_delete == {"d1": 1, "d2": 2, "d3": 3}
    # Active list excludes the removed document but keeps the rest in order.
    active = await list_documents_for_conversation(db_session, conv_id)
    assert [d.id for d in active] == ["d1", "d3"]

    # Add a new document: it takes the next ordinal; existing ones don't shift,
    # and the removed document's ordinal (2) is not reused.
    db_session.add(_doc(conv_id, doc_id="d4", uploaded_at=datetime(2026, 1, 1, 14, 0, 0)))
    await db_session.commit()

    after_add = _ordinals(await list_document_events(db_session, conv_id))
    assert after_add == {"d1": 1, "d2": 2, "d3": 3, "d4": 4}


async def test_active_documents_resolve_to_event_ordinals(
    db_session: AsyncSession,
) -> None:
    """An active document's ordinal comes from the full event stream, not from
    its position in the active list.

    With removed documents interleaved, the active-list index diverges from the
    true ordinal — this guards against the bug of citing active-list position.
    """
    conv_id = await _make_conversation(db_session)
    db_session.add_all(
        [
            _doc(conv_id, doc_id="d1", uploaded_at=T1, deleted_at=T4),  # removed
            _doc(conv_id, doc_id="d2", uploaded_at=T2),  # active
            _doc(conv_id, doc_id="d3", uploaded_at=T3, deleted_at=T4),  # removed
            _doc(conv_id, doc_id="d4", uploaded_at=datetime(2026, 1, 1, 14, 0, 0)),
        ]
    )
    await db_session.commit()

    ordinals = _ordinals(await list_document_events(db_session, conv_id))
    assert ordinals == {"d1": 1, "d2": 2, "d3": 3, "d4": 4}

    active = await list_documents_for_conversation(db_session, conv_id)
    assert [d.id for d in active] == ["d2", "d4"]

    # Correct: resolve each active doc's ordinal from the event stream.
    active_ordinals = [ordinals[d.id] for d in active]
    assert active_ordinals == [2, 4]

    # Wrong: using the active-list index (1, 2) would mislabel d4 as "Document 2".
    naive_index_ordinals = [index + 1 for index, _ in enumerate(active)]
    assert naive_index_ordinals != active_ordinals
