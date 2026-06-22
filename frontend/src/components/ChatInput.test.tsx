import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";
import { TooltipProvider } from "./ui/tooltip";

function renderInput(
	props: Partial<React.ComponentProps<typeof ChatInput>> = {},
) {
	return render(
		<TooltipProvider>
			<ChatInput
				onSend={vi.fn()}
				onUpload={vi.fn()}
				disabled={false}
				{...props}
			/>
		</TooltipProvider>,
	);
}

describe("ChatInput", () => {
	it("shows context full message and disables send when over budget", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();

		renderInput({ contextFull: true, onSend });

		expect(
			screen.getByText("Context full — remove a document to continue."),
		).toBeTruthy();

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "Hello");
		await user.click(screen.getByRole("button", { name: /send message/i }));

		expect(onSend).not.toHaveBeenCalled();
	});

	it("attaches PDFs via the paperclip button", async () => {
		const user = userEvent.setup();
		const onUpload = vi.fn();

		renderInput({ onUpload });

		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
		const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

		await user.click(screen.getByRole("button", { name: /attach pdf/i }));
		fireEvent.change(input, { target: { files: [fileA, fileB] } });

		expect(onUpload).toHaveBeenCalledWith([fileA, fileB]);
	});
});
