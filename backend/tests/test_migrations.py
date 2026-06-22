from __future__ import annotations

import asyncio

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from takehome.db.models import Base


def _alembic_config(database_url: str) -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def _schema_diff(sync_conn: Connection) -> list[object]:
    context = MigrationContext.configure(sync_conn)
    return compare_metadata(context, Base.metadata)


async def test_migrations_match_models(migration_db_url: str) -> None:
    """Upgrading the full chain to head produces a schema matching the ORM models.

    ``upgrade head`` runs every revision (001, 002, ...) in order, so this covers
    the entire migration chain rather than any single file. It's the anti-drift
    guard: rather than asserting a hardcoded list of columns/indexes (which can
    silently fall out of sync), we let Alembic diff the migrated database against
    ``Base.metadata``. If a migration changes, or a model changes without a
    matching migration, the diff is non-empty and this test fails.
    """
    cfg = _alembic_config(migration_db_url)

    # Run in a worker thread: env.py calls asyncio.run(), which cannot nest
    # inside this test's already-running event loop.
    await asyncio.to_thread(command.upgrade, cfg, "head")

    engine = create_async_engine(migration_db_url)
    try:
        async with engine.connect() as conn:
            diff = await conn.run_sync(_schema_diff)
    finally:
        await engine.dispose()

    assert diff == [], f"Schema produced by migrations drifted from models: {diff}"


async def test_migrations_upgrade_downgrade_roundtrip(migration_db_url: str) -> None:
    """The full migration chain applies and fully reverses without error.

    ``head``/``base`` traverse every revision, so this exercises the upgrade and
    downgrade of all migrations, not just the latest. Proves the operations
    succeed (including ``downgrade``) without asserting specific transformations.
    """
    cfg = _alembic_config(migration_db_url)

    await asyncio.to_thread(command.upgrade, cfg, "head")
    await asyncio.to_thread(command.downgrade, cfg, "base")
    await asyncio.to_thread(command.upgrade, cfg, "head")
