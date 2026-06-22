import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../types";
import { useDocuments } from "./use-documents";

vi.mock("../lib/api", () => ({
	listDocuments: vi.fn(),
	uploadDocument: vi.fn(),
	deleteDocument: vi.fn(),
}));

import * as api from "../lib/api";

const listDocuments = vi.mocked(api.listDocuments);
const uploadDocument = vi.mocked(api.uploadDocument);
const deleteDocument = vi.mocked(api.deleteDocument);

function makeDoc(id: string, filename: string): Document {
	return {
		id,
		conversation_id: "conv-1",
		filename,
		page_count: 1,
		uploaded_at: "2026-01-01T00:00:00",
		token_count: 100,
		has_extracted_text: true,
	};
}

describe("useDocuments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listDocuments.mockResolvedValue([]);
	});

	it("upload appends documents instead of replacing them", async () => {
		const first = makeDoc("doc-1", "a.pdf");
		const second = makeDoc("doc-2", "b.pdf");

		listDocuments.mockResolvedValueOnce([first]).mockResolvedValue([first]);
		uploadDocument.mockResolvedValueOnce(second);

		const { result } = renderHook(() => useDocuments("conv-1"));

		await waitFor(() => {
			expect(result.current.documents).toEqual([first]);
		});

		await act(async () => {
			await result.current.upload(new File(["a"], "b.pdf"));
		});

		expect(result.current.documents).toEqual([first, second]);
		expect(result.current.hasDocuments).toBe(true);
	});

	it("remove drops a document from the list", async () => {
		const first = makeDoc("doc-1", "a.pdf");
		const second = makeDoc("doc-2", "b.pdf");
		listDocuments.mockResolvedValue([first, second]);
		deleteDocument.mockResolvedValue(undefined);

		const { result } = renderHook(() => useDocuments("conv-1"));

		await waitFor(() => {
			expect(result.current.documents).toHaveLength(2);
		});

		await act(async () => {
			await result.current.remove("doc-1");
		});

		expect(deleteDocument).toHaveBeenCalledWith("doc-1");
		expect(result.current.documents).toEqual([second]);
	});

	it("selects the first document by default and respects active selection", async () => {
		const first = makeDoc("doc-1", "a.pdf");
		const second = makeDoc("doc-2", "b.pdf");
		listDocuments.mockResolvedValue([first, second]);

		const { result } = renderHook(() => useDocuments("conv-1"));

		await waitFor(() => {
			expect(result.current.activeDocumentId).toBe("doc-1");
			expect(result.current.activeDocument).toEqual(first);
		});

		act(() => {
			result.current.setActiveDocument("doc-2");
		});

		expect(result.current.activeDocumentId).toBe("doc-2");
		expect(result.current.activeDocument).toEqual(second);
	});

	it("falls back when the active document is removed", async () => {
		const first = makeDoc("doc-1", "a.pdf");
		const second = makeDoc("doc-2", "b.pdf");
		listDocuments.mockResolvedValue([first, second]);
		deleteDocument.mockResolvedValue(undefined);

		const { result } = renderHook(() => useDocuments("conv-1"));

		await waitFor(() => {
			expect(result.current.activeDocumentId).toBe("doc-1");
		});

		act(() => {
			result.current.setActiveDocument("doc-2");
		});

		await act(async () => {
			await result.current.remove("doc-2");
		});

		expect(result.current.documents).toEqual([first]);
		expect(result.current.activeDocumentId).toBe("doc-1");
		expect(result.current.activeDocument).toEqual(first);
	});

	it("continues uploading after a per-file failure", async () => {
		const second = makeDoc("doc-2", "also-good.pdf");

		listDocuments.mockResolvedValue([]);
		uploadDocument
			.mockRejectedValueOnce(new Error("bad file"))
			.mockResolvedValueOnce(second);

		const { result } = renderHook(() => useDocuments("conv-1"));

		await waitFor(() => {
			expect(result.current.documents).toEqual([]);
		});

		await act(async () => {
			const outcome = await result.current.upload([
				new File(["bad"], "bad.pdf"),
				new File(["good"], "also-good.pdf"),
			]);
			expect(outcome.uploaded).toEqual([second]);
			expect(outcome.errors).toHaveLength(1);
		});

		expect(result.current.documents).toEqual([second]);
		expect(result.current.uploadQueue).toHaveLength(1);
		expect(result.current.uploadQueue[0]?.status).toBe("error");
	});
});
