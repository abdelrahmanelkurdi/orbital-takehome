from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import NotRequired, TypedDict

import structlog
from pydantic_ai import Agent

from takehome.config import settings

# Importing settings triggers the ANTHROPIC_API_KEY export the Anthropic client
# relies on; bind it so linters/type-checkers treat the import as used.
_ = settings

logger = structlog.get_logger()

# --------------------------------------------------------------------------- #
# Model / context-window configuration
#
# There is no Anthropic API that reliably returns a model's context window, so we
# keep a small local map (the single source of truth) alongside the agent. The
# reserved-output budget is held back for the model's response so that
# ``used + reserved <= window`` (see design §2.4 / §0.6).
# --------------------------------------------------------------------------- #

MODEL_NAME = "claude-haiku-4-5-20251001"
MODEL_CONTEXT_WINDOWS: dict[str, int] = {"claude-haiku-4-5-20251001": 200_000}
DEFAULT_CONTEXT_WINDOW = 200_000
RESERVED_OUTPUT_TOKENS = 8_000


SYSTEM_PROMPT = (
    "You are a helpful legal document assistant for commercial real estate lawyers. "
    "You help lawyers review and understand documents during due diligence.\n\n"
    "The conversation may contain MULTIPLE documents. Each document is wrapped in a "
    '<document> tag carrying three identifiers: a number (n), a stable id (UUID), and '
    "a filename, e.g. "
    '<document n="1" id="a1b2c3" filename="lease.pdf">.\n\n'
    "IMPORTANT INSTRUCTIONS:\n"
    "- Answer questions based only on the document content provided. You may draw on "
    "and compare across any or all of the documents.\n"
    "- Refer to documents by their number and filename, e.g. 'Document 1 (lease.pdf)'. "
    "When two documents share a filename, the number disambiguates them.\n"
    "- When referencing specific content, cite the document number alongside the "
    "relevant section, clause, or page, e.g. 'Document 2, Section 4.1'.\n"
    "- If the answer is not in the documents, say so clearly. Do not fabricate "
    "information.\n"
    "- A <document_timeline> may list documents that were added and later removed. "
    "Both the timeline and the previous conversation are timestamped (UTC), so you "
    "can tell whether an earlier answer was given while a document was still "
    "available. If you (or the prior conversation) referenced a document that is now "
    "removed, say so and invite the user to re-add it instead of guessing — only "
    "currently available documents include their full text.\n"
    "- Be concise and precise. Lawyers value accuracy over verbosity."
)


agent = Agent("anthropic:" + MODEL_NAME, system_prompt=SYSTEM_PROMPT)


# --------------------------------------------------------------------------- #
# Multi-document context assembly (Strategy A1)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DocumentContext:
    """A single document's view for prompt assembly.

    Carries the stable per-conversation ``ordinal`` (rank by ``uploaded_at`` over
    *all* documents incl. soft-deleted, tie-broken by ``id``) together with the
    identity (``id``, ``filename``) and lifecycle (``uploaded_at``,
    ``deleted_at``). Only active documents (``deleted_at is None``) contribute
    their ``extracted_text``; removed ones still appear in the timeline.
    """

    ordinal: int
    id: str
    filename: str
    uploaded_at: datetime
    extracted_text: str | None = None
    deleted_at: datetime | None = None
    token_count: int = 0

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None

    @property
    def has_text(self) -> bool:
        return bool(self.extracted_text and self.extracted_text.strip())


class HistoryMessage(TypedDict):
    """A prior conversation turn passed into prompt assembly.

    ``timestamp`` (the message's ``created_at``, naive UTC) lets the model line the
    conversation up against the document timeline — e.g. recognize that an answer
    was given while a since-removed document was still available.
    """

    role: str
    content: str
    timestamp: NotRequired[datetime | None]


def _attr(value: str) -> str:
    """Escape a value so it is safe inside a double-quoted XML-ish attribute."""
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def _format_timestamp(value: datetime) -> str:
    """Render a naive-UTC timestamp consistently for the timeline and history.

    Full date+time (not just date) so events within a single session — uploads,
    removals, and messages that all land on the same day — remain orderable.
    """
    return value.strftime("%Y-%m-%d %H:%M:%S UTC")


