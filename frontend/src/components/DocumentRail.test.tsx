import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ContextUsage, Document } from "../types";
import { DocumentRail } from "./DocumentRail";
import { TooltipProvider } from "./ui/tooltip";

function makeContextUsage(usedTokens = 5000): ContextUsage {
	return {
		model: "claude-haiku-4-5-20251001",
		context_window: 200_000,
		reserved_output: 8000,
		used_tokens: usedTokens,
		used_fraction: usedTokens / 200_000,
		categories: [],
	};
}

const defaultContextProps = {
	contextUsage: null as ContextUsage | null,
	contextUsageLoading: false,
};

function makeDoc(
	id: string,
	filename: string,
	overrides: Partial<Document> = {},
): Document {
	return {
		id,
		conversation_id: "conv-1",
		filename,
		page_count: 3,
		uploaded_at: "2026-06-20T14:30:00.000Z",
		token_count: 1200,
		has_extracted_text: true,
		...overrides,
	};
}

function renderRail(props: ComponentProps<typeof DocumentRail>) {
	return render(
		<TooltipProvider>
			<DocumentRail {...props} />
		</TooltipProvider>,
	);
}

describe("DocumentRail", () => {
	it("renders all documents with metadata and active highlight", () => {
		const docs = [makeDoc("doc-1", "lease.pdf"), makeDoc("doc-2", "title.pdf")];

		renderRail({
			documents: docs,
			activeDocumentId: "doc-2",
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(screen.getByText("lease.pdf")).toBeTruthy();
		expect(screen.getByText("title.pdf")).toBeTruthy();
		expect(screen.getAllByText(/3 pages/)).toHaveLength(2);
		expect(screen.queryByText(/1\.2K/)).toBeNull();

		const activeCard = screen.getByText("title.pdf").closest("div.rounded-lg");
		expect(activeCard?.className).toContain("ring-neutral-900");
	});

	it("shows cited badge and failed extraction state", () => {
		renderRail({
			documents: [
				makeDoc("doc-1", "lease.pdf"),
				makeDoc("doc-2", "scan.pdf", { has_extracted_text: false }),
			],
			activeDocumentId: "doc-1",
			citedDocumentIds: new Set(["doc-1"]),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(screen.getByText("Cited")).toBeTruthy();
		expect(
			screen.getAllByRole("button", { name: /remove/i }).length,
		).toBeGreaterThan(0);
	});

	it("truncates long filenames within the rail", () => {
		const longName = `${"very-long-contract-name-".repeat(4)}final.pdf`;
		renderRail({
			documents: [makeDoc("doc-1", longName)],
			activeDocumentId: "doc-1",
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		const filename = screen.getByText(longName);
		expect(filename.tagName).toBe("SPAN");
		expect(filename.className).toContain("truncate");
		expect(filename.className).toContain("min-w-0");
	});

	it("calls onSelect and onRemove", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		const onRemove = vi.fn();
		const doc = makeDoc("doc-1", "lease.pdf");

		renderRail({
			documents: [doc],
			activeDocumentId: "doc-1",
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect,
			onUpload: vi.fn(),
			onRemove,
		});

		await user.click(screen.getByText("lease.pdf"));
		expect(onSelect).toHaveBeenCalledWith("doc-1");

		await user.click(
			screen.getByRole("button", { name: /remove lease\.pdf/i }),
		);
		expect(onRemove).toHaveBeenCalledWith("doc-1");
	});

	it("uploads multiple files from the add button", async () => {
		const user = userEvent.setup();
		const onUpload = vi.fn();

		renderRail({
			documents: [],
			activeDocumentId: null,
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload,
			onRemove: vi.fn(),
		});

		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
		const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

		await user.click(screen.getByRole("button", { name: /add/i }));
		fireEvent.change(input, { target: { files: [fileA, fileB] } });

		expect(onUpload).toHaveBeenCalledWith([fileA, fileB]);
	});

	it("shows upload queue progress and errors", () => {
		renderRail({
			documents: [],
			activeDocumentId: null,
			citedDocumentIds: new Set(),
			uploading: true,
			uploadQueue: [
				{
					key: "1",
					filename: "uploading.pdf",
					status: "uploading",
				},
				{
					key: "2",
					filename: "bad.pdf",
					status: "error",
					error: "Invalid PDF",
				},
			],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(screen.getByText("uploading.pdf")).toBeTruthy();
		expect(screen.getByText("Uploading…")).toBeTruthy();
		expect(screen.getByText("Invalid PDF")).toBeTruthy();
	});

	it("renders context meter in header when usage is available", () => {
		renderRail({
			documents: [makeDoc("doc-1", "lease.pdf")],
			activeDocumentId: "doc-1",
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			contextUsage: makeContextUsage(10_000),
			contextUsageLoading: false,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(screen.getByText("5%")).toBeTruthy();
	});

	it("collapses and expands the rail", async () => {
		const user = userEvent.setup();
		renderRail({
			documents: [makeDoc("doc-1", "lease.pdf")],
			activeDocumentId: "doc-1",
			citedDocumentIds: new Set(),
			uploading: false,
			uploadQueue: [],
			conversationId: "conv-1",
			...defaultContextProps,
			onSelect: vi.fn(),
			onUpload: vi.fn(),
			onRemove: vi.fn(),
		});

		await user.click(
			screen.getByRole("button", { name: /collapse document rail/i }),
		);
		expect(screen.queryByText("lease.pdf")).toBeNull();
		expect(
			screen.getByRole("button", { name: /expand document rail/i }),
		).toBeTruthy();

		await user.click(
			screen.getByRole("button", { name: /expand document rail/i }),
		);
		expect(screen.getByText("lease.pdf")).toBeTruthy();
	});
});
