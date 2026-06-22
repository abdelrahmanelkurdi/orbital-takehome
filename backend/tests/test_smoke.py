from __future__ import annotations

from httpx import AsyncClient


async def test_sanity() -> None:
    """A trivial test proving the pytest harness runs."""
    assert True


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_create_conversation(client: AsyncClient) -> None:
    """Exercises the async DB session + httpx client harness end to end."""
    response = await client.post("/api/conversations")
    assert response.status_code == 201

    body = response.json()
    assert body["id"]
    assert body["document_count"] == 0
