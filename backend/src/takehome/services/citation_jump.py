"""Resolve PDF page numbers for citation chip click-to-verify."""

from __future__ import annotations

import re

_PAGE_MARKER = re.compile(r"--- Page (\d+) ---")
_LABEL_PAGE = re.compile(r"\bpage\s*(\d+)\b", re.IGNORECASE)


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _page_at_offset(extracted_text: str, offset: int) -> int:
    """Return the page marker immediately preceding *offset* in *extracted_text*."""
    page = 1
    for match in _PAGE_MARKER.finditer(extracted_text):
        if match.start() > offset:
            break
        page = int(match.group(1))
    return page


def _offset_of_normalized_needle(extracted_text: str, needle: str) -> int | None:
    """Map a match in whitespace-normalized text back to an offset in the original."""
    normalized_haystack = _normalize_whitespace(extracted_text)
    start = normalized_haystack.find(needle)
    if start < 0:
        return None

    normalized_pos = 0
    raw_offset = 0
    while raw_offset < len(extracted_text) and normalized_pos < start:
        if extracted_text[raw_offset].isspace():
            if normalized_pos == 0 or normalized_haystack[normalized_pos - 1] != " ":
                normalized_pos += 1
            while raw_offset < len(extracted_text) and extracted_text[raw_offset].isspace():
                raw_offset += 1
            continue
        normalized_pos += 1
        raw_offset += 1
    return raw_offset


def resolve_citation_page(
    extracted_text: str | None,
    *,
    page: int | None = None,
    label: str | None = None,
    quote: str | None = None,
) -> int | None:
    """Pick the best page for a citation jump.

    Priority: explicit ``page`` → ``page N`` in label → quote offset → label text offset.
    """
    if page is not None and page > 0:
        return page

    if label:
        label_match = _LABEL_PAGE.search(label)
        if label_match:
            return int(label_match.group(1))

    if not extracted_text or not extracted_text.strip():
        return None

    if quote and quote.strip():
        normalized_quote = _normalize_whitespace(quote)
        offset = _offset_of_normalized_needle(extracted_text, normalized_quote)
        if offset is not None:
            return _page_at_offset(extracted_text, offset)

    if label and label.strip():
        for fragment in label.split(","):
            fragment = fragment.strip()
            if not fragment or _LABEL_PAGE.fullmatch(fragment):
                continue
            offset = extracted_text.find(fragment)
            if offset >= 0:
                return _page_at_offset(extracted_text, offset)

    return None
