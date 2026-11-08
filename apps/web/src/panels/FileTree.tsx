import {
	RiCodeSSlashLine as Code,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderReveal,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { describeResource, PENDING_TEXT_META } from "@thinkrail/resource-renderers";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { statusLetter } from "../chat/planView";
import { copyText, firstClickOnly } from "../lib";
import {
	selectFilesTreeView,
	selectSupportsFileActions,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { type ChangeMarks, statusMarkClass } from "./changesModel";
import { holdEditorWarm, useEditorWarm, warmOnHover } from "./editorWarm";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";
import { useEditors } from "./workspaceActions";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;
type WarmFile = ((path: string) => void) | undefined;
type PreparedPathInfo = {
	menuId: string;
	workspaceId: string;
	path: string;
	promise: Promise<{ absolutePath: string; kind: "file" | "dir" }>;
};

const FILE_ACTION_ICON_SVGS = {
	vscode:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="ButtonText"><path d="M24 12L18.3431 17.6569L16.9289 16.2426L21.1716 12L16.9289 7.75736L18.3431 6.34315L24 12ZM2.82843 12L7.07107 16.2426L5.65685 17.6569L0 12L5.65685 6.34315L7.07107 7.75736L2.82843 12ZM9.78845 21H7.66009L14.2116 3H16.3399L9.78845 21Z"/></svg>',
	defaultApp:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="ButtonText"><path d="M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V11H19L18.9999 6.413L11.2071 14.2071L9.79289 12.7929L17.5849 5H13V3H21Z"/></svg>',
	reveal:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="ButtonText"><path d="M3 21C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H10.4142L12.4142 5H20C20.5523 5 21 5.44772 21 6V9H19V7H11.5858L9.58579 5H4V16.998L5.5 11H22.5L20.1894 20.2425C20.0781 20.6877 19.6781 21 19.2192 21H3ZM19.9384 13H7.06155L5.56155 19H18.4384L19.9384 13Z"/></svg>',
	copyPath:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="ButtonText"><path d="M6.9998 6V3C6.9998 2.44772 7.44752 2 7.9998 2H19.9998C20.5521 2 20.9998 2.44772 20.9998 3V17C20.9998 17.5523 20.5521 18 19.9998 18H16.9998V20.9991C16.9998 21.5519 16.5499 22 15.993 22H4.00666C3.45059 22 3 21.5554 3 20.9991L3.0026 7.00087C3.0027 6.44811 3.45264 6 4.00942 6H6.9998ZM5.00242 8L5.00019 20H14.9998V8H5.00242ZM8.9998 6H16.9998V16H18.9998V4H8.9998V6Z"/></svg>',
} as const;

interface TreeFocus {
	activePath: string | null;
	revealTarget: string | null;
	onRevealed: () => void;
}

export function FileTree({
	workspaceId,
	marks,
	...focus
}: TreeFocus & { workspaceId: string; marks: ChangeMarks }) {
	const t = useT();
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const supportsFileActions = useAppStore(selectSupportsFileActions);
	const nativeContextMenuSupported =
		typeof window !== "undefined" &&
		(window as Window & { __ELECTROBUN_WEBVIEW2_CONTEXT_MENU__?: unknown })
			.__ELECTROBUN_WEBVIEW2_CONTEXT_MENU__ === true;
	const usesNativeContextMenu = supportsFileActions && nativeContextMenuSupported;
	const editors = useEditors();
	const expanded = useAppStore((s) => selectFilesTreeView(s, workspaceId).expanded);
	const expandedPaths = useMemo(() => new Set(expanded), [expanded]);
	const activeContextMenuId = useRef<string | null>(null);
	const preparedPathInfo = useRef<PreparedPathInfo | null>(null);
	useEffect(() => {
		if (!usesNativeContextMenu) return;
		let mounted = true;
		const isCurrentMenu = (menuId: string) => mounted && activeContextMenuId.current === menuId;
		const onNativeContextMenuOpen = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const detail = event.detail;
			if (typeof detail !== "object" || detail === null) return;
			const { menuId, payload } = detail as { menuId?: unknown; payload?: unknown };
			if (typeof menuId !== "string" || typeof payload !== "object" || payload === null) return;
			const target = payload as { workspaceId?: unknown; path?: unknown };
			if (target.workspaceId !== workspaceId || typeof target.path !== "string") return;

			activeContextMenuId.current = menuId;
			const promise = getTransport().request("fs.pathInfo", { workspaceId, path: target.path });
			preparedPathInfo.current = { menuId, workspaceId, path: target.path, promise };
			void promise.catch(() => {});
		};
		const onNativeContextMenuAction = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const detail = event.detail;
			if (typeof detail !== "object" || detail === null) return;
			const { id, menuId, payload } = detail as {
				id?: unknown;
				menuId?: unknown;
				payload?: unknown;
			};
			if (
				typeof id !== "string" ||
				typeof menuId !== "string" ||
				!isCurrentMenu(menuId) ||
				typeof payload !== "object" ||
				payload === null
			)
				return;
			const target = payload as { workspaceId?: unknown; path?: unknown };
			if (target.workspaceId !== workspaceId || typeof target.path !== "string") return;

			if (id === "copyPath") {
				const prepared = preparedPathInfo.current;
				const pathInfo =
					prepared?.menuId === menuId &&
					prepared.workspaceId === workspaceId &&
					prepared.path === target.path
						? prepared.promise
						: getTransport().request("fs.pathInfo", { workspaceId, path: target.path });
				void pathInfo
					.then((info) => copyText(info.absolutePath))
					.then((copied) => {
						if (!isCurrentMenu(menuId)) return;
						if (!copied) toast.error(t("panels.fileTree.copyFailed"));
					})
					.catch(() => {
						if (isCurrentMenu(menuId)) toast.error(t("panels.fileTree.pathUnavailable"));
					});
				return;
			}
			const action =
				id === "vscode"
					? "vscode"
					: id === "default"
						? "default"
						: id === "reveal"
							? "reveal"
							: null;
			if (!action) return;
			void getTransport()
				.request("fs.open", { workspaceId, path: target.path, action })
				.catch(() => {
					if (isCurrentMenu(menuId)) toast.error(t("panels.fileTree.actionFailed"));
				});
		};
		window.addEventListener("electrobun-context-menu-open", onNativeContextMenuOpen);
		window.addEventListener("electrobun-context-menu-action", onNativeContextMenuAction);
		return () => {
			mounted = false;
			activeContextMenuId.current = null;
			preparedPathInfo.current = null;
			window.removeEventListener("electrobun-context-menu-open", onNativeContextMenuOpen);
			window.removeEventListener("electrobun-context-menu-action", onNativeContextMenuAction);
		};
	}, [usesNativeContextMenu, workspaceId, t]);
	const warm = useEditorWarm();
	const warmFile: WarmFile = warm
		? (path) => warm(describeResource(workspaceId, path, PENDING_TEXT_META))
		: undefined;

	const setPathsExpanded: SetPathsExpanded = (paths, next) =>
		useAppStore.getState().setFilesTreeExpanded(workspaceId, paths, next);

	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: "." }),
		{
			onResult: (result) => setNodes(result),
			onFailure: () => setNodes((prev) => prev ?? []),
			onSwitch: () => setNodes(null),
		},
	);

	const loading = nodes === null;
	useEffect(() => (loading ? holdEditorWarm() : undefined), [loading]);

	if (nodes === null) return <LoadingRegion rows={8} className="px-4 py-4" />;
	if (nodes.length === 0)
		return (
			<p className="px-4 py-4 tr-text-metadata text-text-muted">{t("panels.fileTree.empty")}</p>
		);
	return (
		<ul className="flex flex-col motion-safe:animate-reveal">
			{nodes.map((node) => (
				<FileNodeRow
					key={node.path}
					node={node}
					workspaceId={workspaceId}
					marks={marks}
					focus={focus}
					supportsFileActions={supportsFileActions}
					usesNativeContextMenu={usesNativeContextMenu}
					hasVsCode={editors.some((editor) => editor.id === "vscode")}
					expandedPaths={expandedPaths}
					setPathsExpanded={setPathsExpanded}
					warmFile={warmFile}
				/>
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	workspaceId,
	marks,
	focus,
	supportsFileActions,
	usesNativeContextMenu,
	hasVsCode,
	expandedPaths,
	setPathsExpanded,
	warmFile,
}: {
	node: FileNode;
	workspaceId: string;
	marks: ChangeMarks;
	focus: TreeFocus;
	supportsFileActions: boolean;
	usesNativeContextMenu: boolean;
	hasVsCode: boolean;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
	warmFile: WarmFile;
}) {
	const t = useT();
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	const pendingExpand = useRef(false);

	const { reload } = useWorkspaceRead(
		isDir ? workspaceId : null,
		(id) =>
			resolveFolderChain(node, (path) =>
				getTransport().request("fs.readDir", { workspaceId: id, path }),
			),
		{
			onResult: (result) => {
				setDirectory(result);
				if (!pendingExpand.current) return;
				pendingExpand.current = false;
				setPathsExpanded(result.paths, true);
			},
			onSwitch: () => {
				pendingExpand.current = false;
				setDirectory(null);
			},
		},
	);

	const label = directory?.label ?? node.name;
	const representedPaths = directory?.paths ?? [node.path];
	const expanded = expandedPaths.has(directory?.path ?? node.path);
	const children = directory?.children ?? null;
	const toggleDirectory = () => {
		const nextExpanded = !expanded;
		pendingExpand.current = nextExpanded && directory === null;
		setPathsExpanded(representedPaths, nextExpanded);
		if (nextExpanded) reload();
	};
	const open = (intent: TabIntent) => void openFileInTab(workspaceId, node.path, intent);
	const fileStatus = isDir ? undefined : marks.files.get(node.path);
	const dirChanged = isDir && marks.dirs.has(directory?.path ?? node.path);
	const ignored = (directory?.deepest ?? node).gitignored === true;
	const contextPath = isDir ? (directory?.path ?? node.path) : node.path;
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const nativeContextMenuData = usesNativeContextMenu
		? JSON.stringify({
				items: [
					{
						id: "vscode",
						label: t("panels.fileTree.openInVsCode"),
						enabled: hasVsCode,
						iconSvg: FILE_ACTION_ICON_SVGS.vscode,
					},
					{
						id: "default",
						label: t("panels.fileTree.openWithDefaultApp"),
						iconSvg: FILE_ACTION_ICON_SVGS.defaultApp,
					},
					{
						id: "reveal",
						label: t(
							hostPlatform === "win32"
								? "panels.fileTree.revealInWindowsExplorer"
								: "panels.fileTree.revealInFileManager",
						),
						iconSvg: FILE_ACTION_ICON_SVGS.reveal,
					},
					{
						id: "copyPath",
						label: t("panels.fileTree.copyAbsolutePath"),
						iconSvg: FILE_ACTION_ICON_SVGS.copyPath,
					},
				],
				payload: { workspaceId, path: contextPath },
			})
		: undefined;
	const showRadixFileMenu = supportsFileActions && !usesNativeContextMenu;
	const [contextMenuGeneration, setContextMenuGeneration] = useState(0);
	const contextRequestKey = JSON.stringify([workspaceId, contextPath, contextMenuGeneration]);
	const [pathInfoResult, setPathInfoResult] = useState<{
		requestKey: string;
		absolutePath: string;
		kind: "file" | "dir";
	} | null>(null);
	const resolvedPath = pathInfoResult?.requestKey === contextRequestKey ? pathInfoResult : null;
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	useEffect(() => {
		if (!showRadixFileMenu || !contextMenuOpen) return;
		let current = true;
		void getTransport()
			.request("fs.pathInfo", { workspaceId, path: contextPath })
			.then((info) => {
				if (current) setPathInfoResult({ requestKey: contextRequestKey, ...info });
			})
			.catch(() => {
				if (current) toast.error(t("panels.fileTree.pathUnavailable"));
			});
		return () => {
			current = false;
		};
	}, [
		showRadixFileMenu,
		contextMenuOpen,
		contextMenuGeneration,
		contextRequestKey,
		contextPath,
		workspaceId,
		t,
	]);

	const runAction = (action: "vscode" | "default" | "reveal") => {
		if (!resolvedPath) return;
		void getTransport()
			.request("fs.open", { workspaceId, path: contextPath, action })
			.catch(() => toast.error(t("panels.fileTree.actionFailed")));
	};
	const copyAbsolutePath = () => {
		if (!resolvedPath) return;
		void copyText(resolvedPath.absolutePath).then((copied) => {
			if (!copied) toast.error(t("panels.fileTree.copyFailed"));
		});
	};
	const revealRow =
		!isDir && focus.revealTarget === node.path
			? (row: HTMLButtonElement | null) => {
					if (!row) return;
					row.scrollIntoView({ block: "nearest" });
					focus.onRevealed();
				}
			: undefined;
	const treeRow = (
		<TreeRow
			ref={revealRow}
			testid="file-node"
			kind={isDir ? "dir" : "file"}
			active={!isDir && focus.activePath === node.path}
			subtle={ignored}
			dataStatus={ignored ? "ignored" : undefined}
			nativeContextMenuData={nativeContextMenuData}
			expanded={expanded}
			label={label}
			labelClassName={
				fileStatus ? statusMarkClass(fileStatus) : dirChanged ? statusMarkClass("modified") : ""
			}
			trailing={
				fileStatus ? (
					<span
						data-testid="file-status"
						className={`shrink-0 tr-text-metadata ${statusMarkClass(fileStatus)}`}
					>
						{statusLetter(fileStatus)}
					</span>
				) : dirChanged ? (
					<span
						data-testid="file-folder-dot"
						className="mr-4 size-6 shrink-0 rounded-full bg-feedback-warning"
					/>
				) : undefined
			}
			onClick={isDir ? toggleDirectory : firstClickOnly(() => open("preview"))}
			onDoubleClick={isDir ? undefined : () => open("keep")}
			onWarm={
				isDir || !warmFile
					? undefined
					: (trigger) =>
							trigger === "focus" ? warmFile(node.path) : warmOnHover(() => warmFile(node.path))
			}
		/>
	);
	const fileActionMenu: ReactNode = showRadixFileMenu ? (
		<ContextMenu
			open={contextMenuOpen}
			onOpenChange={(open) => {
				setContextMenuOpen(open);
				if (open) setContextMenuGeneration((generation) => generation + 1);
			}}
		>
			<ContextMenuTrigger
				asChild
				onKeyDown={(event) => {
					if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					event.currentTarget.dispatchEvent(
						new MouseEvent("contextmenu", {
							bubbles: true,
							clientX: rect.left,
							clientY: rect.bottom,
						}),
					);
				}}
			>
				{treeRow}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="file-actions">
				<ContextMenuItem
					data-testid="file-menu-vscode"
					disabled={!hasVsCode || resolvedPath === null}
					onSelect={() => runAction("vscode")}
				>
					<Code />
					{t("panels.fileTree.openInVsCode")}
				</ContextMenuItem>
				<ContextMenuItem
					data-testid="file-menu-default-app"
					disabled={resolvedPath === null}
					onSelect={() => runAction("default")}
				>
					<ExternalLink />
					{t("panels.fileTree.openWithDefaultApp")}
				</ContextMenuItem>
				<ContextMenuItem
					data-testid="file-menu-reveal"
					disabled={resolvedPath === null}
					onSelect={() => runAction("reveal")}
				>
					<FolderReveal />
					{t(
						hostPlatform === "win32"
							? "panels.fileTree.revealInWindowsExplorer"
							: "panels.fileTree.revealInFileManager",
					)}
				</ContextMenuItem>
				<ContextMenuItem
					data-testid="file-menu-copy-path"
					disabled={resolvedPath === null}
					onSelect={copyAbsolutePath}
				>
					<Copy />
					{t("panels.fileTree.copyAbsolutePath")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	) : (
		treeRow
	);
	return (
		<li>
			{fileActionMenu}
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-tree-indent">
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							workspaceId={workspaceId}
							marks={marks}
							focus={focus}
							supportsFileActions={supportsFileActions}
							usesNativeContextMenu={usesNativeContextMenu}
							hasVsCode={hasVsCode}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
							warmFile={warmFile}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
