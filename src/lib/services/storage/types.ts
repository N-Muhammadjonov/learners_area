export type UploadInput = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  folder: string; // e.g. "speaking"
};

export type UploadResult = {
  url: string; // fully-qualified, publicly reachable
  key: string; // storage key/path, needed later to delete the object
};

export type PresignedUpload = {
  uploadUrl: string; // browser PUTs the file bytes directly here
  publicUrl: string; // where the object will be reachable after upload
  key: string;
};

export interface StorageService {
  upload(input: UploadInput): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  /** Only S3-compatible providers support direct-to-storage upload; others return null. */
  presignUpload?(input: { filename: string; contentType: string; folder: string }): Promise<PresignedUpload>;
}
