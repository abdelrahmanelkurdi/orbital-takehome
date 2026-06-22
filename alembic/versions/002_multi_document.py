"""Multi-document support — token_count, soft delete, conversation index

Adds the columns and index needed for multi-document conversations:
- ``documents.token_count``  — cached input-token count for the usage meter.
- ``documents.deleted_at``   — nullable timestamp enabling soft delete.
- index on ``documents.conversation_id`` — keeps per-conversation lookups fast
  as the (unbounded) documents table grows.

Revision ID: 002_multi_document
Revises: 001_initial
Create Date: 2026-06-21 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_multi_document"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # New columns. token_count is NOT NULL with a server default of 0, which
    # backfills every existing row to 0 as the column is added.
    op.add_column(
        "documents",
        sa.Column(
            "token_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "documents",
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )

    # Performance safeguard: every chat message and conversation load filters
    # documents by conversation_id; without this it's a sequential scan.
    op.create_index(
        "ix_documents_conversation_id",
        "documents",
        ["conversation_id"],
    )

    # Backfill a provisional token estimate for pre-existing documents (~4 chars
    # per token). This is deterministic and offline-safe for the migration; new
    # uploads compute an exact count via Anthropic's token counter (Phase 5).
    op.execute(
        """
        UPDATE documents
        SET token_count = CEIL(CHAR_LENGTH(extracted_text) / 4.0)::int
        WHERE extracted_text IS NOT NULL AND extracted_text <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_documents_conversation_id", table_name="documents")
    op.drop_column("documents", "deleted_at")
    op.drop_column("documents", "token_count")
