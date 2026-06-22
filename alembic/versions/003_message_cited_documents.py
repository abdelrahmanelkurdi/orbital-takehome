"""Per-document citation persistence for assistant messages

Stores which documents informed each assistant answer so the document rail
can show a per-document "cited" badge (Phase 4).

Revision ID: 003_message_cited_documents
Revises: 002_multi_document
Create Date: 2026-06-21 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_message_cited_documents"
down_revision: str | None = "002_multi_document"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_cited_documents",
        sa.Column("message_id", sa.String(), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column(
            "citation_count",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("message_id", "document_id"),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table("message_cited_documents")
