import "server-only";

import { v2 as cloudinary } from "cloudinary";

/**
 * The ONLY module that knows photos live in Cloudinary. Everything else deals
 * in `photoUrl` strings, so swapping to S3 or on-prem storage later is a
 * one-file change.
 *
 * Uploads are server-side exclusively — the API secret is read from the server
 * environment and never shipped to the browser. There are no unsigned/browser
 * uploads anywhere in this codebase.
 */

let configured = false;

function client() {
  if (!configured) {
    const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
    const api_key = process.env.CLOUDINARY_API_KEY;
    const api_secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud_name || !api_key || !api_secret) {
      throw new Error(
        "Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET).",
      );
    }

    cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    configured = true;
  }
  return cloudinary;
}

/** One deterministic id per student, so re-uploads replace the image in place. */
function publicId(studentId: number): string {
  return `xenon/students/${studentId}`;
}

export type PhotoUpload = {
  buffer: Buffer;
  /** Original mime, used only to reject non-images early. */
  type: string;
};

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Uploads (or replaces) a student's photo and returns the secure URL.
 *
 * The transformation is an INCOMING one: Cloudinary resizes before storing, so
 * we never keep the original camera image. `crop: "limit"` only ever shrinks,
 * so a small photo is left alone rather than upscaled.
 */
export async function uploadStudentPhoto(
  studentId: number,
  photo: PhotoUpload,
): Promise<string> {
  const api = client();

  const result = await new Promise<{ public_id: string; version: number }>(
    (resolve, reject) => {
      const stream = api.uploader.upload_stream(
        {
          public_id: publicId(studentId),
          overwrite: true,
          invalidate: true,
          resource_type: "image",
          // INCOMING transform: what actually gets stored. Resize + quality
          // only — deliberately no `fetch_format` here, which would leave the
          // stored format (and therefore the URL's extension) up to Cloudinary
          // and make a replacement land at a different path than the original.
          transformation: [
            { width: 400, height: 400, crop: "limit" },
            { quality: "auto" },
          ],
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            reject(error ?? new Error("Cloudinary upload failed."));
            return;
          }
          resolve(uploaded as { public_id: string; version: number });
        },
      );

      stream.end(photo.buffer);
    },
  );

  // DELIVERY transform: `f_auto` picks WebP/AVIF per browser at request time.
  // The version is included so replacing a photo busts any CDN/browser cache
  // of the previous one — without it, "replace in place" looks like a no-op.
  return api.url(result.public_id, {
    secure: true,
    resource_type: "image",
    version: result.version,
    transformation: [{ fetch_format: "auto", quality: "auto" }],
  });
}

/** Best-effort removal. Used to undo an upload when the surrounding write fails. */
export async function deleteStudentPhoto(studentId: number): Promise<void> {
  await client().uploader.destroy(publicId(studentId), {
    resource_type: "image",
    invalidate: true,
  });
}
