from __future__ import annotations

from datetime import datetime

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
