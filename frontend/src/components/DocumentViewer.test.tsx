import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../types";
import { DocumentViewer } from "./DocumentViewer";

vi.mock("react-pdf", () => ({
	pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
	Document: ({
		file,
		onLoadSuccess,
		children,
	}: {
		file: string;
		onLoadSuccess?: (payload: { numPages: number }) => void;
		children?: React.ReactNode;
	}) => {
		// biome-ignore lint/correctness/useExhaustiveDependencies: reload mock when the PDF URL changes
		useEffect(() => {
			onLoadSuccess?.({ numPages: 3 });
		}, [file]);
		return <div data-testid="pdf-document">{children}</div>;
	},
	Page: ({ pageNumber }: { pageNumber: number }) => (
		<div data-testid="pdf-page">Page {pageNumber}</div>
	),
}));

function makeDoc(id: string, filename: string): Document {
	return {
		id,
		conversation_id: "conv-1",
		filename,
		page_count: 3,
		uploaded_at: "2026-01-01T00:00:00",
		token_count: 100,
		has_extracted_text: true,
	};
}

describe("DocumentViewer", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
	});

	it("shows empty state when no document is active", () => {
		render(<DocumentViewer document={null} />);
		expect(screen.getByText("No document uploaded")).toBeTruthy();
	});

	it("renders the active document filename", async () => {
		render(<DocumentViewer document={makeDoc("doc-1", "lease.pdf")} />);

		expect(screen.getByText("lease.pdf")).toBeTruthy();
		await waitFor(() => {
			expect(screen.getByTestId("pdf-page").textContent).toBe("Page 1");
		});
	});

	it("resets page state when switching to another document", async () => {
		const first = makeDoc("doc-1", "lease.pdf");
		const second = makeDoc("doc-2", "title.pdf");

		const { rerender } = render(<DocumentViewer document={first} />);

		await waitFor(() => {
			expect(screen.getByText("Page 1 of 3")).toBeTruthy();
		});

		const navButtons = screen.getAllByRole("button");
		const nextPageButton = navButtons[navButtons.length - 1];
		expect(nextPageButton).toBeTruthy();
		fireEvent.click(nextPageButton as HTMLElement);

		await waitFor(() => {
			expect(screen.getByText("Page 2 of 3")).toBeTruthy();
		});

		rerender(<DocumentViewer document={second} />);

		expect(screen.getByText("title.pdf")).toBeTruthy();
		await waitFor(() => {
			expect(screen.getByText("Page 1 of 3")).toBeTruthy();
			expect(screen.getByTestId("pdf-page").textContent).toBe("Page 1");
		});
	});
});
