export const MAX_SOURCING_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

export function validateSourcingAttachment(file: { name: string; type: string; size: number }): string | null {
  if (!file.name || file.name.length > 255) return "File name is invalid";
  if (!allowedMimeTypes.has(file.type)) return "Only images, PDFs, and spreadsheet files are allowed";
  if (file.size <= 0) return "File is empty";
  if (file.size > MAX_SOURCING_ATTACHMENT_SIZE) return "File size exceeds the 10MB limit";
  return null;
}
