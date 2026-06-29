from __future__ import annotations

import os
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from takehome.db.models import Base
from takehome.db.session import get_session
from takehome.web.app import app

# Ensures the dedicated test database is created at most once per session.
_test_db_ready = False


def _service_url() -> URL:
    """The URL of the live application database (the running system)."""
    return make_url(
        os.environ.get(
            "DATABASE_URL",
            "postgresql+asyncpg://orbital:orbital@db:5432/orbital_takehome",
        )
    )


def _test_url() -> URL:
    """A dedicated test database, isolated from the running app's database.

    We never run tests against the live ``orbital_takehome`` database; instead we
    use a sibling ``..._test`` database so test runs can't touch real data, DDL,
    or the app's connection pool.
    """
    base = _service_url()
    name = base.database or "orbital_takehome"
    return base.set(database=f"{name}_test")


async def _ensure_test_database() -> None:
    """Create the test database if it doesn't exist yet (idempotent).

    ``CREATE DATABASE`` can't run inside a transaction, so we connect to the
    ``postgres`` maintenance database in AUTOCOMMIT mode to provision it.
    """
    test_url = _test_url()
    admin_engine = create_async_engine(
        test_url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    try:
        async with admin_engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": test_url.database},
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{test_url.database}"'))
    finally:
        await admin_engine.dispose()


async def _reset_schema() -> None:
    """Drop and recreate all tables so the schema matches the current models.

    ``create_all`` alone won't add new columns to a table that already exists, so
    a test database lingering from an earlier run could have a stale schema. We
    drop first to guarantee the schema reflects ``Base.metadata`` exactly.
    """
    schema_engine = create_async_engine(_test_url())
    try:
        async with schema_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await schema_engine.dispose()


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    """A disposable async engine bound to the dedicated test database.

    The test database is provisioned and its schema rebuilt once per session, so
    tests don't depend on the app having run its Alembic migrations and never see
    a stale schema from a previous run.
    """
    global _test_db_ready
    if not _test_db_ready:
        await _ensure_test_database()
        await _reset_schema()
        _test_db_ready = True

    test_engine = create_async_engine(_test_url(), echo=False)
    try:
        yield test_engine
    finally:
        await test_engine.dispose()


@pytest_asyncio.fixture
async def migration_db_url() -> AsyncIterator[str]:
    """A fresh, throwaway database for exercising Alembic migrations end to end.

    Kept separate from the ``create_all``-based test database so the migration
    test starts from an empty database and never collides with other tests.
    """
    base = _service_url()
    name = f"{base.database or 'orbital_takehome'}_migrations"
    target = base.set(database=name)

    async def _drop_and_create(create: bool) -> None:
        admin_engine = create_async_engine(
            target.set(database="postgres"), isolation_level="AUTOCOMMIT"
        )
        try:
            async with admin_engine.connect() as conn:
                await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
                if create:
                    await conn.execute(text(f'CREATE DATABASE "{name}"'))
        finally:
            await admin_engine.dispose()

    await _drop_and_create(create=True)
    try:
        yield target.render_as_string(hide_password=False)
    finally:
        await _drop_and_create(create=False)


@pytest_asyncio.fixture
async def connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """An outer transaction that is rolled back after each test.

    Everything a test does (including writes made through the API client) runs
    inside this transaction and is discarded on rollback, giving each test a
    clean database without truncating tables or spinning up a fresh DB.
    """
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            yield conn
        finally:
            await transaction.rollback()


@pytest_asyncio.fixture
async def db_session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """A session bound to the per-test transaction.

    ``join_transaction_mode="create_savepoint"`` makes ``session.commit()`` issue
    savepoints instead of committing the outer transaction, so application code
    that commits still gets rolled back at the end of the test.
    """
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def client(
    db_session: AsyncSession,
    connection: AsyncConnection,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[AsyncClient]:
    """A FastAPI test client whose requests share the per-test transaction.

    The streaming chat endpoint persists its assistant message through a *fresh*
    ``async_session`` (the request-scoped session may already be closed once the
    SSE generator runs). Left untouched that factory points at the live database,
    so the message would be written outside the test transaction and fail the
    foreign key to the rolled-back conversation. We rebind it to the per-test
    connection so those writes join — and roll back with — the test transaction.
    """

    async def _override_get_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    save_path_maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    monkeypatch.setattr("takehome.db.session.async_session", save_path_maker)

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def stub_llm(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """Replace LLM calls with deterministic, offline fakes.

    Guarantees tests never reach Anthropic. Patches both the ``services.llm``
    source module and the names already imported into the message router. As new
    LLM entry points land (e.g. ``chat_with_documents`` in a later phase), they
    are patched here too via ``raising=False``.
    """
    import takehome.services.llm as llm_module
    import takehome.web.routers.messages as messages_module

    async def fake_chat(*_args: object, **_kwargs: object) -> AsyncIterator[str]:
        for chunk in ("This ", "is ", "a ", "stubbed ", "response."):
            yield chunk

    async def fake_generate_title(_user_message: str) -> str:
        return "Stubbed Title"

    async def fake_judge_grounding(
        *, user_message: str, answer_text: str, documents: list, **_kwargs: object
    ):
        del user_message, answer_text
        from takehome.services.llm import AnnotatedBlock, AnswerAnnotation

        if not any(d.is_active for d in documents):
            return AnswerAnnotation(blocks=[], grounding_status="ungrounded", summary=None)
        return AnswerAnnotation(
            blocks=[
                AnnotatedBlock(
                    block_index=0,
                    text="stub",
                    basis="general_knowledge",
                    citations=[],
                )
            ],
            grounding_status="partial",
            summary="Stub judge.",
        )

    def fake_count_tokens(text: str | None) -> int:
        if not text:
            return 0
        return len(text.split())

    for module in (llm_module, messages_module):
        monkeypatch.setattr(module, "generate_title", fake_generate_title, raising=False)
        monkeypatch.setattr(module, "chat_with_documents", fake_chat, raising=False)
        monkeypatch.setattr(module, "judge_grounding", fake_judge_grounding, raising=False)

    # Keep token counting offline + deterministic for the async budget gate.
    monkeypatch.setattr(llm_module, "count_tokens", fake_count_tokens, raising=False)

    return SimpleNamespace(
        chat=fake_chat,
        generate_title=fake_generate_title,
        count_tokens=fake_count_tokens,
    )
