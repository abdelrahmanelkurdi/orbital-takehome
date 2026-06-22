import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";
import { clearMessageCacheForTests, useMessages } from "./use-messages";

vi.mock("../lib/api", () => ({
	fetchMessages: vi.fn(),
	sendMessage: vi.fn(),
}));

import * as api from "../lib/api";

const fetchMessages = vi.mocked(api.fetchMessages);

function makeMessage(id: string, conversationId: string): Message {
	return {
		id,
		conversation_id: conversationId,
		role: "user",
		content: "hello",
		sources_cited: 0,
		created_at: "2026-01-01T00:00:00",
	};
}

describe("useMessages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearMessageCacheForTests();
	});

	afterEach(() => {
		clearMessageCacheForTests();
	});

	it("shows cached messages immediately on revisit while revalidating", async () => {
		const convA = "conv-a";
		const convB = "conv-b";
		const messagesA = [makeMessage("m-a", convA)];
		const messagesB = [makeMessage("m-b", convB)];

		fetchMessages
			.mockResolvedValueOnce(messagesA)
			.mockResolvedValueOnce(messagesB)
			.mockImplementation(() => new Promise(() => {}));

		const { result, rerender } = renderHook(({ id }) => useMessages(id), {
			initialProps: { id: convA as string | null },
		});

		await waitFor(() => {
			expect(result.current.messages).toEqual(messagesA);
		});

		rerender({ id: convB });
		await waitFor(() => {
			expect(result.current.messages).toEqual(messagesB);
		});

		rerender({ id: convA });

		expect(result.current.loading).toBe(false);
		expect(result.current.messages).toEqual(messagesA);
		expect(result.current.refreshing).toBe(true);
	});

	it("ignores stale fetch results after a rapid switch", async () => {
		const convA = "conv-a";
		const convB = "conv-b";
		const messagesA = [makeMessage("m-a", convA)];
		const messagesB = [makeMessage("m-b", convB)];

		let resolveA: (value: Message[]) => void = () => {};
		const pendingA = new Promise<Message[]>((resolve) => {
			resolveA = resolve;
		});

		fetchMessages.mockImplementation((id) => {
			if (id === convA) return pendingA;
			if (id === convB) return Promise.resolve(messagesB);
			return Promise.resolve([]);
		});

		const { result, rerender } = renderHook(({ id }) => useMessages(id), {
			initialProps: { id: convA as string | null },
		});

		rerender({ id: convB });
		await waitFor(() => {
			expect(result.current.messages).toEqual(messagesB);
		});

		resolveA(messagesA);
		await waitFor(() => {
			expect(fetchMessages).toHaveBeenCalled();
		});

		expect(result.current.messages).toEqual(messagesB);
	});
});
