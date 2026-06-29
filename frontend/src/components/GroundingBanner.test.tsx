import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GROUNDING_COPY } from "../lib/grounding";
import { GroundingBanner } from "./GroundingBanner";
import { TooltipProvider } from "./ui/tooltip";

function renderBanner(
	props: React.ComponentProps<typeof GroundingBanner>,
) {
	return render(
		<TooltipProvider>
			<GroundingBanner {...props} />
		</TooltipProvider>,
	);
}

describe("GroundingBanner", () => {
	it("shows partial summary verbatim", () => {
		renderBanner({
			grounding: {
				grounding_status: "partial",
				grounding_summary: "Cap is documented; law is inferred.",
			},
		});
		expect(
			screen.getByText("Cap is documented; law is inferred."),
		).toBeTruthy();
	});

	it("shows ungrounded warning copy", () => {
		renderBanner({
			grounding: { grounding_status: "ungrounded" },
		});
		expect(screen.getByText(GROUNDING_COPY.ungroundedBanner)).toBeTruthy();
	});

	it("shows grounded check with accessible label", () => {
		renderBanner({
			grounding: { grounding_status: "grounded" },
		});
		expect(
			screen.getByLabelText(GROUNDING_COPY.groundedTooltip),
		).toBeTruthy();
	});
});
