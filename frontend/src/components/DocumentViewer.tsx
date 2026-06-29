import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Document as PDFDocument, Page, pdfjs } from "react-pdf";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "../lib/api";
import type { ViewerJumpRequest } from "../lib/citation-jump";
import {
	findHighlightItemIndices,
	renderHighlightedTextItem,
	scrollElementIntoContainer,
} from "../lib/pdf-highlight";
import type { Document } from "../types";
import { Button } from "./ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

const CONTENT_PADDING = 32;

interface DocumentViewerProps {
	document: Document | null;
	containerWidth?: number;
	jumpRequest?: ViewerJumpRequest | null;
}

function computePageRenderWidth(containerWidth: number): number {
	return Math.max(240, containerWidth - CONTENT_PADDING);
}

export function DocumentViewer({
	document,
	containerWidth,
	jumpRequest = null,
}: DocumentViewerProps) {
	const [numPages, setNumPages] = useState<number>(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [searchText, setSearchText] = useState<string | null>(null);
	const [highlightedIndices, setHighlightedIndices] = useState<Set<number>>(
		new Set(),
	);
	const [pdfLoading, setPdfLoading] = useState(true);
	const [pdfError, setPdfError] = useState<string | null>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const pageTextItemsRef = useRef<TextContent["items"] | null>(null);
	const previousDocumentId = useRef<string | null | undefined>(undefined);

	const applyHighlight = useCallback((phrase: string | null) => {
		if (!phrase) {
			setHighlightedIndices(new Set());
			return;
		}
		const items = pageTextItemsRef.current;
		if (!items) {
			return;
		}
		setHighlightedIndices(findHighlightItemIndices(items, phrase));
	}, []);

	const clearHighlight = useCallback(() => {
		setSearchText(null);
		setHighlightedIndices(new Set());
	}, []);

	const goToPage = useCallback(
		(page: number) => {
			clearHighlight();
			setCurrentPage(page);
		},
		[clearHighlight],
	);

	useLayoutEffect(() => {
		pageTextItemsRef.current = null;
	}, [currentPage]);

	useLayoutEffect(() => {
		const currentId = document?.id ?? null;
		if (previousDocumentId.current === undefined) {
			previousDocumentId.current = currentId;
			return;
		}
		if (previousDocumentId.current === currentId) {
			return;
		}
		previousDocumentId.current = currentId;
		goToPage(1);
		setNumPages(0);
		setPdfLoading(true);
		setPdfError(null);
	}, [document?.id, goToPage]);

	useLayoutEffect(() => {
		if (!document || !jumpRequest || jumpRequest.documentId !== document.id) {
			return;
		}
		const page = Math.min(
			Math.max(1, jumpRequest.page),
			numPages > 0 ? numPages : jumpRequest.page,
		);
		setCurrentPage(page);
		setSearchText(jumpRequest.searchText ?? null);
		contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
	}, [document?.id, jumpRequest?.key, jumpRequest?.page, numPages]);

	// Same-page jumps do not remount <Page>, so recompute from cached text items.
	useLayoutEffect(() => {
		applyHighlight(searchText);
	}, [searchText, jumpRequest?.key, applyHighlight]);

	const handleGetTextSuccess = useCallback(
		(text: TextContent) => {
			pageTextItemsRef.current = text.items;
			applyHighlight(searchText);
		},
		[searchText, applyHighlight],
	);

	const customTextRenderer = useCallback(
		(textItem: { str: string; itemIndex: number }) =>
			renderHighlightedTextItem(
				textItem.str,
				textItem.itemIndex,
				highlightedIndices,
			),
		[highlightedIndices],
	);

	const scrollHighlightIntoView = useCallback(() => {
		const container = contentRef.current;
		if (!container || highlightedIndices.size === 0) {
			return;
		}
		const mark = container.querySelector("mark.citation-highlight");
		if (mark) {
			scrollElementIntoContainer(container, mark);
		}
	}, [highlightedIndices]);

	useLayoutEffect(() => {
		if (highlightedIndices.size > 0) {
			scrollHighlightIntoView();
		}
	}, [highlightedIndices, scrollHighlightIntoView]);

	// Panel width is stable; measuring inside the scroll area causes a scrollbar ↔ width loop.
	const pageRenderWidth = computePageRenderWidth(containerWidth ?? 480);

	if (!document) {
		return (
			<div className="flex h-full flex-1 flex-col items-center justify-center bg-neutral-50">
				<FileText className="mb-3 h-10 w-10 text-neutral-300" />
				<p className="text-sm text-neutral-400">No document uploaded</p>
			</div>
		);
	}

	const pdfUrl = getDocumentUrl(document.id);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-white">
			<div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-neutral-800">
						{document.filename}
					</p>
				</div>
			</div>

			<div
				ref={contentRef}
				className="flex min-h-0 flex-1 overflow-y-scroll overscroll-contain p-4"
			>
				<div className="mx-auto flex w-full min-w-0 justify-center">
					{pdfError && (
						<div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
							{pdfError}
						</div>
					)}

					<PDFDocument
						key={document.id}
						file={pdfUrl}
						onLoadSuccess={({ numPages: pages }) => {
							setNumPages(pages);
							setPdfLoading(false);
							setPdfError(null);
						}}
						onLoadError={(error) => {
							setPdfError(`Failed to load PDF: ${error.message}`);
							setPdfLoading(false);
						}}
						loading={
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
							</div>
						}
					>
						{!pdfLoading && !pdfError && (
							<Page
								key={currentPage}
								pageNumber={currentPage}
								width={pageRenderWidth}
								customTextRenderer={
									searchText ? customTextRenderer : undefined
								}
								onGetTextSuccess={handleGetTextSuccess}
								onRenderTextLayerSuccess={scrollHighlightIntoView}
								loading={
									<div className="flex items-center justify-center py-12">
										<Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
									</div>
								}
							/>
						)}
					</PDFDocument>
				</div>
			</div>

			{numPages > 0 && (
				<div className="flex items-center justify-center gap-3 border-t border-neutral-100 px-4 py-2.5">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						disabled={currentPage <= 1}
						onClick={() => goToPage(Math.max(1, currentPage - 1))}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="text-xs text-neutral-500">
						Page {currentPage} of {numPages}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						disabled={currentPage >= numPages}
						onClick={() => goToPage(Math.min(numPages, currentPage + 1))}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	);
}
