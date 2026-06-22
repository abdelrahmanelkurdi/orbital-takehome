import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ContextUsage } from "../types";
import { ContextMeter } from "./ContextMeter";
import { TooltipProvider } from "./ui/tooltip";

function renderMeter(ui: ReactElement) {
	return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function makeUsage(
	overrides: Partial<ContextUsage> & Pick<ContextUsage, "used_tokens">,
): ContextUsage {
	return {
		model: "claude-haiku-4-5-20251001",
		context_window: 200_000,
		reserved_output: 8000,
		used_fraction: overrides.used_tokens / 200_000,
		categories: [
			{ key: "system", label: "System prompt", tokens: 320 },
			{ key: "history", label: "Conversation history", tokens: 1000 },
			{
				key: "overhead",
				label: "Document context framing",
				tokens: 540,
			},
			{
				key: "documents",
				label: "Documents",
				tokens: 50_000,
				items: [
					{ id: "doc-1", filename: "lease.pdf", tokens: 30_000 },
					{ id: "doc-2", filename: "title.pdf", tokens: 20_000 },
				],
			},
		],
		...overrides,
	};
}

describe("ContextMeter", () => {
	it("renders percentage and category breakdown in popover", async () => {
		const user = userEvent.setup();
		const usage = makeUsage({ used_tokens: 51_860 });

		renderMeter(<ContextMeter contextUsage={usage} loading={false} />);

		expect(screen.getByText("27%")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /context usage/i }));

		expect(
			screen.getByRole("dialog", { name: /context usage breakdown/i }),
		).toBeTruthy();
		expect(screen.getByText("System prompt")).toBeTruthy();
		expect(screen.getByText("Conversation history")).toBeTruthy();
		expect(screen.getByText("lease.pdf")).toBeTruthy();
		expect(screen.getByText("title.pdf")).toBeTruthy();
		expect(screen.getAllByText("30.0K")).toHaveLength(1);
	});

	it("applies warning styling near budget", () => {
		const usage = makeUsage({ used_tokens: 170_000 });
		renderMeter(<ContextMeter contextUsage={usage} loading={false} />);

		const percent = screen.getByText(/89%/);
		expect(percent.className).toContain("text-amber-700");
	});

	it("applies full styling at or over usable budget", () => {
		const usage = makeUsage({ used_tokens: 195_000 });
		renderMeter(<ContextMeter contextUsage={usage} loading={false} />);

		const percent = screen.getByText("102%");
		expect(percent.className).toContain("text-red-600");
	});

	it("calls onRemoveDocument from popover document rows", async () => {
		const user = userEvent.setup();
		const onRemoveDocument = vi.fn();
		const usage = makeUsage({ used_tokens: 51_860 });

		renderMeter(
			<ContextMeter
				contextUsage={usage}
				loading={false}
				onRemoveDocument={onRemoveDocument}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /context usage/i }));
		await user.click(screen.getByRole("button", { name: "Remove lease.pdf" }));

		expect(onRemoveDocument).toHaveBeenCalledWith("doc-1");
	});

	it("closes popover on outside click", async () => {
		const user = userEvent.setup();
		renderMeter(
			<div>
				<ContextMeter
					contextUsage={makeUsage({ used_tokens: 10_000 })}
					loading={false}
				/>
				<button type="button">Outside</button>
			</div>,
		);

		await user.click(screen.getByRole("button", { name: /context usage/i }));
		expect(screen.getByRole("dialog")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Outside" }));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("uses a scrollable region when many documents are listed", async () => {
		const user = userEvent.setup();
		const manyDocs = Array.from({ length: 20 }, (_, index) => ({
			id: `doc-${index}`,
			filename: `contract-${index}.pdf`,
			tokens: 5000 + index,
		}));

		renderMeter(
			<ContextMeter
				contextUsage={makeUsage({
					used_tokens: 120_000,
					categories: [
						{ key: "system", label: "System prompt", tokens: 320 },
						{
							key: "overhead",
							label: "Document context framing",
							tokens: 540,
						},
						{
							key: "documents",
							label: "Documents",
							tokens: 100_000,
							items: manyDocs,
						},
					],
				})}
				loading={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /context usage/i }));

		const scrollRegion = screen.getByTestId("context-usage-scroll");
		expect(scrollRegion.className).toContain("overflow-y-auto");
		expect(screen.getByText("contract-19.pdf")).toBeTruthy();
		expect(screen.getByText(/tokens reserved for the response/)).toBeTruthy();
	});
});
