import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentDropZone } from "./DocumentDropZone";
import { DocumentUpload } from "./DocumentUpload";

describe("DocumentUpload", () => {
	it("passes all selected PDF files to onUpload", async () => {
		const onUpload = vi.fn();
		render(<DocumentUpload onUpload={onUpload} />);

		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
		const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

		fireEvent.change(input, { target: { files: [fileA, fileB] } });

		expect(onUpload).toHaveBeenCalledWith([fileA, fileB]);
	});

	it("accepts multiple files from drag-and-drop", () => {
		const onUpload = vi.fn();
		render(<DocumentUpload onUpload={onUpload} />);

		const dropTarget = screen.getByRole("button");
		const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
		const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

		fireEvent.drop(dropTarget, {
			dataTransfer: { files: [fileA, fileB] },
		});

		expect(onUpload).toHaveBeenCalledWith([fileA, fileB]);
	});
});

describe("DocumentDropZone", () => {
	it("forwards dropped PDFs when enabled", async () => {
		const onUpload = vi.fn();
		render(
			<DocumentDropZone enabled onUpload={onUpload}>
				<div data-testid="content">Conversation</div>
			</DocumentDropZone>,
		);

		const zone = screen.getByTestId("content").parentElement as HTMLElement;
		const file = new File(["a"], "a.pdf", { type: "application/pdf" });

		fireEvent.dragOver(zone);
		expect(screen.getByText("Drop PDFs to add documents")).toBeTruthy();

		fireEvent.drop(zone, {
			dataTransfer: { files: [file] },
		});

		expect(onUpload).toHaveBeenCalledWith([file]);
	});

	it("ignores drops when disabled", () => {
		const onUpload = vi.fn();
		render(
			<DocumentDropZone enabled={false} onUpload={onUpload}>
				<div data-testid="content">Conversation</div>
			</DocumentDropZone>,
		);

		const zone = screen.getByTestId("content").parentElement as HTMLElement;
		const file = new File(["a"], "a.pdf", { type: "application/pdf" });

		fireEvent.drop(zone, {
			dataTransfer: { files: [file] },
		});

		expect(onUpload).not.toHaveBeenCalled();
	});
});