def build_document_context(documents: list[DocumentContext], *, include_text: bool = True) -> str:
    """Concatenate every active document, each labeled with ordinal + id + filename.

    This is the seam for the context strategy (A1 today; A3/A2 can swap in later).
    Documents are emitted in ordinal order. Active documents without extracted
    text are still labeled (so the model knows they exist) but contribute no body.

    ``include_text=False`` renders the wrappers/labels without document bodies; it
    is used for token estimation so large document text isn't re-tokenized on
    every request (cached per-document ``token_count`` is added separately).
    """
    active = sorted(
        (d for d in documents if d.is_active),
        key=lambda d: d.ordinal,
    )
    if not active:
        return ""

    blocks: list[str] = []
    for doc in active:
        opening = f'<document n="{doc.ordinal}" id="{_attr(doc.id)}" filename="{_attr(doc.filename)}">'
        if not doc.has_text:
            body = "(no text could be extracted from this document)"
        elif include_text:
            body = doc.extracted_text or ""
        else:
            body = ""
        blocks.append(f"{opening}\n{body}\n</document>")
    return "\n".join(blocks)


def build_document_timeline(documents: list[DocumentContext]) -> str:
    """Render the add/remove timeline (always full, never summarized — §2.5).

    Lists *all* documents, including soft-deleted ones, by their stable ordinal so
    the model can reconcile a cited-then-removed document.
    """
    events = sorted(documents, key=lambda d: d.ordinal)
    if not events:
        return ""

    lines = ["<document_timeline>"]
    for doc in events:
        added = _format_timestamp(doc.uploaded_at)
        if doc.deleted_at is not None:
            removed = _format_timestamp(doc.deleted_at)
            status = f"added {added}, removed {removed} (no longer available)"
        else:
            status = f"added {added} (currently available)"
        lines.append(f"- Document {doc.ordinal} ({doc.filename}) {status}")
    lines.append("</document_timeline>")
    return "\n".join(lines)


def build_history_block(conversation_history: list[HistoryMessage]) -> str:
    """Format prior turns for the prompt (and the history category of the meter)."""
    if not conversation_history:
        return ""

    parts = [
        "Previous conversation (timestamped in UTC so you can correlate it with "
        "the document timeline above):"
    ]
    for msg in conversation_history:
        role = msg["role"]
        if role == "user":
            speaker = "User"
        elif role == "assistant":
            speaker = "Assistant"
        else:
            continue
        timestamp = msg.get("timestamp")
        prefix = f"[{_format_timestamp(timestamp)}] " if timestamp is not None else ""
        parts.append(f"{prefix}{speaker}: {msg['content']}")
    parts.append("")
    return "\n".join(parts)


def _build_document_intro(
    documents: list[DocumentContext], *, include_text: bool
) -> str:
    context = build_document_context(documents, include_text=include_text)
    if context:
        return (
            "The following documents are available in this conversation. Each is "
            "wrapped in a <document> tag labeled with its number (n), id, and "
            "filename:\n\n" + context + "\n"
        )
    return (
        "No documents are currently available in this conversation. If the user "
        "asks about a document, let them know they need to upload (or re-add) one "
        "first.\n"
    )


def build_formatting_overhead_block(
    documents: list[DocumentContext],
    *,
    user_message: str = "",
    include_document_text: bool = False,
) -> str:
    """Document instructions, tag wrappers, timeline, and current user turn — not history or bodies."""
    parts: list[str] = [_build_document_intro(documents, include_text=include_document_text)]

    timeline = build_document_timeline(documents)
    if timeline:
        parts.append(
            "Document timeline for this conversation (added/removed events):\n"
            + timeline
            + "\n"
        )

    parts.append(f"User: {user_message}")
    return "\n".join(parts)


def build_chat_prompt(
    user_message: str,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
    *,
    include_document_text: bool = True,
) -> str:
    """Assemble the full user-turn prompt: documents + timeline + history + turn.

    The system prompt is set on the agent and is not included here.
    """
    parts: list[str] = [
        _build_document_intro(documents, include_text=include_document_text)
    ]

    timeline = build_document_timeline(documents)
    if timeline:
        parts.append(
            "Document timeline for this conversation (added/removed events):\n"
            + timeline
            + "\n"
        )

    history = build_history_block(conversation_history)
    if history:
        parts.append(history)

    parts.append(f"User: {user_message}")
    return "\n".join(parts)


async def chat_with_documents(
    user_message: str,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
) -> AsyncIterator[str]:
    """Stream a response grounded in all active documents of a conversation.

    Builds a multi-document prompt (full concatenation with per-document labeling,
    Strategy A1) and streams the model's reply as text chunks.
    """
    full_prompt = build_chat_prompt(user_message, documents, conversation_history)
    async with agent.run_stream(full_prompt) as result:
        async for text in result.stream_text(delta=True):
            yield text


