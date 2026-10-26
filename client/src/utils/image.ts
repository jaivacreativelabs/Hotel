/** Menu photos are shown as small tiles, so phone-camera originals are shrunk before upload. */
const MAX_SIDE = 800;
const SMALL_ENOUGH = 200 * 1024;

/**
 * Returns a WebP no larger than 800 px on its longest side (about 50–150 KB), or the original
 * file when it is already small or the browser cannot re-encode it.
 */
export async function shrinkImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  // Browsers without WebP encoding return PNG here, which can be larger – keep the original then.
  if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
}
