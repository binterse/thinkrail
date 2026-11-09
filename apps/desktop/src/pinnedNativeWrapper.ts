import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

export type PinnedNativeWrapperAsset = { url: string; sha256: string };
type FetchAsset = (url: string) => Promise<Response>;

export async function installPinnedNativeWrapper(
	targetPath: string,
	asset: PinnedNativeWrapperAsset,
	fetchAsset: FetchAsset = fetch,
) {
	const response = await fetchAsset(asset.url);
	if (!response.ok)
		throw new Error(`could not download the pinned WebView2 wrapper (${response.status})`);

	const bytes = Buffer.from(await response.arrayBuffer());
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (sha256 !== asset.sha256) {
		throw new Error(`pinned WebView2 wrapper SHA-256 mismatch: received ${sha256}`);
	}

	writeFileSync(targetPath, bytes);
	console.log(`installed pinned WebView2 context-menu wrapper ${sha256}`);
}
