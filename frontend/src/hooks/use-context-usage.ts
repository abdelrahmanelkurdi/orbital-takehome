import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchContextUsage } from "../lib/api";
import { isContextFull as computeIsContextFull } from "../lib/context-usage";
import type { ContextUsage, Document } from "../types";

export interface DocumentUsageItem {
	id: string;
	filename: string;
	tokens: number;
}

/**
 * Per-document token counts are available immediately from the list API
 * (cached at upload). Full context breakdown loads in the background for
 * the Phase 9 meter ring — nothing in the chat/rail UI should await it.
 */
export function useContextUsage(
	conversationId: string | null,
	documents: Document[],
) {
	const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
	const [contextUsageLoading, setContextUsageLoading] = useState(false);

	const documentUsage = useMemo<DocumentUsageItem[]>(
		() =>
			documents.map((doc) => ({
				id: doc.id,
				filename: doc.filename,
				tokens: doc.token_count,
			})),
		[documents],
	);

	const refreshContextUsage = useCallback(async () => {
		if (!conversationId) {
			setContextUsage(null);
			setContextUsageLoading(false);
			return;
		}

		setContextUsageLoading(true);
		try {
			const usage = await fetchContextUsage(conversationId);
			setContextUsage(usage);
		} catch {
			setContextUsage(null);
		} finally {
			setContextUsageLoading(false);
		}
	}, [conversationId]);

	useEffect(() => {
		setContextUsage(null);
		void refreshContextUsage();
	}, [refreshContextUsage]);

	const contextFull = useMemo(
		() => computeIsContextFull(contextUsage),
		[contextUsage],
	);

	return {
		documentUsage,
		contextUsage,
		contextUsageLoading,
		contextFull,
		refreshContextUsage,
	};
}
