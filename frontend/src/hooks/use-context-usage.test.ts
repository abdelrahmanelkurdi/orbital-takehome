import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../types";
import { useContextUsage } from "./use-context-usage";

vi.mock("../lib/api", () => ({
	fetchContextUsage: vi.fn(),
}));

import * as api from "../lib/api";

const fetchContextUsage = vi.mocked(api.fetchContextUsage);

function makeDoc(id: string, filename: string, token_count: number): Document {
	return {
		id,
		conversation_id: "conv-1",
		filename,
		page_count: 1,
		uploaded_at: "2026-01-01T00:00:00",
		token_count,
		has_extracted_text: true,
	};
}

describe("useContextUsage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("exposes per-document usage immediately from the document list", async () => {
		fetchContextUsage.mockReturnValue(new Promise(() => {}));
		const docs = [makeDoc("doc-1", "lease.pdf", 1200)];

		const { result } = renderHook(() => useContextUsage("conv-1", docs));

		expect(result.current.documentUsage).toEqual([
			{ id: "doc-1", filename: "lease.pdf", tokens: 1200 },
		]);
		expect(result.current.contextUsage).toBeNull();
	});

	it("loads full context usage in the background", async () => {
		fetchContextUsage.mockResolvedValue({
			model: "claude-haiku-4-5-20251001",
			context_window: 200_000,
			reserved_output: 8000,
			used_tokens: 5000,
			used_fraction: 0.025,
			categories: [],
		});

		const { result } = renderHook(() =>
			useContextUsage("conv-1", [makeDoc("doc-1", "lease.pdf", 1200)]),
		);

		expect(result.current.contextUsageLoading).toBe(true);
		expect(result.current.contextUsage).toBeNull();

		await waitFor(() => {
			expect(result.current.contextUsageLoading).toBe(false);
			expect(result.current.contextUsage?.used_tokens).toBe(5000);
		});
	});

	it("derives contextFull from usage against usable budget", async () => {
		fetchContextUsage.mockResolvedValue({
			model: "claude-haiku-4-5-20251001",
			context_window: 200_000,
			reserved_output: 8000,
			used_tokens: 192_001,
			used_fraction: 192_001 / 200_000,
			categories: [],
		});

		const { result } = renderHook(() =>
			useContextUsage("conv-1", [makeDoc("doc-1", "lease.pdf", 1200)]),
		);

		await waitFor(() => {
			expect(result.current.contextFull).toBe(true);
		});
	});
});
