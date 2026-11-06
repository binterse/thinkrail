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
	const editors = useEditors();
	const expanded = useAppStore((s) => selectFilesTreeView(s, workspaceId).expanded);
	const expandedPaths = useMemo(() => new Set(expanded), [expanded]);
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
	const revealRow =
		!isDir && focus.revealTarget === node.path
			? (row: HTMLButtonElement | null) => {
					if (!row) return;
					row.scrollIntoView({ block: "nearest" });
					focus.onRevealed();
				}
			: undefined;
	const [contextMenuGeneration, setContextMenuGeneration] = useState(0);
	const contextRequestKey = JSON.stringify([workspaceId, contextPath, contextMenuGeneration]);
	const [pathInfoResult, setPathInfoResult] = useState<{
		requestKey: string;
		absolutePath: string;
		kind: "file" | "dir";
	} | null>(null);
	const resolvedPath = pathInfoResult?.requestKey === contextRequestKey ? pathInfoResult : null;
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	useEffect(() => {
		if (!contextMenuOpen) return;
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
	}, [contextMenuOpen, contextMenuGeneration, contextRequestKey, contextPath, workspaceId, t]);

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
	const treeRow = (
		<TreeRow
			ref={revealRow}
			testid="file-node"
			kind={isDir ? "dir" : "file"}
			active={!isDir && focus.activePath === node.path}
			subtle={ignored}
			dataStatus={ignored ? "ignored" : undefined}
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
	const fileActionMenu: ReactNode = supportsFileActions ? (
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
