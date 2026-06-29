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
	Page: ({
		pageNumber,
		onGetTextSuccess,
		customTextRenderer,
	}: {
		pageNumber: number;
		onGetTextSuccess?: (text: { items: { str: string }[] }) => void;
		customTextRenderer?: (item: { str: string; itemIndex: number }) => string;
	}) => {
		// biome-ignore lint/correctness/useExhaustiveDependencies: simulate text layer on mount
		useEffect(() => {
			onGetTextSuccess?.({
				items: [
					{ str: "The cap" },
					{ str: "is" },
					{ str: "£2,000,000" },
					{ str: "for all claims." },
				],
			});
		}, [pageNumber]);
		const rendered2 =
			customTextRenderer?.({ str: "£2,000,000", itemIndex: 2 }) ?? "£2,000,000";
		const rendered3 =
			customTextRenderer?.({ str: "for all claims.", itemIndex: 3 }) ??
			"for all claims.";
		return (
			<div data-testid="pdf-page">
				Page {pageNumber}
				<span data-testid="highlight-2">{rendered2}</span>
				<span data-testid="highlight-3">{rendered3}</span>
			</div>
		);
	},
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

	it("jumps to the requested page when jumpRequest is provided", async () => {
		const doc = makeDoc("doc-1", "lease.pdf");
		const jumpRequest = {
			documentId: "doc-1",
			page: 3,
			searchText: "The cap is £2m",
			key: 1,
		};

		render(<DocumentViewer document={doc} jumpRequest={jumpRequest} />);

		await waitFor(() => {
			expect(screen.getByTestId("pdf-page").textContent).toBe("Page 3");
		});
		expect(screen.queryByText(/Referencing:/)).toBeNull();
	});

	it("updates highlight when jumping to the same page with different search text", async () => {
		const doc = makeDoc("doc-1", "lease.pdf");
		const firstJump = {
			documentId: "doc-1",
			page: 2,
			searchText: "The cap is £2,000,000",
			key: 1,
		};
		const secondJump = {
			documentId: "doc-1",
			page: 2,
			searchText: "for all claims.",
			key: 2,
		};

		const { rerender } = render(
			<DocumentViewer document={doc} jumpRequest={firstJump} />,
		);

		await waitFor(() => {
			expect(screen.getByTestId("highlight-2").innerHTML).toContain(
				"citation-highlight",
			);
		});

		rerender(<DocumentViewer document={doc} jumpRequest={secondJump} />);

		await waitFor(() => {
			expect(screen.getByTestId("highlight-3").innerHTML).toContain(
				"citation-highlight",
			);
			expect(screen.getByTestId("highlight-2").innerHTML).not.toContain(
				"citation-highlight",
			);
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
