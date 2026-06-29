import type {
	BlockBasis,
	GroundingBlock,
	GroundingStatus,
	VerifiedCitation,
} from "../types";

export const GROUNDING_COPY = {
	checkingSources: "Checking sources…",
	groundedTooltip: "Supported by your uploaded documents",
	ungroundedBanner:
		"Review carefully — not supported by uploaded documents.",
	generalKnowledge: "General knowledge — not from your documents",
	notInDocuments: "Not supported by uploaded documents",
	unverifiedQuote: "Couldn't locate quote in document text",
	mixed: "Partly from documents, partly inferred",
} as const;

export function documentCitationLocation(
	ordinal: number,
	label: string,
): string {
	return `Document ${ordinal}, ${label}`;
}

export function documentCitationLabel(
	ordinal: number,
	label: string,
): string {
	return `${documentCitationLocation(ordinal, label)} — click to view`;
}

export function documentCitationUnverifiedLabel(
	ordinal: number,
	label: string,
): string {
	return `${documentCitationLocation(ordinal, label)} — ${GROUNDING_COPY.unverifiedQuote}`;
}

export function formatQuotePreview(quote: string, maxLength = 280): string {
	const trimmed = quote.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function getCitationChipTooltip(
	basis: BlockBasis,
	citation: VerifiedCitation | null,
): string {
	if (basis === "general_knowledge") {
		return GROUNDING_COPY.generalKnowledge;
	}
	if (basis === "not_in_documents") {
		return GROUNDING_COPY.notInDocuments;
	}
	if (basis === "mixed") {
		const location =
			citation != null
				? ` (${documentCitationLocation(citation.document_ordinal, citation.label)})`
				: "";
		let tooltip = `${GROUNDING_COPY.mixed}${location}`;
		if (citation?.quote && !citation.verified) {
			tooltip += `\n\nCould not verify quote:\n"${formatQuotePreview(citation.quote)}"`;
		}
		return tooltip;
	}
	// document basis
	if (citation == null) {
		return GROUNDING_COPY.unverifiedQuote;
	}
	if (!citation.verified) {
		let tooltip = documentCitationUnverifiedLabel(
			citation.document_ordinal,
			citation.label,
		);
		if (citation.quote?.trim()) {
			tooltip += `\n"${formatQuotePreview(citation.quote)}"`;
		}
		return tooltip;
	}
	let tooltip = documentCitationLabel(
		citation.document_ordinal,
		citation.label,
	);
	if (citation.quote) {
		tooltip += `\n"${citation.quote}"`;
	}
	return tooltip;
}

export interface GroundingDisplay {
	grounding_status?: GroundingStatus | null;
	grounding_summary?: string | null;
	blocks?: GroundingBlock[];
}

export function hasGroundingBlocks(
	grounding: GroundingDisplay | null | undefined,
): boolean {
	return (grounding?.blocks?.length ?? 0) > 0;
}
