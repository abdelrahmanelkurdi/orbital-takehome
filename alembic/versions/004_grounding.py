"""Grounding judge payload on assistant messages

Stores per-block grounding metadata from the judge agent: status, summary,
and verified citation blocks (Phase 1 grounded citations).

Revision ID: 004_grounding
Revises: 003_message_cited_documents
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_grounding"
down_revision: str | None = "003_message_cited_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("grounding_status", sa.String(), nullable=True))
    op.add_column("messages", sa.Column("grounding_summary", sa.Text(), nullable=True))
    op.add_column("messages", sa.Column("grounding_payload", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "grounding_payload")
    op.drop_column("messages", "grounding_summary")
    op.drop_column("messages", "grounding_status")
