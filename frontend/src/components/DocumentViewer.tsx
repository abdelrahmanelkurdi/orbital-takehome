import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Document as PDFDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "../lib/api";
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
}

interface PageDimensions {
	width: number;
	height: number;
}

function computePageRenderWidth(
	containerWidth: number,
	containerHeight: number,
	page: PageDimensions | null,
): number {
	const availableWidth = Math.max(240, containerWidth - CONTENT_PADDING);
	const availableHeight = Math.max(240, containerHeight - CONTENT_PADDING);

	if (!page || page.width <= 0 || page.height <= 0) {
		return availableWidth;
	}

	const widthFromHeight = availableHeight * (page.width / page.height);
	return Math.floor(Math.min(availableWidth, widthFromHeight));
}

export function DocumentViewer({
	document,
	containerWidth,
}: DocumentViewerProps) {
	const [numPages, setNumPages] = useState<number>(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [pdfLoading, setPdfLoading] = useState(true);
	const [pdfError, setPdfError] = useState<string | null>(null);
	const [contentSize, setContentSize] = useState({ width: 360, height: 480 });
	const [pageDimensions, setPageDimensions] = useState<PageDimensions | null>(
		null,
	);
	const contentRef = useRef<HTMLDivElement>(null);
	const previousDocumentId = useRef<string | null | undefined>(undefined);

	// Re-attach when the scroll container mounts (first document) or the panel resizes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: document?.id and containerWidth trigger re-measure
	useLayoutEffect(() => {
		const element = contentRef.current;
		if (!element) return;

		const updateSize = () => {
			setContentSize({
				width: element.clientWidth,
				height: element.clientHeight,
			});
		};

		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(element);
		return () => observer.disconnect();
	}, [document?.id, containerWidth]);

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
		setCurrentPage(1);
		setNumPages(0);
		setPdfLoading(true);
		setPdfError(null);
		setPageDimensions(null);
	}, [document?.id]);

	if (!document) {
		return (
			<div className="flex h-full flex-1 flex-col items-center justify-center bg-neutral-50">
				<FileText className="mb-3 h-10 w-10 text-neutral-300" />
				<p className="text-sm text-neutral-400">No document uploaded</p>
			</div>
		);
	}

	const pdfUrl = getDocumentUrl(document.id);
	const pageRenderWidth = computePageRenderWidth(
		contentSize.width,
		contentSize.height,
		pageDimensions,
	);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-white">
			<div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-neutral-800">
						{document.filename}
					</p>
					<p className="text-xs text-neutral-400">
						{document.page_count} page{document.page_count !== 1 ? "s" : ""}
					</p>
				</div>
			</div>

			<div ref={contentRef} className="flex min-h-0 flex-1 overflow-y-auto p-4">
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
								key={`${currentPage}-${pageRenderWidth}`}
								pageNumber={currentPage}
								width={pageRenderWidth}
								onLoadSuccess={(page) => {
									const viewport = page.getViewport({ scale: 1 });
									setPageDimensions({
										width: viewport.width,
										height: viewport.height,
									});
								}}
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
						onClick={() => {
							setPageDimensions(null);
							setCurrentPage((p) => Math.max(1, p - 1));
						}}
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
						onClick={() => {
							setPageDimensions(null);
							setCurrentPage((p) => Math.min(numPages, p + 1));
						}}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	);
}
