import type { Message } from "../types";

type CitationSummaryInput = Pick<Message, "sources_cited" | "cited_documents">;

/** Footer label for assistant citation counts, e.g. "3 documents cited (5 references)". */
export function formatCitationSummary(
	message: CitationSummaryInput,
): string | null {
	const references = message.sources_cited;
	if (references <= 0) return null;

	const documentCount = message.cited_documents?.length ?? 0;
	if (documentCount === 0) {
		const refLabel = references === 1 ? "reference" : "references";
		return `${references} ${refLabel}`;
	}

	const docLabel = documentCount === 1 ? "document" : "documents";
	if (references === documentCount) {
		return `${documentCount} ${docLabel} cited`;
	}

	const refLabel = references === 1 ? "reference" : "references";
	return `${documentCount} ${docLabel} cited (${references} ${refLabel})`;
}

/** Document IDs cited in at least one assistant answer. */
export function getCitedDocumentIds(messages: Message[]): Set<string> {
	const cited = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const entry of message.cited_documents ?? []) {
			if (entry.citation_count > 0) {
				cited.add(entry.document_id);
			}
		}
	}
	return cited;
}
