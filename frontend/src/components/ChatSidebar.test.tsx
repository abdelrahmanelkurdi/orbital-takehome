import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../types";
import { ChatSidebar } from "./ChatSidebar";
import { TooltipProvider } from "./ui/tooltip";

function makeConversation(title: string): Conversation {
	return {
		id: "conv-1",
		title,
		created_at: "2026-06-22T14:00:00",
		updated_at: "2026-06-22T14:00:00",
		document_count: 0,
	};
}

function renderSidebar(conversations: Conversation[]) {
	return render(
		<TooltipProvider>
			<ChatSidebar
				conversations={conversations}
				selectedId={null}
				loading={false}
				onSelect={vi.fn()}
				onCreate={vi.fn()}
				onDelete={vi.fn()}
			/>
		</TooltipProvider>,
	);
}

describe("ChatSidebar", () => {
	it("truncates long titles and keeps delete control in the row", async () => {
		const user = userEvent.setup();
		const longTitle = `${"very-long-conversation-title-".repeat(4)}final`;
		renderSidebar([makeConversation(longTitle)]);

		const title = screen.getByText(longTitle);
		expect(title.className).toContain("truncate");

		const row = title.closest("button");
		expect(row?.className).toContain("min-w-0");

		const card = title.closest(".grid");
		expect(card).not.toBeNull();

		expect(
			screen.queryByRole("button", { name: `Delete ${longTitle}` }),
		).toBeNull();

		await user.hover(card as HTMLElement);
		expect(
			screen.getByRole("button", { name: `Delete ${longTitle}` }),
		).toBeTruthy();
	});
});
