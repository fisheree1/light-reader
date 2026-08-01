/** Platform-neutral binary storage boundary. Implementations live outside React components. */
export interface StorageAdapter {
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
