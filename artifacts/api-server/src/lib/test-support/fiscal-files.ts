type StoredObject = { type: string; bytes: Buffer };
const objects = new Map<string, StoredObject>();
export let lastObject: { bucket: string; name: string } | undefined;

export function reset() {
  objects.clear();
  lastObject = undefined;
}

export function setObject(bucket: string, name: string, type: string, bytes: Buffer) {
  objects.set(`${bucket}/${name}`, { type, bytes: Buffer.from(bytes) });
}

export class File {
  private readonly bucket: string;
  private readonly name: string;

  constructor(bucket: string, name: string) {
    this.bucket = bucket;
    this.name = name;
  }

  private get stored() {
    lastObject = { bucket: this.bucket, name: this.name };
    const item = objects.get(`${this.bucket}/${this.name}`);
    if (!item) throw new Error("Object not found in in-memory storage fixture.");
    return item;
  }

  async getMetadata() {
    const item = this.stored;
    return [{ size: item.bytes.length, contentType: item.type }];
  }

  async download() {
    return [Buffer.from(this.stored.bytes)];
  }

  async save(bytes: Buffer, options: { metadata: { contentType: string } }) {
    objects.set(`${this.bucket}/${this.name}`, {
      type: options.metadata.contentType,
      bytes: Buffer.from(bytes),
    });
  }
}

export class Storage {
  bucket(bucketName: string) {
    return {
      file: (objectName: string) => new File(bucketName, objectName),
    };
  }
}
