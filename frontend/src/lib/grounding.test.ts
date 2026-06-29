import { describe, expect, it } from "vitest";
import {
	documentCitationLabel,
	documentCitationUnverifiedLabel,
	formatQuotePreview,
	getCitationChipTooltip,
	GROUNDING_COPY,
} from "./grounding";

describe("getCitationChipTooltip", () => {
	it("returns general knowledge copy", () => {
		expect(getCitationChipTooltip("general_knowledge", null)).toBe(
			GROUNDING_COPY.generalKnowledge,
		);
	});

	it("returns unverified label and quote on separate lines, mirroring verified format", () => {
		const tooltip = getCitationChipTooltip("document", {
			document_ordinal: 1,
			document_id: "abc",
			label: "Page 1, Registered Owner",
			verified: false,
			quote: "Victoria Park Developments Ltd ... Registered as proprietor on 14 March 2019.",
		});
		expect(tooltip).toBe(
			`${documentCitationUnverifiedLabel(1, "Page 1, Registered Owner")}\n"Victoria Park Developments Ltd ... Registered as proprietor on 14 March 2019."`,
		);
	});

	it("truncates long unverified quotes in the tooltip", () => {
		const longQuote = "x".repeat(400);
		const tooltip = getCitationChipTooltip("document", {
			document_ordinal: 1,
			document_id: "a",
			label: "Page 1",
			verified: false,
			quote: longQuote,
		});
		expect(tooltip).toContain("…");
		expect(formatQuotePreview(longQuote).length).toBeLessThan(longQuote.length);
	});

	it("returns document label and quote for verified citation", () => {
		const tooltip = getCitationChipTooltip("document", {
			document_ordinal: 2,
			document_id: "abc",
			label: "Section 4.1",
			verified: true,
			quote: "The cap is £2m",
		});
		expect(tooltip).toContain(documentCitationLabel(2, "Section 4.1"));
		expect(tooltip).toContain("The cap is £2m");
	});
});
