import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { formatCitationSummary, getCitedDocumentIds } from "./citations";

describe("formatCitationSummary", () => {
	it("returns null when nothing was cited", () => {
		expect(formatCitationSummary({ sources_cited: 0 })).toBeNull();
	});

	it("shows documents and references when they differ", () => {
		expect(
			formatCitationSummary({
				sources_cited: 5,
				cited_documents: [
					{ document_id: "a", citation_count: 2 },
					{ document_id: "b", citation_count: 2 },
					{ document_id: "c", citation_count: 1 },
				],
			}),
		).toBe("3 documents cited (5 references)");
	});

	it("omits the reference count when each document is cited once", () => {
		expect(
			formatCitationSummary({
				sources_cited: 2,
				cited_documents: [
					{ document_id: "a", citation_count: 1 },
					{ document_id: "b", citation_count: 1 },
				],
			}),
		).toBe("2 documents cited");
	});

	it("singularizes document and reference labels", () => {
		expect(
			formatCitationSummary({
				sources_cited: 2,
				cited_documents: [{ document_id: "a", citation_count: 2 }],
			}),
		).toBe("1 document cited (2 references)");
	});
});

describe("getCitedDocumentIds", () => {
	it("collects cited document ids from assistant messages", () => {
		const messages: Message[] = [
			{
				id: "1",
				conversation_id: "conv-1",
				role: "user",
				content: "question",
				sources_cited: 0,
				created_at: "2026-01-01",
			},
			{
				id: "2",
				conversation_id: "conv-1",
				role: "assistant",
				content: "answer",
				sources_cited: 2,
				cited_documents: [
					{ document_id: "doc-1", citation_count: 1 },
					{ document_id: "doc-2", citation_count: 1 },
				],
				created_at: "2026-01-01",
			},
		];

		expect(getCitedDocumentIds(messages)).toEqual(new Set(["doc-1", "doc-2"]));
	});
});
