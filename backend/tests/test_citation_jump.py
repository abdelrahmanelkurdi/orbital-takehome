from __future__ import annotations

from takehome.services.citation_jump import resolve_citation_page

SAMPLE_TEXT = """--- Page 1 ---
Title Type: Absolute Freehold

--- Page 2 ---
Registered Owner
Victoria Park Developments Ltd (Company No. 08234571)

--- Page 7 ---
The cap is £2,000,000 for all claims."""


def test_resolve_prefers_explicit_page() -> None:
    assert resolve_citation_page(SAMPLE_TEXT, page=7, label="Page 1") == 7


def test_resolve_page_from_label() -> None:
    assert resolve_citation_page(SAMPLE_TEXT, label="Page 2, Registered Owner") == 2


def test_resolve_page_from_quote() -> None:
    page = resolve_citation_page(
        SAMPLE_TEXT,
        label="Section 4.1",
        quote="The cap is £2,000,000",
    )
    assert page == 7


def test_resolve_page_from_label_text_offset() -> None:
    page = resolve_citation_page(SAMPLE_TEXT, label="Registered Owner")
    assert page == 2


def test_resolve_returns_none_without_text_or_hints() -> None:
    assert resolve_citation_page(None, label="Unknown section") is None
