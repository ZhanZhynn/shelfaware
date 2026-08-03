import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

function databaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!name || name.includes("/")) throw new Error("DATABASE_URL must include one database name");
  return name;
}

async function bucket() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for sourcing attachments");
  clientPromise ??= new MongoClient(databaseUrl).connect();
  return new GridFSBucket((await clientPromise).db(databaseName(databaseUrl)), {
    bucketName: "sourcing_attachments",
  });
}

export async function storeSourcingAttachment(fileName: string, mimeType: string, content: Buffer): Promise<string> {
  const upload = (await bucket()).openUploadStream(fileName, { metadata: { mimeType } });
  await new Promise<void>((resolve, reject) => {
    upload.once("error", reject);
    upload.once("finish", () => resolve());
    upload.end(content);
  });
  return upload.id.toHexString();
}

export async function readSourcingAttachment(fileId: string): Promise<Buffer> {
  const id = new ObjectId(fileId);
  const stream = (await bucket()).openDownloadStream(id);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return Buffer.concat(chunks);
}

export async function deleteStoredSourcingAttachment(fileId: string): Promise<void> {
  await (await bucket()).delete(new ObjectId(fileId));
}
