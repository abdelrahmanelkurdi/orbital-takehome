import type { Document, VerifiedCitation } from "../types";
import * as api from "./api";

export interface CitationJumpTarget {
	documentId: string;
	page: number;
	searchText?: string;
}

/** Viewer receives a monotonic key so repeated jumps to the same page still apply. */
export interface ViewerJumpRequest extends CitationJumpTarget {
	key: number;
}

export function pageFromLabel(label: string): number | null {
	const match = label.match(/\bpage\s*(\d+)\b/i);
	if (!match) {
		return null;
	}
	const page = Number.parseInt(match[1], 10);
	return Number.isFinite(page) && page > 0 ? page : null;
}

export function isCitationNavigable(
	basis: string,
	citation: VerifiedCitation | null | undefined,
): boolean {
	if (basis !== "document" && basis !== "mixed") {
		return false;
	}
	return Boolean(citation?.document_id);
}

export function citationSearchText(citation: VerifiedCitation): string | undefined {
	if (citation.verified && citation.quote?.trim()) {
		return citation.quote.trim();
	}
	return undefined;
}

export function buildCitationJumpTarget(
	citation: VerifiedCitation,
	page: number,
): CitationJumpTarget {
	return {
		documentId: citation.document_id,
		page,
		searchText: citationSearchText(citation),
	};
}

export async function resolveCitationJumpTarget(
	citation: VerifiedCitation,
	documents: Document[],
): Promise<CitationJumpTarget | null> {
	const doc = documents.find((item) => item.id === citation.document_id);
	if (!doc) {
		return null;
	}

	let page =
		citation.page ?? pageFromLabel(citation.label) ?? null;

	if (page == null && doc.has_extracted_text) {
		page = await api.resolveCitationPage(citation.document_id, {
			page: citation.page,
			label: citation.label,
			quote: citation.quote,
		});
	}

	const resolvedPage = page ?? 1;
	return buildCitationJumpTarget(citation, resolvedPage);
}

export function viewerJumpFromTarget(
	target: CitationJumpTarget,
): ViewerJumpRequest {
	return { ...target, key: Date.now() };
}
