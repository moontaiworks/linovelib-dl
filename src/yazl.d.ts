declare module "yazl" {
  import { Buffer } from "node:buffer";
  import { Readable } from "node:stream";

  export class ZipFile {
    readonly outputStream: Readable;
    addBuffer(
      buffer: Buffer,
      metadataPath: string,
      options?: {
        compress?: boolean;
      },
    ): void;
    end(): void;
  }

  const yazl: {
    ZipFile: typeof ZipFile;
  };

  export default yazl;
}
