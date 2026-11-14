import {
	RiAddLine as Add,
	RiArrowDownSLine as Down,
	RiCloseLine as Remove,
	RiGitBranchLine as Route,
	RiArrowUpSLine as Up,
} from "@remixicon/react";
import type {
	ModelFallbackModelRef,
	ModelFallbackProjectOverride,
	ModelFallbackSettings,
	WireModel,
} from "@thinkrail/contracts";
import { MODEL_FALLBACK_MODELS_LIMIT, sameModel, WS_CHANNELS } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { Switch } from "@thinkrail/ui/switch";
import { useEffect, useMemo, useState } from "react";
import { getTransport } from "@/transport";

type ProjectMode = "inherit" | "disabled" | "custom";
const PROJECT_MODES = [
	{ mode: "inherit", labelKey: "chat.modelFallback.mode.inherit" },
	{ mode: "disabled", labelKey: "chat.modelFallback.mode.disabled" },
	{ mode: "custom", labelKey: "chat.modelFallback.mode.custom" },
] as const;

function projectMode(override: ModelFallbackProjectOverride | undefined): ProjectMode {
	if (!override) return "inherit";
	return override.mode === "disabled" ? "disabled" : "custom";
}

function ListEditor({
	models,
	options,
	disabled,
	onChange,
}: {
	models: ModelFallbackModelRef[];
	options: WireModel[];
	disabled: boolean;
	onChange: (models: ModelFallbackModelRef[]) => void;
}) {
	const t = useT();
	const [addOpen, setAddOpen] = useState(false);
	const available = useMemo(
		() => options.filter((model) => !models.some((entry) => sameModel(entry, model))),
		[models, options],
	);
	const atLimit = models.length >= MODEL_FALLBACK_MODELS_LIMIT;
	const move = (index: number, offset: number) => {
		const target = index + offset;
		if (target < 0 || target >= models.length) return;
		const currentModel = models[index];
		const targetModel = models[target];
		if (!currentModel || !targetModel) return;
		const next = [...models];
		next[index] = targetModel;
		next[target] = currentModel;
		onChange(next);
	};
	return (
		<div className="flex flex-col gap-8">
			{models.length ? (
				<ol className="flex flex-col gap-4" data-testid="fallback-model-list">
					{models.map((model, index) => (
						<li
							key={`${model.provider}/${model.id}`}
							className="flex min-w-0 items-center gap-4 rounded-sm border border-border-muted bg-container-elevated-bg px-8 py-4"
						>
							<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
								{options.find((option) => sameModel(option, model))?.name ??
									`${model.provider}/${model.id}`}
								<span className="ml-4 text-text-subtle tr-text-metadata">{model.provider}</span>
							</span>
							<IconButton
								icon={Up}
								label={t("chat.modelFallback.moveUp")}
								disabled={disabled || index === 0}
								onClick={() => move(index, -1)}
							/>
							<IconButton
								icon={Down}
								label={t("chat.modelFallback.moveDown")}
								disabled={disabled || index === models.length - 1}
								onClick={() => move(index, 1)}
							/>
							<IconButton
								icon={Remove}
								label={t("chat.modelFallback.remove")}
								disabled={disabled}
								onClick={() => onChange(models.filter((_, i) => i !== index))}
							/>
						</li>
					))}
				</ol>
			) : (
				<p className="text-text-subtle tr-text-metadata">{t("chat.modelFallback.empty")}</p>
			)}
			<Popover open={addOpen} onOpenChange={(next) => !disabled && setAddOpen(next)}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="s"
						iconLeft={Add}
						disabled={disabled || atLimit || available.length === 0}
					>
						{t("chat.modelFallback.add")}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(22rem,80vw)] p-0">
					<Command>
						<CommandInput placeholder={t("chat.modelFallback.search")} />
						<CommandList>
							<CommandEmpty>{t("chat.modelFallback.noModels")}</CommandEmpty>
							<CommandGroup>
								{available.map((model) => (
									<CommandItem
										key={`${model.provider}/${model.id}`}
										value={`${model.name} ${model.provider} ${model.id}`}
										onSelect={() => {
											onChange([...models, { provider: model.provider, id: model.id }]);
											setAddOpen(false);
										}}
									>
										<span className="truncate">{model.name}</span>
										<span className="ml-auto text-text-subtle tr-text-metadata">
											{model.provider}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{atLimit ? (
				<p className="text-text-subtle tr-text-metadata">
					{t("chat.modelFallback.limitReached", { count: MODEL_FALLBACK_MODELS_LIMIT })}
				</p>
			) : null}
		</div>
	);
}

export function ModelFallbackControl({
	workspaceId,
	projectId,
	models,
}: {
	workspaceId: string;
	projectId: string | null;
	models: WireModel[];
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [settings, setSettings] = useState<ModelFallbackSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (!open) return;
		let current = true;
		const transport = getTransport();
		const unsubscribe = transport.subscribe(WS_CHANNELS.modelFallbackChanged, (data) => {
			if (current) setSettings(data as ModelFallbackSettings);
		});
		void transport.request("modelFallback.get", { workspaceId }).then(
			(result) => {
				if (current) setSettings(result.settings);
			},
			() => {
				if (current) setError(t("chat.modelFallback.loadFailed"));
			},
		);
		return () => {
			current = false;
			unsubscribe();
		};
	}, [open, t, workspaceId]);

	const save = (next: ModelFallbackSettings) => {
		setError(null);
		setSaving(true);
		void getTransport()
			.request("modelFallback.update", { settings: next })
			.then(setSettings)
			.catch(() => setError(t("chat.modelFallback.saveFailed")))
			.finally(() => setSaving(false));
	};
	const override = projectId ? settings?.projects[projectId] : undefined;
	const mode = projectMode(override);
	const customModels = override?.mode === "custom" ? (override.models ?? []) : [];
	const setProjectMode = (nextMode: ProjectMode) => {
		if (!settings || !projectId) return;
		const projects = { ...settings.projects };
		if (nextMode === "inherit") delete projects[projectId];
		else if (nextMode === "disabled") projects[projectId] = { mode: "disabled" };
		else projects[projectId] = { mode: "custom", models: [...settings.models] };
		save({ ...settings, projects });
	};
	const setProjectModels = (nextModels: ModelFallbackModelRef[]) => {
		if (!settings || !projectId) return;
		save({
			...settings,
			projects: { ...settings.projects, [projectId]: { mode: "custom", models: nextModels } },
		});
	};
	return (
		<>
			<IconButton
				icon={Route}
				label={t("chat.modelFallback.button")}
				tooltip={t("chat.modelFallback.button")}
				size="m"
				onClick={() => setOpen(true)}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[85vh] max-w-[36rem] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("chat.modelFallback.title")}</DialogTitle>
						<DialogDescription>{t("chat.modelFallback.description")}</DialogDescription>
					</DialogHeader>
					{settings ? (
						<div className="flex flex-col gap-16">
							<div className="flex items-center justify-between gap-12">
								<span className="text-text-default tr-text-ui">
									{t("chat.modelFallback.globalEnabled")}
								</span>
								<Switch
									checked={settings.enabled}
									label={t("chat.modelFallback.globalEnabled")}
									disabled={saving}
									onCheckedChange={(enabled) => save({ ...settings, enabled })}
								/>
							</div>
							<div className="flex flex-col gap-8">
								<h3 className="text-text-default tr-text-emphasis">
									{t("chat.modelFallback.globalList")}
								</h3>
								<ListEditor
									models={settings.models}
									options={models}
									disabled={saving}
									onChange={(nextModels) => save({ ...settings, models: nextModels })}
								/>
							</div>
							{projectId ? (
								<div className="flex flex-col gap-8 border-border-muted border-t pt-12">
									<h3 className="text-text-default tr-text-emphasis">
										{t("chat.modelFallback.project")}
									</h3>
									<fieldset className="flex flex-wrap gap-4">
										<legend className="sr-only">{t("chat.modelFallback.projectMode")}</legend>
										{PROJECT_MODES.map(({ mode: option, labelKey }) => (
											<Button
												key={option}
												variant="outline"
												size="s"
												selected={mode === option}
												disabled={saving}
												onClick={() => setProjectMode(option)}
											>
												{t(labelKey)}
											</Button>
										))}
									</fieldset>
									{mode === "custom" ? (
										<ListEditor
											models={customModels}
											options={models}
											disabled={saving}
											onChange={setProjectModels}
										/>
									) : null}
								</div>
							) : null}
							{error ? (
								<p role="alert" className="text-feedback-error tr-text-metadata">
									{error}
								</p>
							) : null}
						</div>
					) : error ? (
						<p role="alert" className="text-feedback-error tr-text-metadata">
							{error}
						</p>
					) : (
						<p className="text-text-subtle tr-text-metadata">{t("chat.modelFallback.loading")}</p>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