# --------------------------------------------------------------------------- #
# Token counting & budget gate (over-budget blocks the send — §0.2 / §3.1)
# --------------------------------------------------------------------------- #


def context_window_for(model: str = MODEL_NAME) -> int:
    return MODEL_CONTEXT_WINDOWS.get(model, DEFAULT_CONTEXT_WINDOW)


def usable_context_budget(model: str = MODEL_NAME) -> int:
    """Tokens available for input = context window minus the reserved output."""
    return context_window_for(model) - RESERVED_OUTPUT_TOKENS


def _approx_token_count(text: str) -> int:
    """Cheap, offline fallback (~4 chars/token) if the counting API is unavailable."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def count_tokens(text: str) -> int:
    """Count input tokens for ``text`` via Anthropic's token-counting endpoint.

    Uses ``messages.count_tokens`` which returns ``input_tokens`` without spending
    generation tokens. Falls back to a heuristic if the call fails so a counting
    hiccup never breaks the request path.
    """
    if not text:
        return 0
    try:
        from anthropic import Anthropic

        client = Anthropic()
        result = client.messages.count_tokens(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": text}],
        )
        return int(result.input_tokens)
    except Exception:
        logger.warning("count_tokens failed; using heuristic fallback")
        return _approx_token_count(text)


def count_document_tokens(extracted_text: str | None) -> int:
    """Count input tokens for a document body (stored once at upload)."""
    if not extracted_text or not extracted_text.strip():
        return 0
    return count_tokens(extracted_text)


async def count_document_tokens_async(extracted_text: str | None) -> int:
    """Non-blocking wrapper for :func:`count_document_tokens`."""
    if not extracted_text or not extracted_text.strip():
        return 0
    return await asyncio.to_thread(count_document_tokens, extracted_text)


# --------------------------------------------------------------------------- #
# Context-usage meter (Phase 5)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ContextUsageDocumentItem:
    id: str
    filename: str
    tokens: int


@dataclass(frozen=True)
class ContextUsageCategory:
    key: str
    label: str
    tokens: int
    items: tuple[ContextUsageDocumentItem, ...] | None = None


@dataclass(frozen=True)
class ContextUsage:
    model: str
    context_window: int
    reserved_output: int
    categories: tuple[ContextUsageCategory, ...]
    used_tokens: int
    used_fraction: float


def _build_context_usage(
    *,
    system_tokens: int,
    history_tokens: int,
    overhead_tokens: int,
    documents: list[DocumentContext],
    model: str,
) -> ContextUsage:
    active = sorted((d for d in documents if d.is_active), key=lambda d: d.ordinal)
    doc_items = tuple(
        ContextUsageDocumentItem(id=d.id, filename=d.filename, tokens=d.token_count)
        for d in active
    )
    documents_tokens = sum(item.tokens for item in doc_items)

    used_tokens = system_tokens + history_tokens + documents_tokens + overhead_tokens
    context_window = context_window_for(model)
    used_fraction = used_tokens / context_window if context_window else 0.0

    categories = (
        ContextUsageCategory(key="system", label="System prompt", tokens=system_tokens),
        ContextUsageCategory(
            key="history", label="Conversation history", tokens=history_tokens
        ),
        ContextUsageCategory(
            key="overhead",
            label="Document context framing",
            tokens=overhead_tokens,
        ),
        ContextUsageCategory(
            key="documents",
            label="Documents",
            tokens=documents_tokens,
            items=doc_items,
        ),
    )
    return ContextUsage(
        model=model,
        context_window=context_window,
        reserved_output=RESERVED_OUTPUT_TOKENS,
        categories=categories,
        used_tokens=used_tokens,
        used_fraction=used_fraction,
    )


def compute_context_usage(
    *,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
    user_message: str = "",
    model: str = MODEL_NAME,
) -> ContextUsage:
    """Break down how much of the model context window a conversation consumes.

    Per-segment counts are approximately additive (see design §2.4). Document
    bodies use cached ``token_count``; everything else is counted on demand.
    ``used_fraction`` is ``used_tokens / context_window`` (reserved output is
    reported separately for the UI gate in Phase 9).

    Sync helper for tests and scripts. Async handlers should call
    :func:`compute_context_usage_async` instead.
    """
    history_block = build_history_block(conversation_history)
    overhead_block = build_formatting_overhead_block(
        documents,
        user_message=user_message,
        include_document_text=False,
    )
    return _build_context_usage(
        system_tokens=count_tokens(SYSTEM_PROMPT),
        history_tokens=count_tokens(history_block),
        overhead_tokens=count_tokens(overhead_block),
        documents=documents,
        model=model,
    )


async def compute_context_usage_async(
    *,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
    user_message: str = "",
    model: str = MODEL_NAME,
) -> ContextUsage:
    """Like :func:`compute_context_usage`, but offloads token counting from the event loop."""
    history_block = build_history_block(conversation_history)
    overhead_block = build_formatting_overhead_block(
        documents,
        user_message=user_message,
        include_document_text=False,
    )
    system_tokens, history_tokens, overhead_tokens = await asyncio.gather(
        asyncio.to_thread(count_tokens, SYSTEM_PROMPT),
        asyncio.to_thread(count_tokens, history_block),
        asyncio.to_thread(count_tokens, overhead_block),
    )
    return _build_context_usage(
        system_tokens=system_tokens,
        history_tokens=history_tokens,
        overhead_tokens=overhead_tokens,
        documents=documents,
        model=model,
    )


def is_over_budget(
    *,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
    user_message: str,
    model: str = MODEL_NAME,
) -> bool:
    """Sync budget gate for unit tests. Handlers use :func:`is_over_budget_async`."""
    usage = compute_context_usage(
        documents=documents,
        conversation_history=conversation_history,
        user_message=user_message,
        model=model,
    )
    return usage.used_tokens > usable_context_budget(model)


async def is_over_budget_async(
    *,
    documents: list[DocumentContext],
    conversation_history: list[HistoryMessage],
    user_message: str,
    model: str = MODEL_NAME,
) -> bool:
    """Non-blocking budget gate for async request handlers."""
    usage = await compute_context_usage_async(
        documents=documents,
        conversation_history=conversation_history,
        user_message=user_message,
        model=model,
    )
    return usage.used_tokens > usable_context_budget(model)


# --------------------------------------------------------------------------- #
# Per-document citation attribution (Phase 4)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DocumentCitation:
    """A single document's citation tally from an assistant response."""

    document_id: str
    ordinal: int
    count: int


