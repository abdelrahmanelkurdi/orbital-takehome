import { AnimatePresence, motion } from "framer-motion";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Conversation } from "../types";
import { RelativeTime } from "./RelativeTime";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ChatSidebarProps {
	conversations: Conversation[];
	selectedId: string | null;
	loading: boolean;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onDelete: (id: string) => void;
}

export function ChatSidebar({
	conversations,
	selectedId,
	loading,
	onSelect,
	onCreate,
	onDelete,
}: ChatSidebarProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	return (
		<div className="flex h-full w-[250px] flex-shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-white">
			<div className="flex items-center justify-between border-b border-neutral-100 p-3">
				<span className="text-sm font-semibold text-neutral-700">Chats</span>
				<Button variant="ghost" size="icon" onClick={onCreate} title="New chat">
					<MessageSquarePlus className="h-4 w-4" />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
				<div className="p-2">
					{loading && conversations.length === 0 && (
						<div className="space-y-2 p-2">
							{[1, 2, 3].map((i) => (
								<div key={i} className="animate-pulse space-y-1">
									<div className="h-4 w-3/4 rounded bg-neutral-100" />
									<div className="h-3 w-1/2 rounded bg-neutral-50" />
								</div>
							))}
						</div>
					)}

					{!loading && conversations.length === 0 && (
						<p className="px-2 py-8 text-center text-xs text-neutral-400">
							No conversations yet
						</p>
					)}

					<AnimatePresence initial={false}>
						{conversations.map((conversation) => (
							<motion.div
								key={conversation.id}
								className="min-w-0"
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.15 }}
							>
								<div
									className={`grid grid-cols-[minmax(0,1fr)_1.75rem] items-center rounded-lg transition-colors ${
										selectedId === conversation.id
											? "bg-neutral-100"
											: "hover:bg-neutral-50"
									}`}
									onMouseEnter={() => setHoveredId(conversation.id)}
									onMouseLeave={() => setHoveredId(null)}
								>
									<button
										type="button"
										className="min-w-0 overflow-hidden py-2.5 pl-3 pr-1 text-left"
										onClick={() => onSelect(conversation.id)}
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<p className="truncate text-sm font-medium text-neutral-800">
													{conversation.title}
												</p>
											</TooltipTrigger>
											<TooltipContent side="right" className="max-w-xs">
												{conversation.title}
											</TooltipContent>
										</Tooltip>
										<RelativeTime
											date={conversation.updated_at}
											className="mt-0.5 block text-xs text-neutral-400"
										/>
									</button>

									<div className="flex items-center justify-center">
										{hoveredId === conversation.id && (
											<button
												type="button"
												className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-600 hover:bg-neutral-200"
												aria-label={`Delete ${conversation.title}`}
												onClick={() => onDelete(conversation.id)}
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										)}
									</div>
								</div>
							</motion.div>
						))}
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}
