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
	openContextMenuFromKeyboard,
} from "@thinkrail/ui/context-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { statusLetter } from "../chat/planView";
import { copyText, firstClickOnly, joinWorkspacePath } from "../lib";
import {
	selectFilesTreeView,
	selectSupportsFileActions,
	selectWorkspaceById,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { type ChangeMarks, statusMarkClass } from "./changesModel";
import { holdEditorWarm, useEditorWarm, warmOnHover } from "./editorWarm";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { FILE_ACTION_ICON_PNGS } from "./nativeFileContextMenuIcons";
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

			if (id === "copyRelativePath") {
				void copyText(target.path).then((copied) => {
					if (isCurrentMenu(menuId) && !copied) toast.error(t("panels.fileTree.copyFailed"));
				});
				return;
			}
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
						iconPngLight: FILE_ACTION_ICON_PNGS.vscode.light,
						iconPngDark: FILE_ACTION_ICON_PNGS.vscode.dark,
					},
					{
						id: "default",
						label: t("panels.fileTree.openWithDefaultApp"),
						iconPngLight: FILE_ACTION_ICON_PNGS.defaultApp.light,
						iconPngDark: FILE_ACTION_ICON_PNGS.defaultApp.dark,
					},
					{
						id: "reveal",
						label: t(
							hostPlatform === "win32"
								? "panels.fileTree.revealInWindowsExplorer"
								: "panels.fileTree.revealInFileManager",
						),
						iconPngLight: FILE_ACTION_ICON_PNGS.reveal.light,
						iconPngDark: FILE_ACTION_ICON_PNGS.reveal.dark,
					},
					{
						id: "copyPath",
						label: t("panels.fileTree.copyAbsolutePath"),
						iconPngLight: FILE_ACTION_ICON_PNGS.copyPath.light,
						iconPngDark: FILE_ACTION_ICON_PNGS.copyPath.dark,
					},
					{
						id: "copyRelativePath",
						label: t("panels.fileTree.copyRelativePath"),
						iconPngLight: FILE_ACTION_ICON_PNGS.copyPath.light,
						iconPngDark: FILE_ACTION_ICON_PNGS.copyPath.dark,
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
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
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
					data-testid="file-copy-path"
					disabled={resolvedPath === null}
					onSelect={copyAbsolutePath}
				>
					<Copy />
					<span data-testid="file-menu-copy-path">{t("panels.fileTree.copyAbsolutePath")}</span>
				</ContextMenuItem>
				<ContextMenuItem
					data-testid="file-copy-relative-path"
					onSelect={() => void copyText(contextPath)}
				>
					<Copy />
					{t("panels.fileTree.copyRelativePath")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	) : (
		treeRow
	);
	return (
		<li>
			{showRadixFileMenu ? (
				fileActionMenu
			) : usesNativeContextMenu ? (
				treeRow
			) : (
				<FileTreeMenu workspaceId={workspaceId} path={directory?.path ?? node.path}>
					{treeRow}
				</FileTreeMenu>
			)}
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

function FileTreeMenu({
	workspaceId,
	path,
	children,
}: {
	workspaceId: string;
	path: string;
	children: ReactElement;
}) {
	const t = useT();
	const copyPath = (absolute: boolean) => {
		const worktreePath = selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath;
		void copyText(absolute ? joinWorkspacePath(worktreePath ?? "", path) : path);
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="file-tree-actions">
				<ContextMenuItem data-testid="file-copy-path" onSelect={() => copyPath(true)}>
					<Copy />
					{t("panels.fileTree.copyPath")}
				</ContextMenuItem>
				<ContextMenuItem data-testid="file-copy-relative-path" onSelect={() => copyPath(false)}>
					<Copy />
					{t("panels.fileTree.copyRelativePath")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
