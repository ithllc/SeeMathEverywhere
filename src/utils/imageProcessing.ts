export interface CapturedImagePayload {
  dataUrl: string;
  base64Data: string;
  mimeType: string;
  width: number;
  height: number;
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.78;

function computeTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDim = MAX_DIMENSION
): { width: number; height: number } {
  if (srcWidth <= maxDim && srcHeight <= maxDim) {
    return { width: Math.round(srcWidth), height: Math.round(srcHeight) };
  }
  const ratio = srcWidth / srcHeight;
  if (srcWidth >= srcHeight) {
    return {
      width: maxDim,
      height: Math.max(1, Math.round(maxDim / ratio)),
    };
  }
  return {
    width: Math.max(1, Math.round(maxDim * ratio)),
    height: maxDim,
  };
}

/**
 * Captures the current frame from an active HTMLVideoElement, preserving aspect ratio
 * and compressing to a lightweight JPEG suitable for mobile cellular upload.
 */
export function captureFrameFromVideo(video: HTMLVideoElement): CapturedImagePayload {
  const srcWidth = video.videoWidth || 1280;
  const srcHeight = video.videoHeight || 960;
  const { width, height } = computeTargetDimensions(srcWidth, srcHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas context for photo capture.');
  }

  ctx.drawImage(video, 0, 0, width, height);
  const mimeType = 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, JPEG_QUALITY);
  const base64Data = dataUrl.split(',')[1] || '';

  return {
    dataUrl,
    base64Data,
    mimeType,
    width,
    height,
  };
}

/**
 * Loads an uploaded image File, respects EXIF camera orientation via createImageBitmap
 * when supported, and resizes/compresses before server upload.
 */
export async function compressUploadedImage(file: File): Promise<CapturedImagePayload> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid photo file (JPEG, PNG, or WebP).');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        throw new Error('Canvas unavailable.');
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const mimeType = 'image/jpeg';
      const dataUrl = canvas.toDataURL(mimeType, JPEG_QUALITY);
      return {
        dataUrl,
        base64Data: dataUrl.split(',')[1] || '',
        mimeType,
        width,
        height,
      };
    } catch {
      // Fall through to HTMLImageElement loader below
    }
  }

  return new Promise<CapturedImagePayload>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = computeTargetDimensions(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);

        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, JPEG_QUALITY);
        resolve({
          dataUrl,
          base64Data: dataUrl.split(',')[1] || '',
          mimeType,
          width,
          height,
        });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode the selected image. Please try another photo.'));
    };
    img.src = objectUrl;
  });
}