@dataclass(frozen=True)
class CitationAnalysis:
    """Parsed citation attribution for an assistant response."""

    citations: tuple[DocumentCitation, ...]

    @property
    def total(self) -> int:
        return sum(c.count for c in self.citations)

    @property
    def cited_document_ids(self) -> list[str]:
        return [c.document_id for c in self.citations]


# Matches "Document 2", "Document 2 (lease.pdf)", "Document 2, Section 4.1", etc.
_DOCUMENT_ORDINAL_RE = re.compile(r"document\s+(\d+)\b", re.IGNORECASE)


def analyze_document_citations(
    response: str,
    documents: list[DocumentContext],
) -> CitationAnalysis:
    """Attribute citations in *response* to documents by stable ordinal → id.

    The model is instructed to cite by ordinal (e.g. "Document 2, Section 4.1").
    Each ``Document N`` mention counts once toward document *N*. Unknown ordinals
    are ignored. Soft-deleted documents remain in *documents* so ordinals still
    resolve correctly.
    """
    ordinal_to_id = {doc.ordinal: doc.id for doc in documents}
    if not ordinal_to_id or not response:
        return CitationAnalysis(citations=())

    counts: dict[int, int] = {}

    for match in _DOCUMENT_ORDINAL_RE.finditer(response):
        ordinal = int(match.group(1))
        if ordinal in ordinal_to_id:
            counts[ordinal] = counts.get(ordinal, 0) + 1

    citations = tuple(
        DocumentCitation(
            document_id=ordinal_to_id[ordinal],
            ordinal=ordinal,
            count=counts[ordinal],
        )
        for ordinal in sorted(counts)
    )
    return CitationAnalysis(citations=citations)


async def generate_title(user_message: str) -> str:
    """Generate a 3-5 word conversation title from the first user message."""
    result = await agent.run(
        f"Generate a concise 3-5 word title for a conversation that starts with: '{user_message}'. "
        "Return only the title, nothing else."
    )
    title = str(result.output).strip().strip('"').strip("'")
    # Truncate if too long
    if len(title) > 100:
        title = title[:97] + "..."
    return title
