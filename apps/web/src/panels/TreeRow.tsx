import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileFill,
	RiFileLine,
	RiFolderFill,
	RiFolderLine,
} from "@remixicon/react";
import type { KeyboardEventHandler, MouseEvent, PointerEventHandler, ReactNode, Ref } from "react";

export function TreeRow({
	ref,
	testid,
	kind,
	expanded,
	active,
	subtle = false,
	dataStatus,
	dataViewed,
	nativeContextMenuData,
	label,
	labelClassName,
	trailing,
	highlight = "self",
	onClick,
	onDoubleClick,
	onContextMenu,
	onKeyDown,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onWarm,
}: {
	ref?: Ref<HTMLButtonElement> | undefined;
	testid: string;
	kind: "dir" | "file";
	expanded?: boolean;
	active?: boolean;
	subtle?: boolean;
	dataStatus?: string | undefined;
	dataViewed?: boolean;
	nativeContextMenuData?: string | undefined;
	label: string;
	labelClassName?: string;
	trailing?: ReactNode;
	highlight?: "self" | "wrapper";
	onClick?: ((event: MouseEvent) => void) | undefined;
	onDoubleClick?: (() => void) | undefined;
	onContextMenu?: ((event: MouseEvent) => void) | undefined;
	onKeyDown?: KeyboardEventHandler<HTMLButtonElement> | undefined;
	onPointerDown?: PointerEventHandler<HTMLButtonElement> | undefined;
	onPointerMove?: PointerEventHandler<HTMLButtonElement> | undefined;
	onPointerUp?: PointerEventHandler<HTMLButtonElement> | undefined;
	onPointerCancel?: PointerEventHandler<HTMLButtonElement> | undefined;
	onWarm?: ((trigger: "hover" | "focus") => void) | undefined;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const Folder = active ? RiFolderFill : RiFolderLine;
	const FileIcon = active ? RiFileFill : RiFileLine;
	const tone = subtle ? "text-text-subtle" : "text-text-muted";
	return (
		<button
			ref={ref}
			type="button"
			data-testid={testid}
			data-kind={kind}
			data-active={active ? true : undefined}
			data-status={dataStatus}
			data-viewed={dataViewed ? true : undefined}
			data-electrobun-context-menu={nativeContextMenuData}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onPointerEnter={onWarm && (() => onWarm("hover"))}
			onFocus={onWarm && (() => onWarm("focus"))}
			className={`flex h-panel-row w-full min-w-0 items-center gap-4 rounded-sm px-4 text-left tr-text-ui ${tone} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
				highlight === "self"
					? `hover:bg-control-bg-hovered ${active ? "bg-control-bg-selected" : ""}`
					: ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className={`size-16 shrink-0 ${tone}`} />
			) : (
				<span className="size-14 shrink-0" />
			)}
			<span className="flex min-w-0 flex-1 items-center gap-4">
				{kind === "dir" ? (
					<Folder className={`size-14 shrink-0 ${tone}`} />
				) : (
					<FileIcon className={`size-14 shrink-0 ${tone}`} />
				)}
				<span className={`min-w-0 flex-1 truncate ${labelClassName ?? ""}`}>{label}</span>
			</span>
			{trailing}
		</button>
	);
}
