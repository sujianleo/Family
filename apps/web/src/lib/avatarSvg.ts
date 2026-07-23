import path from "node:path";
import sharp from "sharp";
import { avatarSlotForSeed } from "./avatarCatalog";

const avatarCropBoxes = [
  [70, 70, 350, 350], [365, 70, 645, 350], [650, 70, 930, 350], [925, 70, 1205, 350],
  [76, 360, 356, 640], [365, 360, 645, 640], [651, 360, 931, 640], [920, 360, 1200, 640],
  [70, 650, 380, 950], [365, 650, 645, 930], [650, 685, 930, 965], [925, 650, 1205, 930],
  [65, 940, 345, 1220], [358, 940, 638, 1220], [640, 940, 920, 1220], [920, 940, 1200, 1220]
] as const;
const avatarCache = new Map<string, Promise<Buffer>>();
const avatarInsetTop = 10;
const avatarOutputInset = 2;

export function buildLocalAvatarPng(seed: string, variant: "color" | "mono" = "color"): Promise<Buffer> {
  const slot = avatarSlotForSeed(seed);
  const cacheKey = `v19:${variant}:${slot}`;
  const cached = avatarCache.get(cacheKey);
  if (cached) return cached;

  if (variant === "mono") {
    const generated: Promise<Buffer> = buildLocalAvatarPng(seed, "color")
      .then((colorAvatar) => sharp(colorAvatar).grayscale().png({ compressionLevel: 9 }).toBuffer());
    avatarCache.set(cacheKey, generated);
    return generated;
  }

  const [left, top, right, bottom] = avatarCropBoxes[slot];
  const generated = (async () => {
    const croppedAvatar = await sharp(path.join(process.cwd(), "public", "source-assets", "family-avatar-set-color-original.png"))
      .extract({ left, top: top + avatarInsetTop, width: right - left, height: bottom - top - avatarInsetTop })
      .png()
      .toBuffer();
    return sharp(croppedAvatar)
      .resize(80 - avatarOutputInset * 2, 80 - avatarOutputInset * 2, { fit: "contain", background: "#ffffff", kernel: "lanczos3" })
      .extend({
        top: avatarOutputInset,
        bottom: avatarOutputInset,
        left: avatarOutputInset,
        right: avatarOutputInset,
        background: "#ffffff"
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  })();
  avatarCache.set(cacheKey, generated);
  return generated;
}
