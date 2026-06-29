import { describe, expect, it } from "vitest";
import type { Document, VerifiedCitation } from "../types";
import {
	buildCitationJumpTarget,
	citationSearchText,
	isCitationNavigable,
	pageFromLabel,
} from "./citation-jump";

const DOC: Document = {
	id: "doc-1",
	conversation_id: "conv-1",
	filename: "lease.pdf",
	page_count: 10,
	uploaded_at: "2026-01-01",
	token_count: 100,
	has_extracted_text: true,
};

const CITATION: VerifiedCitation = {
	document_ordinal: 1,
	document_id: "doc-1",
	label: "Page 2, Section 4.1",
	page: null,
	quote: "The cap is £2m",
	verified: true,
};

describe("pageFromLabel", () => {
	it("parses page number from label", () => {
		expect(pageFromLabel("Page 2, Registered Owner")).toBe(2);
		expect(pageFromLabel("Section 4.1")).toBeNull();
	});
});

describe("isCitationNavigable", () => {
	it("allows document and mixed citations with a document id", () => {
		expect(isCitationNavigable("document", CITATION)).toBe(true);
		expect(isCitationNavigable("mixed", CITATION)).toBe(true);
		expect(isCitationNavigable("general_knowledge", null)).toBe(false);
		expect(isCitationNavigable("not_in_documents", null)).toBe(false);
	});
});

describe("buildCitationJumpTarget", () => {
	it("includes verified quote as search text", () => {
		expect(buildCitationJumpTarget(CITATION, 2)).toEqual({
			documentId: "doc-1",
			page: 2,
			searchText: "The cap is £2m",
		});
	});

	it("omits search text when quote is unverified", () => {
		expect(
			citationSearchText({ ...CITATION, verified: false }),
		).toBeUndefined();
	});
});
