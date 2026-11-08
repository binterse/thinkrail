import copyPathDark from "./file-context-menu-icons/copy-path-dark.png?inline";
import copyPathLight from "./file-context-menu-icons/copy-path-light.png?inline";
import defaultAppDark from "./file-context-menu-icons/default-app-dark.png?inline";
import defaultAppLight from "./file-context-menu-icons/default-app-light.png?inline";
import revealDark from "./file-context-menu-icons/reveal-dark.png?inline";
import revealLight from "./file-context-menu-icons/reveal-light.png?inline";
import vscodeDark from "./file-context-menu-icons/vscode-dark.png?inline";
import vscodeLight from "./file-context-menu-icons/vscode-light.png?inline";

function pngDataUrlToBase64(dataUrl: string): string {
	const separator = dataUrl.indexOf(",");
	return separator < 0 ? "" : dataUrl.slice(separator + 1);
}

export const FILE_ACTION_ICON_PNGS = {
	vscode: { light: pngDataUrlToBase64(vscodeLight), dark: pngDataUrlToBase64(vscodeDark) },
	defaultApp: {
		light: pngDataUrlToBase64(defaultAppLight),
		dark: pngDataUrlToBase64(defaultAppDark),
	},
	reveal: { light: pngDataUrlToBase64(revealLight), dark: pngDataUrlToBase64(revealDark) },
	copyPath: { light: pngDataUrlToBase64(copyPathLight), dark: pngDataUrlToBase64(copyPathDark) },
} as const;
