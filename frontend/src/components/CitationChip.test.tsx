import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GROUNDING_COPY } from "../lib/grounding";
import { CitationChip } from "./CitationChip";
import { TooltipProvider } from "./ui/tooltip";

function renderChip(props: React.ComponentProps<typeof CitationChip>) {
	return render(
		<TooltipProvider>
			<CitationChip {...props} />
		</TooltipProvider>,
	);
}

describe("CitationChip", () => {
	it("renders general knowledge chip with aria-label", () => {
		renderChip({ basis: "general_knowledge" });
		expect(
			screen.getByLabelText(GROUNDING_COPY.generalKnowledge),
		).toBeTruthy();
	});

	it("renders amber aria-label for unverified document quote", () => {
		renderChip({
			basis: "document",
			citation: {
				document_ordinal: 1,
				document_id: "a",
				label: "Section 2",
				verified: false,
			},
		});
		expect(
			screen.getByLabelText(/Couldn't locate quote in document text/),
		).toBeTruthy();
	});

	it("renders red not-in-documents chip with aria-label", () => {
		renderChip({ basis: "not_in_documents" });
		expect(
			screen.getByLabelText(GROUNDING_COPY.notInDocuments),
		).toBeTruthy();
	});

	it("calls onCitationClick for navigable document chips", () => {
		const onCitationClick = vi.fn();
		renderChip({
			basis: "document",
			citation: {
				document_ordinal: 1,
				document_id: "doc-1",
				label: "Page 2",
				verified: true,
				quote: "Sample",
			},
			onCitationClick,
		});
		screen.getByRole("button").click();
		expect(onCitationClick).toHaveBeenCalledTimes(1);
	});
});
